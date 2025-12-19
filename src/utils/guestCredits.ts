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
 */
export async function initializeGuestCredits(plan: SubscriptionPlan): Promise<void> {
  try {
    const maxCredits = PLAN_CONFIG[plan]?.credits || 0;

    const credits: GuestCreditsInfo = {
      current: maxCredits,
      max: maxCredits,
      lastResetDate: new Date().toISOString(),
      plan
    };

    await AsyncStorage.setItem(GUEST_CREDITS_KEY, JSON.stringify(credits));
    console.log('[Guest Credits] Initialized:', plan, maxCredits);
  } catch (error) {
    console.error('[Guest Credits] Error initializing:', error);
    throw error;
  }
}

/**
 * Get guest credits with automatic reset check
 */
export async function getGuestCredits(): Promise<CreditsInfo> {
  try {
    const creditsData = await AsyncStorage.getItem(GUEST_CREDITS_KEY);

    if (!creditsData) {
      // No credits found - return 0
      return { current: 0, max: 0 };
    }

    const credits: GuestCreditsInfo = JSON.parse(creditsData);

    // Check if reset is needed
    const needsReset = await shouldResetCredits(credits.lastResetDate, credits.plan);

    if (needsReset) {
      console.log('[Guest Credits] Auto-reset triggered for', credits.plan);
      await resetGuestCredits();
      return await getGuestCredits(); // Return freshly reset credits
    }

    return {
      current: credits.current,
      max: credits.max
    };
  } catch (error) {
    console.error('[Guest Credits] Error getting credits:', error);
    return { current: 0, max: 0 };
  }
}

/**
 * Deduct credits from guest account
 */
export async function deductGuestCredit(amount: number = 1): Promise<boolean> {
  try {
    const creditsData = await AsyncStorage.getItem(GUEST_CREDITS_KEY);

    if (!creditsData) {
      console.error('[Guest Credits] No credits found');
      return false;
    }

    const credits: GuestCreditsInfo = JSON.parse(creditsData);

    // Check if auto-reset is needed first
    const needsReset = await shouldResetCredits(credits.lastResetDate, credits.plan);
    if (needsReset) {
      console.log('[Guest Credits] Auto-reset before deduction');
      await resetGuestCredits();
      const freshCredits = await getGuestCredits();
      credits.current = freshCredits.current;
      credits.max = freshCredits.max;
    }

    if (credits.current < amount) {
      console.error('[Guest Credits] Insufficient credits:', credits.current);
      return false;
    }

    // Deduct
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
 * Check if credits should be auto-reset based on plan
 */
async function shouldResetCredits(lastResetDate: string, plan: SubscriptionPlan): Promise<boolean> {
  try {
    const lastReset = new Date(lastResetDate);
    const now = new Date();

    if (plan === 'weekly') {
      // Reset if 7+ days have passed
      const daysDiff = Math.floor((now.getTime() - lastReset.getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff >= 7;
    } else if (plan === 'monthly') {
      // Reset if month has changed
      return now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear();
    } else if (plan === 'yearly') {
      // Yearly plan gets monthly credits - reset if month has changed
      return now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear();
    }

    return false;
  } catch (error) {
    console.error('[Guest Credits] Error checking reset:', error);
    return false;
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
