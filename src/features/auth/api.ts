import { supabase, redirectTo } from "../../../lib/supabase";
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as WebBrowser from 'expo-web-browser';

export async function signUpEmail(email: string, password: string, fullName?: string) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      emailRedirectTo: redirectTo,
      data: {
        full_name: fullName
      }
    },
  });
  if (error) throw error;

  // Update profile table with the name and mark onboarding started if user was created
  if (data.user && fullName) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        name: fullName,
        onboarding_completed: false  // Mark as not completed yet - will be set to true when they finish subscription screen
      })
      .eq('id', data.user.id);

    if (profileError) {
      console.error('Error updating profile:', profileError);
    }
  }

  return data;
}

export async function signInEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Profile management functions
export async function getMyProfile() {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return null;
  const { data, error } = await supabase.from("profiles")
    .select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(updates: {
  name?: string;
  avatar_url?: string;
  website?: string;
}) {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase.from("profiles")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

/**
 * Delete the current user's account from Supabase
 */
export async function deleteAccount(): Promise<void> {
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    // Step 1: Delete all images from Supabase Storage
    try {
      console.log('Deleting user images from Supabase Storage...');

      // List all files in the thumbnails bucket for this user
      const { data: files, error: listError } = await supabase.storage
        .from('thumbnails')
        .list();

      if (!listError && files && files.length > 0) {
        // Delete all files
        const filePaths = files.map(file => file.name);
        const { error: deleteFilesError } = await supabase.storage
          .from('thumbnails')
          .remove(filePaths);

        if (deleteFilesError) {
          console.error('Error deleting files from storage:', deleteFilesError);
        } else {
          console.log(`Deleted ${filePaths.length} files from Supabase Storage`);
        }
      }
    } catch (storageError) {
      console.error('Error accessing Supabase Storage:', storageError);
      // Continue with deletion even if storage cleanup fails
    }

    // Step 2: Delete local thumbnail files from FileSystem
    try {
      console.log('Deleting local thumbnail files...');
      const thumbnailDir = `${FileSystem.documentDirectory}thumbnails/`;
      const dirInfo = await FileSystem.getInfoAsync(thumbnailDir);

      if (dirInfo.exists) {
        await FileSystem.deleteAsync(thumbnailDir, { idempotent: true });
        console.log('Deleted local thumbnail directory');
      }
    } catch (fileSystemError) {
      console.error('Error deleting local files:', fileSystemError);
      // Continue with deletion even if file cleanup fails
    }

    // Step 3: Clear AsyncStorage thumbnail data
    try {
      console.log('Clearing thumbnail data from AsyncStorage...');
      await AsyncStorage.removeItem('saved_thumbnails');
      console.log('Cleared thumbnail data from AsyncStorage');
    } catch (asyncStorageError) {
      console.error('Error clearing AsyncStorage:', asyncStorageError);
      // Continue with deletion even if AsyncStorage cleanup fails
    }

    // Step 4: Delete user's profile data
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', user.id);

    if (profileError) {
      console.error('Error deleting profile:', profileError);
      // Continue anyway - profile might not exist or might be cascade deleted
    }

    // Step 5: Try to delete via edge function first (if deployed)
    try {
      const { error: deleteError } = await supabase.functions.invoke('delete-user', {
        body: { userId: user.id }
      });

      if (!deleteError) {
        // Successfully deleted via edge function
        await supabase.auth.signOut();
        return;
      }
    } catch (edgeFunctionError) {
      console.log('Edge function not available, continuing with sign out');
    }

    // Step 6: Sign out the user
    await supabase.auth.signOut();

    console.log('User account and all images deleted successfully');
  } catch (error) {
    console.error('Delete account error:', error);
    throw error;
  }
}

export async function signInWithApple() {
  try {
    // Request Apple authentication
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    // Extract the necessary data
    const { identityToken, authorizationCode, fullName } = credential;

    if (!identityToken) {
      throw new Error('No identity token returned from Apple');
    }

    // Use Supabase OAuth with Apple - pass the token for server-side validation
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
    });

    if (error) throw error;

    // Check if this is a new user and update profile
    if (data.user) {
      // Check if profile exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id, onboarding_completed, email, name')
        .eq('id', data.user.id)
        .single();

      const updates: any = {};

      // Always save the email from Apple (unless it's already set)
      // This includes both real emails and private relay emails
      if (data.user.email && (!existingProfile?.email || existingProfile.email !== data.user.email)) {
        updates.email = data.user.email;
        console.log('[Apple Sign In] Saving email to profile:', data.user.email);
      }

      // If new user with full name from Apple, add it
      // Note: Apple only provides fullName on FIRST sign in, not on subsequent sign ins
      if (fullName && !existingProfile?.name) {
        const fullNameString = [
          fullName.givenName,
          fullName.familyName,
        ]
          .filter(Boolean)
          .join(' ');

        if (fullNameString) {
          updates.name = fullNameString;
          console.log('[Apple Sign In] Saving name to profile:', fullNameString);
        }
      }

      // If no name was provided by Apple (subsequent sign-ins), use email prefix as fallback
      if (!updates.name && !existingProfile?.name && data.user.email) {
        // Check if it's a private relay email
        const isPrivateEmail = data.user.email.includes('@privaterelay.appleid.com');
        if (!isPrivateEmail) {
          // Use real email prefix as name
          updates.name = data.user.email.split('@')[0];
          console.log('[Apple Sign In] Using email prefix as name:', updates.name);
        } else {
          // For private emails, use a generic name
          updates.name = 'User';
          console.log('[Apple Sign In] Using generic name for private relay email');
        }
      }

      // If new user (no existing profile or no onboarding_completed field), mark onboarding as not complete
      if (!existingProfile || existingProfile.onboarding_completed === null || existingProfile.onboarding_completed === undefined) {
        updates.onboarding_completed = false;
      }

      // Update profile if there are updates
      if (Object.keys(updates).length > 0) {
        console.log('[Apple Sign In] Updating profile with:', updates);
        await supabase
          .from('profiles')
          .update(updates)
          .eq('id', data.user.id);
      }
    }

    return data;
  } catch (error: any) {
    if (error.code === 'ERR_REQUEST_CANCELED') {
      throw new Error('Sign in was canceled');
    }
    throw error;
  }
}

export async function signInWithGoogle() {
  try {
    // Configure WebBrowser for OAuth
    WebBrowser.maybeCompleteAuthSession();

    const Platform = require('react-native').Platform;
    console.log('[Google Auth] Starting OAuth with redirect:', redirectTo);
    console.log('[Google Auth] Platform:', Platform.OS);

    // Start Google OAuth flow
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo,
        skipBrowserRedirect: Platform.OS === 'android', // Skip auto-redirect on Android
        queryParams: {
          prompt: 'select_account',
        },
      }
    });

    if (error) {
      console.error('[Google Auth] OAuth init error:', error);
      throw new Error(`Google OAuth initialization failed: ${error.message}`);
    }

    if (!data?.url) {
      throw new Error('No OAuth URL returned from Supabase');
    }

    console.log('[Google Auth] OAuth URL:', data.url.substring(0, 100) + '...');
    console.log('[Google Auth] Opening browser...');

    // On Android, just open the URL and let the deep link handle the callback
    if (Platform.OS === 'android') {
      const result = await WebBrowser.openBrowserAsync(data.url);
      console.log('[Google Auth] Browser opened on Android, waiting for deep link callback...');

      // Poll for session - the deep link listener will trigger navigation
      // but we need to wait for the session to be established
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (sessionData?.session) {
          console.log(`[Google Auth] ✓ Session found after ${(i + 1) * 500}ms!`);
          return sessionData;
        }

        if (i % 5 === 0) {
          console.log(`[Google Auth] Poll attempt ${i + 1}/30: Waiting for session...`);
        }
      }

      console.log('[Google Auth] No session found after 15 seconds');
      throw new Error('Sign in timed out. Please try again.');
    }

    // iOS: Use openAuthSessionAsync which properly handles the callback
    const result = await WebBrowser.openAuthSessionAsync(
      data.url,
      redirectTo
    );

    console.log('[Google Auth] Browser result type:', result.type);

    // If browser closed/dismissed, check if session was created
    if (result.type === 'cancel' || result.type === 'dismiss') {
      console.log('[Google Auth] Browser dismissed, checking for session with polling...');

      // Poll for session multiple times (sometimes takes a few seconds)
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (sessionData?.session) {
          console.log(`[Google Auth] ✓ Session found after ${(i + 1) * 500}ms!`);
          return sessionData;
        }

        console.log(`[Google Auth] Poll attempt ${i + 1}/10: No session yet...`);
      }

      console.log('[Google Auth] No session found after 5 seconds, sign in was likely canceled');
      throw new Error('Sign in was canceled');
    }

    if (result.type === 'success' && result.url) {
      console.log('[Google Auth] Callback URL received');
      console.log('[Google Auth] Full URL:', result.url);

      // Parse URL properly
      const url = new URL(result.url);

      // Check for authorization code (PKCE flow)
      const code = url.searchParams.get('code');

      if (code) {
        console.log('[Google Auth] Got auth code, exchanging for session...');

        const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

        if (sessionError) {
          console.error('[Google Auth] Code exchange error:', sessionError);
          throw sessionError;
        }

        console.log('[Google Auth] Session created!');
        return sessionData;
      }

      // Fallback: Check for direct tokens (implicit flow)
      const hashParams = new URLSearchParams(url.hash.substring(1));
      const accessToken = hashParams.get('access_token') || url.searchParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token') || url.searchParams.get('refresh_token');

      console.log('[Google Auth] Checking tokens - access:', !!accessToken, 'refresh:', !!refreshToken);

      if (accessToken && refreshToken) {
        console.log('[Google Auth] Setting session with tokens...');

        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (sessionError) {
          console.error('[Google Auth] Session error:', sessionError);
          throw sessionError;
        }

        console.log('[Google Auth] Session created!');
        return sessionData;
      }

      console.error('[Google Auth] No code or tokens in callback URL');
      throw new Error('No authentication data in callback');
    }

    console.error('[Google Auth] Browser did not return success or callback URL was invalid');
    throw new Error('Authentication was not completed. The browser did not return a valid response.');
  } catch (error: any) {
    console.error('[Google Auth] Full error:', error);
    console.error('[Google Auth] Error type:', typeof error);
    console.error('[Google Auth] Error message:', error?.message);
    console.error('[Google Auth] Error stack:', error?.stack);

    // Provide helpful error message
    if (error?.message?.includes('canceled')) {
      throw error;
    }

    throw new Error(`Google sign-in failed: ${error?.message || 'Unknown error'}. Please try again or contact support.`);
  }
}

/**
 * Helper function to check and set onboarding status for new users
 */
async function checkAndSetOnboardingStatus(userId: string) {
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, onboarding_completed')
    .eq('id', userId)
    .single();

  // If new user (no existing profile or no onboarding_completed field), mark onboarding as not complete
  if (!existingProfile || existingProfile.onboarding_completed === null || existingProfile.onboarding_completed === undefined) {
    await supabase
      .from('profiles')
      .update({ onboarding_completed: false })
      .eq('id', userId);
  }
}

/**
 * Mark onboarding as complete for the current user
 */
export async function completeOnboarding() {
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('User not authenticated');
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ onboarding_completed: true })
    .eq('id', user.id);

  if (updateError) {
    console.error('Error completing onboarding:', updateError);
    throw updateError;
  }
}