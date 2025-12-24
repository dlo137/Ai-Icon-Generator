import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';

const GUEST_SESSION_KEY = 'is_guest_session';
const GUEST_ID_KEY = 'guest_id';
const CREATING_GUEST_SESSION_KEY = 'creating_guest_session';

/**
 * Check if the current session is a guest session
 */
export async function isGuestSession(): Promise<boolean> {
  try {
    const isGuest = await AsyncStorage.getItem(GUEST_SESSION_KEY);
    return isGuest === 'true';
  } catch (error) {
    console.error('[Guest Session] Error checking guest status:', error);
    return false;
  }
}

/**
 * Check if we're currently creating a guest session (to prevent race conditions)
 */
export async function isCreatingGuestSession(): Promise<boolean> {
  try {
    const isCreating = await AsyncStorage.getItem(CREATING_GUEST_SESSION_KEY);
    return isCreating === 'true';
  } catch (error) {
    console.error('[Guest Session] Error checking creation status:', error);
    return false;
  }
}

/**
 * Get the guest session ID
 */
export async function getGuestSession(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(GUEST_ID_KEY);
  } catch (error) {
    console.error('[Guest Session] Error getting guest ID:', error);
    return null;
  }
}

/**
 * Create a new guest session
 * Creates an anonymous Supabase auth user and profile with unique name
 */
export async function createGuestSession(): Promise<string> {
  try {
    // Set flag to prevent race conditions
    await AsyncStorage.setItem(CREATING_GUEST_SESSION_KEY, 'true');

    console.log('[Guest Session] Creating anonymous Supabase user...');

    // Create anonymous Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously();

    if (authError || !authData.user) {
      console.error('[Guest Session] Failed to create anonymous user:', authError);
      throw new Error('Failed to create guest account');
    }

    const userId = authData.user.id;
    console.log('[Guest Session] Anonymous user created:', userId);

    // Generate sequential username (user1, user2, etc.)
    const username = await generateSequentialUsername();

    // Create or update Supabase profile for guest user
    // Use upsert in case profile was auto-created
    // Start with 0 credits - they'll get 3 only if they continue as guest (not purchase)
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        name: username,
        email: null, // Leave email blank for guests
        credits_current: 0,
        credits_max: 0,
        is_pro_version: false,
        onboarding_completed: false,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id'
      });

    if (profileError) {
      console.error('[Guest Session] Failed to create/update profile:', profileError);
      throw new Error('Failed to create guest profile');
    }
    
    console.log('[Guest Session] Profile created/updated for guest:', username);

    // Store guest session info in AsyncStorage
    await AsyncStorage.setItem(GUEST_SESSION_KEY, 'true');
    await AsyncStorage.setItem(GUEST_ID_KEY, userId);
    
    console.log('[Guest Session] Created new guest session:', { userId, username });
    
    // Clear the creating flag
    await AsyncStorage.removeItem(CREATING_GUEST_SESSION_KEY);
    
    return userId;
  } catch (error) {
    console.error('[Guest Session] Error creating guest session:', error);
    await AsyncStorage.removeItem(CREATING_GUEST_SESSION_KEY);
    throw error;
  }
}

/**
 * Clear the guest session (when user signs up or logs in)
 */
export async function clearGuestSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GUEST_SESSION_KEY);
    await AsyncStorage.removeItem(GUEST_ID_KEY);
    await AsyncStorage.removeItem(CREATING_GUEST_SESSION_KEY);
    console.log('[Guest Session] Cleared guest session');
  } catch (error) {
    console.error('[Guest Session] Error clearing guest session:', error);
    throw error;
  }
}

/**
 * Upgrade a guest account to a full account
 * Migrates guest data (credits, purchases, thumbnails) to the authenticated user
 */
export async function upgradeGuestToAccount(userId: string): Promise<void> {
  try {
    const guestId = await getGuestSession();
    if (!guestId) {
      console.log('[Guest Session] No guest session to upgrade');
      return;
    }

    console.log('[Guest Session] Upgrading guest to account:', { guestId, userId });

    // Import utilities here to avoid circular dependencies
    const { getGuestCredits, clearGuestCredits } = require('./guestCredits');
    const { getGuestPurchases, clearGuestPurchases } = require('./guestPurchaseStorage');

    // Get guest data
    const guestCredits = await getGuestCredits();
    const guestPurchases = await getGuestPurchases();

    // Migrate credits to authenticated user profile
    if (guestCredits) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          credits_current: guestCredits.current,
          credits_max: guestCredits.max,
        })
        .eq('id', userId);

      if (updateError) {
        console.error('[Guest Session] Error migrating credits:', updateError);
      } else {
        console.log('[Guest Session] Migrated credits:', guestCredits);
      }
    }

    // Migrate purchase history
    if (guestPurchases && guestPurchases.length > 0) {
      const latestPurchase = guestPurchases[guestPurchases.length - 1];
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          product_id: latestPurchase.productId,
          price: latestPurchase.price,
          purchase_time: latestPurchase.purchaseTime,
        })
        .eq('id', userId);

      if (updateError) {
        console.error('[Guest Session] Error migrating purchase history:', updateError);
      } else {
        console.log('[Guest Session] Migrated purchase history:', latestPurchase);
      }
    }

    // Clear guest data
    await clearGuestCredits();
    await clearGuestPurchases();
    await clearGuestSession();

    console.log('[Guest Session] Successfully upgraded guest to account');
  } catch (error) {
    console.error('[Guest Session] Error upgrading guest to account:', error);
    throw error;
  }
}

/**
 * Generate a unique username using timestamp + random number
 * Format: user{timestamp}{random} (e.g., user120, user123, user4567)
 * This prevents collisions even with concurrent guest account creation
 */
export async function generateSequentialUsername(): Promise<string> {
  try {
    // Generate unique username using timestamp (last 3 digits) + random 2-digit number
    const timestamp = Date.now();
    const lastThreeDigits = timestamp % 1000; // Get last 3 digits
    const randomNum = Math.floor(Math.random() * 100); // Random 0-99
    const uniqueNumber = parseInt(`${lastThreeDigits}${randomNum}`);
    
    const username = `user${uniqueNumber}`;
    
    // Verify this username doesn't exist (very unlikely but check anyway)
    const { data: existing } = await supabase
      .from('profiles')
      .select('name')
      .eq('name', username)
      .maybeSingle();

    if (existing) {
      // If collision (extremely rare), add another random component
      const extraRandom = Math.floor(Math.random() * 1000);
      const fallbackUsername = `user${uniqueNumber}${extraRandom}`;
      console.log('[Guest Session] Username collision, using fallback:', fallbackUsername);
      return fallbackUsername;
    }

    console.log('[Guest Session] Generated unique username:', username);
    return username;
  } catch (error) {
    console.error('[Guest Session] Error generating username:', error);
    // Fallback to fully random timestamp-based username
    return `user${Date.now()}`;
  }
}
