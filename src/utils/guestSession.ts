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
 */
export async function createGuestSession(): Promise<string> {
  try {
    // Set flag to prevent race conditions
    await AsyncStorage.setItem(CREATING_GUEST_SESSION_KEY, 'true');

    // Generate a unique guest ID
    const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store guest session info
    await AsyncStorage.setItem(GUEST_SESSION_KEY, 'true');
    await AsyncStorage.setItem(GUEST_ID_KEY, guestId);
    
    console.log('[Guest Session] Created new guest session:', guestId);
    
    // Clear the creating flag
    await AsyncStorage.removeItem(CREATING_GUEST_SESSION_KEY);
    
    return guestId;
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
 * Generate a sequential unique username (user1, user2, etc.)
 * Queries the database to find the next available number
 */
export async function generateSequentialUsername(): Promise<string> {
  try {
    // Query all profiles with names like 'user%' to find the highest number
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('name')
      .like('name', 'user%');

    if (error) {
      console.error('[Guest Session] Error querying profiles for username:', error);
      // Fallback to timestamp-based username if query fails
      return `user${Date.now()}`;
    }

    // Extract numbers from usernames like 'user1', 'user2', etc.
    let maxNumber = 0;
    if (profiles && profiles.length > 0) {
      profiles.forEach(profile => {
        if (profile.name) {
          const match = profile.name.match(/^user(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) {
              maxNumber = num;
            }
          }
        }
      });
    }

    // Return next sequential number
    const nextNumber = maxNumber + 1;
    console.log('[Guest Session] Generated sequential username: user' + nextNumber);
    return `user${nextNumber}`;
  } catch (error) {
    console.error('[Guest Session] Error generating sequential username:', error);
    // Fallback to timestamp-based username
    return `user${Date.now()}`;
  }
}
