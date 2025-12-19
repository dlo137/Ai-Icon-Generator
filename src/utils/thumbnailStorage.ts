import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../lib/supabase';

/**
 * Thumbnail Storage Module
 *
 * PERSISTENCE STRATEGY:
 * 1. Images are uploaded to Supabase Storage with user-specific paths (userId/filename)
 * 2. Edge Function returns signed URLs valid for 7 days
 * 3. This module immediately downloads images to permanent local device storage
 * 4. Local storage is namespaced by user ID for security isolation
 * 5. Images persist until explicitly deleted by the user
 *
 * IMPORTANT: Images are stored locally on the device to ensure they never disappear.
 * Even if Supabase signed URLs expire, the local copy remains accessible.
 */

export interface SavedThumbnail {
  id: string;
  title: string;
  prompt: string;
  imageUrl: string;
  date: string;
  status: 'completed' | 'processing' | 'failed';
  timestamp: number;
  isFavorited: boolean;
  edits?: {
    textOverlay?: {
      text: string;
      x: number; // Relative position (0.0 to 1.0)
      y: number; // Relative position (0.0 to 1.0)
      scale: number;
      rotation: number;
    };
  } | null;
}

// Get user-specific storage key
const getStorageKey = async (): Promise<string | null> => {
  try {
    // Check if guest mode first
    const { isGuestSession, getGuestSession } = require('./guestSession');
    const isGuest = await isGuestSession();

    if (isGuest) {
      const guestSession = await getGuestSession();
      if (!guestSession) {
        console.error('Guest session not found');
        return null;
      }
      return `saved_thumbnails_${guestSession.sessionId}`;
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Session error in getStorageKey:', sessionError.message);
      return null;
    }

    const userId = session?.user?.id;

    if (!userId) {
      console.error('User not authenticated');
      return null;
    }

    // Namespace storage by user ID for proper isolation
    return `saved_thumbnails_${userId}`;
  } catch (error) {
    console.error('Error getting storage key:', error);
    return null;
  }
};

// Get user-specific thumbnail directory
const getThumbnailDir = async (): Promise<string | null> => {
  try {
    // Check if guest mode first
    const { isGuestSession, getGuestSession } = require('./guestSession');
    const isGuest = await isGuestSession();

    if (isGuest) {
      const guestSession = await getGuestSession();
      if (!guestSession) {
        console.error('Guest session not found');
        return null;
      }
      return `${FileSystem.documentDirectory}thumbnails/${guestSession.sessionId}/`;
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Session error in getThumbnailDir:', sessionError.message);
      return null;
    }

    const userId = session?.user?.id;

    if (!userId) {
      console.error('User not authenticated');
      return null;
    }

    // Namespace directory by user ID for proper isolation
    return `${FileSystem.documentDirectory}thumbnails/${userId}/`;
  } catch (error) {
    console.error('Error getting thumbnail directory:', error);
    return null;
  }
};

// Ensure thumbnail directory exists
const ensureThumbnailDirectory = async () => {
  const thumbnailDir = await getThumbnailDir();
  if (!thumbnailDir) {
    throw new Error('User not authenticated');
  }

  const dirInfo = await FileSystem.getInfoAsync(thumbnailDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(thumbnailDir, { intermediates: true });
  }
};

// Download and save image to permanent local storage with retry logic
const downloadImageToLocal = async (remoteUrl: string, thumbnailId: string, maxRetries = 3): Promise<string> => {
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await ensureThumbnailDirectory();

      const thumbnailDir = await getThumbnailDir();
      if (!thumbnailDir) {
        throw new Error('User not authenticated');
      }

      const filename = `thumbnail_${thumbnailId}.png`;
      const localUri = `${thumbnailDir}${filename}`;

      // Check if file already exists locally
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists) {
        console.log('Image already exists locally:', localUri);
        return localUri;
      }

      // Download the image
      console.log(`Downloading image (attempt ${attempt}/${maxRetries}):`, remoteUrl);
      console.log('Saving to:', localUri);

      const downloadResult = await FileSystem.downloadAsync(remoteUrl, localUri);

      // Verify the download was successful
      if (downloadResult.status !== 200) {
        throw new Error(`Download failed with status: ${downloadResult.status}`);
      }

      // Verify the file exists and has content
      const verifyInfo = await FileSystem.getInfoAsync(downloadResult.uri);
      if (!verifyInfo.exists) {
        throw new Error('Downloaded file does not exist');
      }
      if (verifyInfo.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      console.log('Image downloaded successfully to:', downloadResult.uri, `(${verifyInfo.size} bytes)`);
      return downloadResult.uri;

    } catch (error) {
      lastError = error;
      console.error(`Error downloading image (attempt ${attempt}/${maxRetries}):`, error);

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5 seconds
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed - return the remote URL as fallback
  console.error('All download attempts failed. Using remote URL as fallback:', remoteUrl);
  console.error('Last error:', lastError);
  return remoteUrl;
};

export const saveThumbnail = async (
  prompt: string,
  imageUrl: string,
  edits?: {
    textOverlay?: {
      text: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
    };
  } | null
): Promise<SavedThumbnail> => {
  try {
    const storageKey = await getStorageKey();
    if (!storageKey) {
      throw new Error('User not authenticated');
    }

    const existingThumbnails = await getSavedThumbnails();

    // Generate ID first (we'll need it for download)
    const thumbnailId = Date.now().toString();

    // Check if this exact thumbnail already exists (by exact imageUrl match only)
    const existingIndex = existingThumbnails.findIndex(t =>
      t.imageUrl === imageUrl
    );

    if (existingIndex !== -1) {
      // Update existing thumbnail to be favorited
      const updatedThumbnail = {
        ...existingThumbnails[existingIndex],
        isFavorited: true,
        edits: edits,
      };

      const updatedThumbnails = [...existingThumbnails];
      updatedThumbnails[existingIndex] = updatedThumbnail;

      await AsyncStorage.setItem(storageKey, JSON.stringify(updatedThumbnails));

      return updatedThumbnail;
    }

    // Download image to permanent local storage
    const localImageUrl = await downloadImageToLocal(imageUrl, thumbnailId);

    // Create new thumbnail if it doesn't exist
    const newThumbnail: SavedThumbnail = {
      id: thumbnailId,
      title: generateTitle(prompt),
      prompt,
      imageUrl: localImageUrl, // Store local file path
      date: new Date().toISOString().split('T')[0],
      status: 'completed',
      timestamp: Date.now(),
      isFavorited: true,
      edits: edits,
    };

    const updatedThumbnails = [newThumbnail, ...existingThumbnails];

    await AsyncStorage.setItem(storageKey, JSON.stringify(updatedThumbnails));

    return newThumbnail;
  } catch (error) {
    console.error('Error saving thumbnail:', error);
    throw error;
  }
};

export const addThumbnailToHistory = async (
  prompt: string,
  imageUrl: string,
  edits?: {
    textOverlay?: {
      text: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
    };
  } | null
): Promise<SavedThumbnail> => {
  try {
    const storageKey = await getStorageKey();
    if (!storageKey) {
      throw new Error('User not authenticated');
    }

    const existingThumbnails = await getSavedThumbnails();

    // Generate ID first (we'll need it for download)
    const thumbnailId = Date.now().toString();

    // Check if this exact URL already exists in history
    const existingIndex = existingThumbnails.findIndex(t =>
      t.imageUrl === imageUrl
    );

    if (existingIndex !== -1) {
      // This exact thumbnail already exists in history, just return it
      console.log('Thumbnail already exists in history:', imageUrl);
      return existingThumbnails[existingIndex];
    }

    // Download image to permanent local storage
    const localImageUrl = await downloadImageToLocal(imageUrl, thumbnailId);

    const newThumbnail: SavedThumbnail = {
      id: thumbnailId,
      title: generateTitle(prompt),
      prompt,
      imageUrl: localImageUrl, // Store local file path
      date: new Date().toISOString().split('T')[0],
      status: 'completed',
      timestamp: Date.now(),
      isFavorited: false, // Not favorited by default for history
      edits: edits,
    };

    const updatedThumbnails = [newThumbnail, ...existingThumbnails];

    await AsyncStorage.setItem(storageKey, JSON.stringify(updatedThumbnails));

    console.log('Added new thumbnail to history:', thumbnailId, localImageUrl);
    return newThumbnail;
  } catch (error) {
    console.error('Error adding thumbnail to history:', error);
    throw error;
  }
};

export const getSavedThumbnails = async (): Promise<SavedThumbnail[]> => {
  try {
    const storageKey = await getStorageKey();
    if (!storageKey) {
      console.error('User not authenticated - cannot get thumbnails');
      return [];
    }

    const stored = await AsyncStorage.getItem(storageKey);
    const thumbnails = stored ? JSON.parse(stored) : [];
    // Sort by timestamp descending (most recent first)
    return thumbnails.sort((a: SavedThumbnail, b: SavedThumbnail) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Error getting saved thumbnails:', error);
    return [];
  }
};

export const toggleFavorite = async (id: string): Promise<SavedThumbnail | null> => {
  try {
    const storageKey = await getStorageKey();
    if (!storageKey) {
      throw new Error('User not authenticated');
    }

    const existingThumbnails = await getSavedThumbnails();
    const updatedThumbnails = existingThumbnails.map(thumb =>
      thumb.id === id ? { ...thumb, isFavorited: !thumb.isFavorited } : thumb
    );

    await AsyncStorage.setItem(storageKey, JSON.stringify(updatedThumbnails));

    return updatedThumbnails.find(t => t.id === id) || null;
  } catch (error) {
    console.error('Error toggling favorite:', error);
    throw error;
  }
};

export const deleteSavedThumbnail = async (id: string): Promise<void> => {
  try {
    const storageKey = await getStorageKey();
    if (!storageKey) {
      throw new Error('User not authenticated');
    }

    const existingThumbnails = await getSavedThumbnails();
    const thumbnailToDelete = existingThumbnails.find(thumb => thumb.id === id);

    // Delete the local image file if it exists
    if (thumbnailToDelete && thumbnailToDelete.imageUrl.startsWith('file://')) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(thumbnailToDelete.imageUrl);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(thumbnailToDelete.imageUrl);
          console.log('Deleted local image file:', thumbnailToDelete.imageUrl);
        }
      } catch (fileError) {
        console.error('Error deleting local image file:', fileError);
        // Continue with deleting from storage even if file deletion fails
      }
    }

    const updatedThumbnails = existingThumbnails.filter(thumb => thumb.id !== id);
    await AsyncStorage.setItem(storageKey, JSON.stringify(updatedThumbnails));
  } catch (error) {
    console.error('Error deleting thumbnail:', error);
    throw error;
  }
};

const generateTitle = (prompt: string): string => {
  // Clean and normalize the prompt
  const cleanPrompt = prompt
    .replace(/[.,!?;:]/g, '') // Remove punctuation
    .trim();

  const wordCount = cleanPrompt.split(/\s+/).length;

  // If prompt is 2-3 words, just capitalize and use as is
  if (wordCount <= 3) {
    return cleanPrompt.split(/\s+/).map(word =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  }

  // For longer prompts, summarize
  const lowerPrompt = cleanPrompt.toLowerCase();

  // Stop words to filter out
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'about', 'icon', 'image', 'picture',
    'create', 'make', 'generate', 'show', 'display', 'featuring', 'app',
    'that', 'this', 'has', 'have', 'are', 'was', 'were', 'been', 'being',
    'a', 'an', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'as'
  ]);

  // Split into words and filter
  const words = lowerPrompt.split(/\s+/).filter(word =>
    word.length > 2 && !stopWords.has(word)
  );

  // Remove duplicate consecutive words (e.g., "gamer vs gamer" -> "gamer vs")
  const uniqueWords = words.filter((word, index) =>
    index === 0 || word !== words[index - 1]
  );

  // Take first 3-4 unique words for title
  const titleWords = uniqueWords.slice(0, 4);

  // Capitalize each word properly
  const title = titleWords.map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');

  // If title is too short after filtering, use first few words of original prompt
  if (title.length < 5) {
    const fallbackWords = lowerPrompt.split(/\s+/).slice(0, 3);
    return fallbackWords.map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  return title;
};
