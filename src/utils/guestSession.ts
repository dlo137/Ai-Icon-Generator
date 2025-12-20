import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateSubscriptionInProfile } from '../features/subscription/api';
import { getGuestPurchase, clearGuestPurchase } from './guestPurchaseStorage';
import { getSavedThumbnails } from './thumbnailStorage';
import { supabase } from '../../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';

const GUEST_SESSION_KEY = 'guest_session';
const GUEST_CREATION_FLAG = 'creating_guest_session';

export interface GuestSession {
  isGuest: boolean;
  sessionId: string;
  createdAt: string;
  supabaseUserId?: string; // Anonymous user ID from Supabase
}

/**
 * Create a new guest session
 * Also creates an anonymous Supabase user and profile row (with timeout protection)
 */
export async function createGuestSession(): Promise<GuestSession> {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const sessionId = `guest_${timestamp}_${random}`;

  // Set flag to indicate we're creating a guest session
  await AsyncStorage.setItem(GUEST_CREATION_FLAG, 'true');

  // Create the basic guest session first (works offline)
  let supabaseUserId: string | undefined;

  // Try to create anonymous Supabase auth user (with timeout protection)
  try {    
    // Add timeout protection for the anonymous sign-in
    const signInPromise = supabase.auth.signInAnonymously();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Anonymous sign-in timeout')), 8000)
    );

    const { data, error } = await Promise.race([signInPromise, timeoutPromise]) as any;

    if (error) {
    } else if (data?.user) {
      supabaseUserId = data.user.id;

      // Generate truly unique guest name with collision avoidance
      const generateUniqueGuestName = async (): Promise<string> => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const randomNum = Math.floor(Math.random() * 999999);
          const randomSuffix = Math.random().toString(36).substring(2, 6);
          const candidateName = `Guest${randomNum}${randomSuffix}`;
          
          // Check if this name already exists
          const { data: existingName } = await supabase
            .from('profiles')
            .select('name')
            .eq('name', candidateName)
            .maybeSingle();
          
          if (!existingName) {
            return candidateName;
          }
        }
        // Fallback: use UUID-based name
        return `Guest${Date.now()}${Math.random().toString(36).substring(2)}`;
      };

      const guestName = await generateUniqueGuestName();

      // Try to create profile with better error handling
      try {        
        // First, check if profile already exists
        const { data: existingProfile, error: selectError } = await supabase
          .from('profiles')
          .select('id, name, credits_current')
          .eq('id', supabaseUserId)
          .maybeSingle();

        if (selectError) {
        } else if (existingProfile) {          
          // Update the name if it's null or empty
          if (!existingProfile.name || existingProfile.name.trim() === '') {
            const { error: updateError } = await supabase
              .from('profiles')
              .update({ name: guestName })
              .eq('id', supabaseUserId);

            if (updateError) {
            } else {
            }
          } else {
          }
        } else {
          // Profile doesn't exist, create it          
          const { data: insertData, error: profileError } = await supabase
            .from('profiles')
            .insert({
              id: supabaseUserId,
              name: guestName,
              email: null,
              credits_current: 3, // Start with 3 free credits
              credits_max: 3,
              is_pro_version: false,
            })
            .select();

          if (profileError) {
          } else {
          }
        }
      } catch (profileError) {
      }
    } else {
    }
  } catch (error) {
  }

  // Create the session object
  const session: GuestSession = {
    isGuest: true,
    sessionId,
    createdAt: new Date().toISOString(),
    supabaseUserId
  };

  // Save the session (works regardless of Supabase status)
  await AsyncStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));

  // Clear the guest creation flag
  await AsyncStorage.removeItem(GUEST_CREATION_FLAG);

  return session;
}

/**
 * Check if current session is a guest session
 */
export async function isGuestSession(): Promise<boolean> {
  try {
    const sessionData = await AsyncStorage.getItem(GUEST_SESSION_KEY);
    if (!sessionData) return false;

    const session: GuestSession = JSON.parse(sessionData);
    return session.isGuest === true;
  } catch (error) {
    return false;
  }
}

/**
 * Get current guest session data
 */
export async function getGuestSession(): Promise<GuestSession | null> {
  try {
    const sessionData = await AsyncStorage.getItem(GUEST_SESSION_KEY);
    if (!sessionData) return null;

    return JSON.parse(sessionData);
  } catch (error) {
    console.error('[Guest Session] Error getting session:', error);
    return null;
  }
}

/**
 * Check if we're currently creating a guest session
 */
export async function isCreatingGuestSession(): Promise<boolean> {
  try {
    const flag = await AsyncStorage.getItem(GUEST_CREATION_FLAG);
    return flag === 'true';
  } catch (error) {
    console.error('[Guest Session] Error checking creation flag:', error);
    return false;
  }
}

/**
 * Clear guest session (used when upgrading to account)
 */
export async function clearGuestSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GUEST_SESSION_KEY);
    console.log('[Guest Session] Cleared');
  } catch (error) {
    console.error('[Guest Session] Error clearing session:', error);
  }
}

/**
 * Upgrade guest to full account by migrating data
 */
export async function upgradeGuestToAccount(userId: string): Promise<void> {
  console.log('[Guest Upgrade] Starting migration for user:', userId);

  try {
    // 1. Migrate purchase to Supabase
    const guestPurchase = await getGuestPurchase();
    if (guestPurchase) {
      console.log('[Guest Upgrade] Migrating purchase:', guestPurchase.plan);

      await updateSubscriptionInProfile(
        guestPurchase.plan,
        guestPurchase.purchaseId,
        guestPurchase.purchaseTime
      );
    }

    // 2. Migrate thumbnails to Supabase
    const guestSession = await getGuestSession();
    if (guestSession) {
      console.log('[Guest Upgrade] Migrating thumbnails...');

      const guestThumbnails = await getSavedThumbnails();

      if (guestThumbnails && guestThumbnails.length > 0) {
        for (const thumbnail of guestThumbnails) {
          await uploadThumbnailToSupabase(userId, thumbnail);
        }
        console.log('[Guest Upgrade] Migrated', guestThumbnails.length, 'thumbnails');
      }
    }

    // 3. Clear guest data
    await clearGuestPurchase();
    await clearGuestSession();

    console.log('[Guest Upgrade] Migration complete');
  } catch (error) {
    console.error('[Guest Upgrade] Migration error:', error);
    throw error;
  }
}

/**
 * Upload a thumbnail to Supabase storage (for migration)
 */
async function uploadThumbnailToSupabase(userId: string, thumbnail: any): Promise<void> {
  try {
    // Check if file exists locally
    const fileInfo = await FileSystem.getInfoAsync(thumbnail.imageUrl);
    if (!fileInfo.exists) {
      console.warn('[Guest Upgrade] Thumbnail file not found:', thumbnail.imageUrl);
      return;
    }

    // Read file as base64
    const fileBase64 = await FileSystem.readAsStringAsync(thumbnail.imageUrl, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Convert base64 to blob
    const byteCharacters = atob(fileBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });

    // Generate unique filename
    const timestamp = Date.now();
    const fileName = `${thumbnail.prompt}_${timestamp}.png`;
    const filePath = `${userId}/${fileName}`;

    // Upload to Supabase storage
    const { error: uploadError } = await supabase.storage
      .from('thumbnails')
      .upload(filePath, blob, {
        contentType: 'image/png',
        upsert: false
      });

    if (uploadError) {
      console.error('[Guest Upgrade] Upload error:', uploadError);
    } else {
      console.log('[Guest Upgrade] Uploaded thumbnail:', fileName);
    }
  } catch (error) {
    console.error('[Guest Upgrade] Error uploading thumbnail:', error);
    // Don't throw - continue with other thumbnails
  }
}
