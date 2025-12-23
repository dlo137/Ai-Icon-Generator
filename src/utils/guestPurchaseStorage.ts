import AsyncStorage from '@react-native-async-storage/async-storage';

const GUEST_PURCHASES_KEY = 'guest_purchases';

export type SubscriptionPlan = 'starter' | 'value' | 'pro' | 'free';

export interface GuestPurchase {
  productId: string;
  plan: SubscriptionPlan;
  price: number;
  purchaseTime: string;
  credits: number;
}

/**
 * Get all guest purchases
 */
export async function getGuestPurchases(): Promise<GuestPurchase[]> {
  try {
    const purchasesData = await AsyncStorage.getItem(GUEST_PURCHASES_KEY);
    if (!purchasesData) {
      return [];
    }
    return JSON.parse(purchasesData);
  } catch (error) {
    console.error('[Guest Purchases] Error getting purchases:', error);
    return [];
  }
}

/**
 * Add a new guest purchase
 */
export async function addGuestPurchase(purchase: GuestPurchase): Promise<void> {
  try {
    const purchases = await getGuestPurchases();
    purchases.push(purchase);
    await AsyncStorage.setItem(GUEST_PURCHASES_KEY, JSON.stringify(purchases));
    console.log('[Guest Purchases] Added purchase:', purchase);
  } catch (error) {
    console.error('[Guest Purchases] Error adding purchase:', error);
    throw error;
  }
}

/**
 * Clear all guest purchases (for account upgrades)
 */
export async function clearGuestPurchases(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GUEST_PURCHASES_KEY);
    console.log('[Guest Purchases] Cleared all purchases');
  } catch (error) {
    console.error('[Guest Purchases] Error clearing purchases:', error);
  }
}

/**
 * Get the latest guest purchase
 */
export async function getLatestGuestPurchase(): Promise<GuestPurchase | null> {
  try {
    const purchases = await getGuestPurchases();
    if (purchases.length === 0) {
      return null;
    }
    return purchases[purchases.length - 1];
  } catch (error) {
    console.error('[Guest Purchases] Error getting latest purchase:', error);
    return null;
  }
}
