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

  // Update profile table with the name if user was created
  if (data.user && fullName) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        name: fullName
      })
      .eq('id', data.user.id);

    if (profileError) {
      // Profile update error
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
  console.log('[AUTH] Signing out user...');
  
  // Only clear onboarding flag - keep device_id and credits
  await AsyncStorage.removeItem('hasCompletedOnboarding');
  
  console.log('[AUTH] Cleared onboarding flag - user will see onboarding on next launch');
  console.log('[AUTH] Sign out completed');
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
          // Error deleting files
        } else {
          // Files deleted successfully
        }
      }
    } catch (storageError) {
      // Continue with deletion even if storage cleanup fails
    }

    // Step 2: Delete local thumbnail files from FileSystem
    try {
      const thumbnailDir = `${FileSystem.documentDirectory}thumbnails/`;
      const dirInfo = await FileSystem.getInfoAsync(thumbnailDir);

      if (dirInfo.exists) {
        await FileSystem.deleteAsync(thumbnailDir, { idempotent: true });
      }
    } catch (fileSystemError) {
      // Continue with deletion even if file cleanup fails
    }

    // Step 3: Clear AsyncStorage thumbnail data
    try {
      await AsyncStorage.removeItem('saved_thumbnails');
    } catch (asyncStorageError) {
      // Continue with deletion even if AsyncStorage cleanup fails
    }

    // Step 4: Delete user's profile data
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', user.id);

    if (profileError) {
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
      // Edge function not available, continuing with sign out
    }

    // Step 6: Sign out the user
    await supabase.auth.signOut();

  } catch (error) {
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
      const { data: existingProfile, error: profileFetchError } = await supabase
        .from('profiles')
        .select('id, onboarding_completed, email, name')
        .eq('id', data.user.id)
        .single();

      const updates: any = {};

      // Always save the email from Apple (unless it's already set)
      // This includes both real emails and private relay emails
      if (data.user.email && (!existingProfile?.email || existingProfile.email !== data.user.email)) {
        updates.email = data.user.email;
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
        }
      }

      // If no name was provided by Apple (subsequent sign-ins), use email prefix as fallback
      if (!updates.name && !existingProfile?.name && data.user.email) {
        // Check if it's a private relay email
        const isPrivateEmail = data.user.email.includes('@privaterelay.appleid.com');
        if (!isPrivateEmail) {
          // Use real email prefix as name
          updates.name = data.user.email.split('@')[0];
        } else {
          // For private emails, use a generic name
          updates.name = 'User';
        }
      }

      // If new user (no existing profile or no onboarding_completed field), mark onboarding as not complete
      if (!existingProfile || existingProfile.onboarding_completed === null || existingProfile.onboarding_completed === undefined) {
        updates.onboarding_completed = false;
      }

      // Update profile if there are updates
      if (Object.keys(updates).length > 0) {
        const { data: updateResult, error: updateError } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', data.user.id)
          .select();

        if (updateError) {
          // Check if profile exists, if not create it
          if (updateError.code === 'PGRST116') {
            await supabase
              .from('profiles')
              .insert({
                id: data.user.id,
                ...updates,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
          }
        }
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

          // Update profile with Google user data
          if (sessionData?.session?.user) {
            await updateProfileAfterGoogleSignIn(sessionData.session.user);
          }

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

          // Update profile with Google user data
          if (sessionData?.session?.user) {
            await updateProfileAfterGoogleSignIn(sessionData.session.user);
          }

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

        // Update profile with Google user data
        if (sessionData?.user) {
          await updateProfileAfterGoogleSignIn(sessionData.user);
        }

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

        // Update profile with Google user data
        if (sessionData?.user) {
          await updateProfileAfterGoogleSignIn(sessionData.user);
        }

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
 * Update profile after Google sign-in with user data from OAuth
 */
async function updateProfileAfterGoogleSignIn(user: any) {
  try {
    console.log('[Google Auth] Updating profile for user:', user.id);

    // Check if profile exists
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, onboarding_completed, email, name')
      .eq('id', user.id)
      .maybeSingle();

    const updates: any = {};

    // Save email from Google
    if (user.email && (!existingProfile?.email || existingProfile.email !== user.email)) {
      updates.email = user.email;
      console.log('[Google Auth] Saving email to profile:', user.email);
    }

    // Extract name from Google OAuth data
    if (!existingProfile?.name) {
      // Try to get name from multiple sources
      const userName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.user_metadata?.display_name ||
        user.identities?.[0]?.identity_data?.full_name ||
        user.identities?.[0]?.identity_data?.name ||
        (user.email ? user.email.split('@')[0] : 'User');

      updates.name = userName;
      console.log('[Google Auth] Saving name to profile:', userName);
      console.log('[Google Auth] User metadata:', JSON.stringify(user.user_metadata, null, 2));
      console.log('[Google Auth] User identities:', JSON.stringify(user.identities, null, 2));
    }

    // If new user, mark onboarding as not complete
    if (!existingProfile || existingProfile.onboarding_completed === null || existingProfile.onboarding_completed === undefined) {
      updates.onboarding_completed = false;
    }

    // Update profile if there are updates
    if (Object.keys(updates).length > 0) {
      console.log('[Google Auth] Updating profile with:', updates);
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

      if (error) {
        console.error('[Google Auth] Error updating profile:', error);
      } else {
        console.log('[Google Auth] Profile updated successfully');
      }
    } else {
      console.log('[Google Auth] No profile updates needed');
    }
  } catch (error) {
    console.error('[Google Auth] Error in updateProfileAfterGoogleSignIn:', error);
    // Don't throw - profile update shouldn't block sign-in
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
 * Sets both database field and AsyncStorage flag for persistence
 */
export async function completeOnboarding() {
  console.log('[AUTH] Completing onboarding...');

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    console.log('[AUTH] No user found, skipping database update');
    // Still set AsyncStorage even if no user (for guests)
  } else {
    // Update database for authenticated users
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ onboarding_completed: true })
      .eq('id', user.id);

    if (updateError) {
      console.error('[AUTH] Error updating database:', updateError);
      // Don't throw - still set AsyncStorage
    } else {
      console.log('[AUTH] Database updated successfully');
    }
  }

  // Set AsyncStorage flag for persistence (works for both guests and regular users)
  await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
  console.log('[AUTH] ✅ Onboarding marked as complete in AsyncStorage');
}