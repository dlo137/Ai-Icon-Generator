import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSubscriptionInfo as getSupabaseSubscriptionInfo } from '../features/subscription/api';
import { supabase } from '../../lib/supabase';

const SUBSCRIPTION_KEY = 'user_subscription';
const CREDITS_KEY = 'user_credits';

export interface SubscriptionInfo {
  isActive: boolean;
  productId: string;
  purchaseDate: string;
  expiryDate?: string;
}

export interface CreditsInfo {
  current: number;
  max: number;
  lastResetDate?: string;
}

export const saveSubscriptionInfo = async (subscriptionInfo: SubscriptionInfo): Promise<void> => {
  try {
    await AsyncStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(subscriptionInfo));
  } catch (error) {
    console.error('Error saving subscription info:', error);
    throw error;
  }
};

export const getSubscriptionInfo = async (): Promise<SubscriptionInfo | null> => {
  try {
    const stored = await AsyncStorage.getItem(SUBSCRIPTION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Error getting subscription info:', error);
    return null;
  }
};

export const clearSubscriptionInfo = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(SUBSCRIPTION_KEY);
  } catch (error) {
    console.error('Error clearing subscription info:', error);
    throw error;
  }
};

export const isUserSubscribed = async (): Promise<boolean> => {
  try {
    const subscriptionInfo = await getSubscriptionInfo();
    if (!subscriptionInfo) return false;

    // For auto-renewable subscriptions, you would validate with App Store/Play Store
    // For now, we'll just check if active
    return subscriptionInfo.isActive;
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return false;
  }
};

// Track if we're currently resetting to prevent loops
let isResetting = false;

// Credits Management Functions - Now uses Supabase for real-time tracking with automatic resets
export const getCredits = async (): Promise<CreditsInfo> => {
  try {
    // First try to get from Supabase edge function
    // The edge function now automatically checks if credits need to be reset based on subscription cycle
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        // First check what the subscription plan is
        const supabaseSubInfo = await getSupabaseSubscriptionInfo();

        // Invoke the edge function - it will automatically reset if needed
        const { data, error } = await supabase.functions.invoke('manage-credits', {
          body: { action: 'get' }
        });

        if (!error && data) {
          const credits: CreditsInfo = {
            current: data.current,
            max: data.max
          };

          // If credits are 0 but user has subscription, force reset (only once)
          if (credits.current === 0 && credits.max === 0 && supabaseSubInfo?.is_pro_version && !isResetting) {
            isResetting = true;
            console.log('Credits are 0 but user has subscription, forcing reset...');

            const { data: resetData, error: resetError } = await supabase.functions.invoke('manage-credits', {
              body: { action: 'reset' }
            });

            isResetting = false;

            if (!resetError && resetData) {
              const newCredits: CreditsInfo = {
                current: resetData.current,
                max: resetData.max
              };
              console.log('Reset successful, new credits:', newCredits);
              await saveCredits(newCredits);
              return newCredits;
            } else {
              console.error('Reset failed:', resetError);
            }
          }

          // Cache locally for offline access
          await saveCredits(credits);
          return credits;
        }
      }
    } catch (supabaseError) {
      console.log('Could not fetch from Supabase, using local cache:', supabaseError);
    }

    // Fallback to local storage if Supabase fails
    const stored = await AsyncStorage.getItem(CREDITS_KEY);
    if (stored) {
      const credits = JSON.parse(stored);

      // Check if we need to update max credits based on current subscription
      let correctMaxCredits = 0; // No free plan - requires subscription

      try {
        const supabaseSubInfo = await getSupabaseSubscriptionInfo();
        if (supabaseSubInfo && supabaseSubInfo.is_pro_version) {
          if (supabaseSubInfo.subscription_plan === 'yearly') {
            correctMaxCredits = 90;
          } else if (supabaseSubInfo.subscription_plan === 'monthly') {
            correctMaxCredits = 75;
          } else if (supabaseSubInfo.subscription_plan === 'weekly') {
            correctMaxCredits = 10;
          }
        }
      } catch (error) {
        console.log('Could not fetch Supabase subscription in getCredits');
      }

      // If max credits don't match subscription, reset credits
      if (credits.max !== correctMaxCredits) {
        await resetCredits();
        return await getCredits(); // Recursively get the updated credits
      }

      return credits;
    }

    // Initialize with no free credits
    const initialCredits: CreditsInfo = { current: 0, max: 0 };
    await saveCredits(initialCredits);
    return initialCredits;
  } catch (error) {
    console.error('Error getting credits:', error);
    return { current: 0, max: 0 };
  }
};

export const saveCredits = async (credits: CreditsInfo): Promise<void> => {
  try {
    await AsyncStorage.setItem(CREDITS_KEY, JSON.stringify(credits));
  } catch (error) {
    console.error('Error saving credits:', error);
    throw error;
  }
};

export const deductCredit = async (amount: number = 1): Promise<boolean> => {
  try {
    // Try to deduct from Supabase first
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        const { data, error } = await supabase.functions.invoke('manage-credits', {
          body: { action: 'deduct', amount }
        });

        if (!error && data && data.success) {
          // Update local cache with new values
          const updatedCredits: CreditsInfo = {
            current: data.current,
            max: data.max
          };
          await saveCredits(updatedCredits);
          return true;
        } else if (error || (data && data.error)) {
          console.error('Supabase credit deduction failed:', error || data.error);
          // Fall through to local deduction
        }
      }
    } catch (supabaseError) {
      console.log('Could not deduct from Supabase, using local:', supabaseError);
    }

    // Fallback to local storage
    const credits = await getCredits();
    if (credits.current < amount) {
      return false; // Not enough credits
    }

    credits.current -= amount;
    await saveCredits(credits);
    return true;
  } catch (error) {
    console.error('Error deducting credit:', error);
    return false;
  }
};

export const resetCredits = async (): Promise<void> => {
  try {
    let maxCredits = 0; // No free plan - requires subscription

    // First check Supabase subscription info
    try {
      const supabaseSubInfo = await getSupabaseSubscriptionInfo();
      if (supabaseSubInfo && supabaseSubInfo.is_pro_version) {
        if (supabaseSubInfo.subscription_plan === 'yearly') {
          maxCredits = 90;
        } else if (supabaseSubInfo.subscription_plan === 'monthly') {
          maxCredits = 75;
        } else if (supabaseSubInfo.subscription_plan === 'weekly') {
          maxCredits = 10;
        }
      }
    } catch (error) {
      console.log('Could not fetch Supabase subscription, checking local storage');
    }

    // Fallback to local storage if Supabase didn't provide info
    if (maxCredits === 0) {
      const subscriptionInfo = await getSubscriptionInfo();
      if (subscriptionInfo && subscriptionInfo.isActive) {
        if (subscriptionInfo.productId === 'icon.yearly') {
          maxCredits = 90;
        } else if (subscriptionInfo.productId === 'icon.monthly') {
          maxCredits = 75;
        } else if (subscriptionInfo.productId === 'icon.weekly') {
          maxCredits = 10;
        }
      }
    }

    const credits: CreditsInfo = {
      current: maxCredits,
      max: maxCredits,
      lastResetDate: new Date().toISOString()
    };

    // Try to reset in Supabase first
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.functions.invoke('manage-credits', {
          body: { action: 'reset' }
        });
      }
    } catch (supabaseError) {
      console.log('Could not reset in Supabase, updating locally only:', supabaseError);
    }

    await saveCredits(credits);
  } catch (error) {
    console.error('Error resetting credits:', error);
    throw error;
  }
};

export const initializeCredits = async (): Promise<void> => {
  try {
    const existingCredits = await AsyncStorage.getItem(CREDITS_KEY);
    if (!existingCredits) {
      await resetCredits();
    } else {
      // Migration: Remove old free plan credits
      const credits = JSON.parse(existingCredits);
      if (credits.max === 10 || credits.max === 10000 || credits.max === 100) {
        // User has old free plan, remove free credits
        await resetCredits();
      }
    }
  } catch (error) {
    console.error('Error initializing credits:', error);
  }
};