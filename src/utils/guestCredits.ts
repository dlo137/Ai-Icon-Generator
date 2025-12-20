import AsyncStorage from '@react-native-async-storage/async-storage';
import { SubscriptionPlan } from './guestPurchaseStorage';
import { PLAN_CONFIG } from '../features/subscription/plans';

const GUEST_CREDITS_KEY = 'guest_credits';

export interface GuestCreditsInfo {
  current: number;
  max: number;
  lastResetDate: string;
  plan: SubscriptionPlan;
}

export interface CreditsInfo {
  current: number;
  max: number;
}

/**
 * Initialize guest credits based on subscription plan
 * Adds new credits to existing balance
 */
export async function initializeGuestCredits(plan: SubscriptionPlan): Promise<void> {
  try {
    const creditsToAdd = PLAN_CONFIG[plan]?.credits || 0;

    // Get existing credits
    const existingData = await AsyncStorage.getItem(GUEST_CREDITS_KEY);
    const existingCredits = existingData ? JSON.parse(existingData) : null;
    const currentCredits = existingCredits?.current || 0;

    // New total = existing + new purchase
    const newTotal = currentCredits + creditsToAdd;

    // Denominator logic: Set to pack size, unless current > pack size, then match current
    const newMax = newTotal > creditsToAdd ? newTotal : creditsToAdd;

    const credits: GuestCreditsInfo = {
      current: newTotal,
      max: newMax, // Pack size, or current if current > pack size
      lastResetDate: new Date().toISOString(),
      plan
    };

    await AsyncStorage.setItem(GUEST_CREDITS_KEY, JSON.stringify(credits));
    console.log('[Guest Credits] Initialized:', plan, 'added', creditsToAdd, 'current:', newTotal, 'max:', newMax);
  } catch (error) {
    console.error('[Guest Credits] Error initializing:', error);
    throw error;
  }
}

/**
 * Get guest credits (CONSUMABLE - no auto-reset)
 */
export async function getGuestCredits(): Promise<CreditsInfo> {
  try {
    console.log('[Guest Credits] Reading from AsyncStorage key:', GUEST_CREDITS_KEY);
    const creditsData = await AsyncStorage.getItem(GUEST_CREDITS_KEY);
    console.log('[Guest Credits] Raw data from AsyncStorage:', creditsData);

    if (!creditsData) {
      // No credits found - return 0
      console.log('[Guest Credits] No credits found, returning 0/0');
      return { current: 0, max: 0 };
    }

    const credits: GuestCreditsInfo = JSON.parse(creditsData);
    console.log('[Guest Credits] Parsed credits:', JSON.stringify(credits));

    // Consumable model: Credits don't auto-reset
    // User must purchase more when they run out

    const result = {
      current: credits.current,
      max: credits.max
    };
    console.log('[Guest Credits] Returning:', JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('[Guest Credits] Error getting credits:', error);
    return { current: 0, max: 0 };
  }
}

/**
 * Deduct credits from guest account (CONSUMABLE - no auto-reset)
 */
export async function deductGuestCredit(amount: number = 1): Promise<boolean> {
  try {
    const creditsData = await AsyncStorage.getItem(GUEST_CREDITS_KEY);

    if (!creditsData) {
      console.error('[Guest Credits] No credits found');
      return false;
    }

    const credits: GuestCreditsInfo = JSON.parse(creditsData);

    if (credits.current < amount) {
      console.error('[Guest Credits] Insufficient credits:', credits.current);
      return false;
    }

    // Deduct (consumable model - no reset)
    credits.current -= amount;
    await AsyncStorage.setItem(GUEST_CREDITS_KEY, JSON.stringify(credits));

    console.log('[Guest Credits] Deducted', amount, '- Remaining:', credits.current);
    return true;
  } catch (error) {
    console.error('[Guest Credits] Error deducting:', error);
    return false;
  }
}

/**
 * Reset guest credits to max
 */
export async function resetGuestCredits(): Promise<void> {
  try {
    const creditsData = await AsyncStorage.getItem(GUEST_CREDITS_KEY);

    if (!creditsData) {
      console.warn('[Guest Credits] No credits to reset');
      return;
    }

    const credits: GuestCreditsInfo = JSON.parse(creditsData);

    // Reset to max
    credits.current = credits.max;
    credits.lastResetDate = new Date().toISOString();

    await AsyncStorage.setItem(GUEST_CREDITS_KEY, JSON.stringify(credits));
    console.log('[Guest Credits] Reset to max:', credits.max);
  } catch (error) {
    console.error('[Guest Credits] Error resetting:', error);
    throw error;
  }
}


/**
 * Clear guest credits (for account upgrades)
 */
export async function clearGuestCredits(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GUEST_CREDITS_KEY);
    console.log('[Guest Credits] Cleared');
  } catch (error) {
    console.error('[Guest Credits] Error clearing:', error);
  }
}
