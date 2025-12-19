import AsyncStorage from '@react-native-async-storage/async-storage';

const GUEST_PURCHASE_KEY = 'guest_purchase';

export type SubscriptionPlan = 'weekly' | 'monthly' | 'yearly';

export interface GuestPurchase {
  plan: SubscriptionPlan;
  purchaseId: string;
  purchaseTime: string;
  productId: string;
  isActive: boolean;
}

/**
 * Save guest purchase to AsyncStorage (device-only)
 */
export async function saveGuestPurchase(purchase: GuestPurchase): Promise<void> {
  try {
    await AsyncStorage.setItem(GUEST_PURCHASE_KEY, JSON.stringify(purchase));
    console.log('[Guest Purchase] Saved:', purchase.plan, purchase.purchaseId);
  } catch (error) {
    console.error('[Guest Purchase] Error saving:', error);
    throw error;
  }
}

/**
 * Get active guest purchase
 */
export async function getGuestPurchase(): Promise<GuestPurchase | null> {
  try {
    const purchaseData = await AsyncStorage.getItem(GUEST_PURCHASE_KEY);
    if (!purchaseData) return null;

    const purchase: GuestPurchase = JSON.parse(purchaseData);

    // Return only if active
    return purchase.isActive ? purchase : null;
  } catch (error) {
    console.error('[Guest Purchase] Error getting purchase:', error);
    return null;
  }
}

/**
 * Check if guest has an active subscription
 */
export async function hasActiveGuestSubscription(): Promise<boolean> {
  const purchase = await getGuestPurchase();
  return purchase !== null && purchase.isActive === true;
}

/**
 * Clear guest purchase (for account upgrades)
 */
export async function clearGuestPurchase(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GUEST_PURCHASE_KEY);
    console.log('[Guest Purchase] Cleared');
  } catch (error) {
    console.error('[Guest Purchase] Error clearing purchase:', error);
  }
}

/**
 * Update guest purchase status
 */
export async function updateGuestPurchaseStatus(isActive: boolean): Promise<void> {
  try {
    const purchase = await getGuestPurchase();
    if (purchase) {
      purchase.isActive = isActive;
      await saveGuestPurchase(purchase);
      console.log('[Guest Purchase] Updated status:', isActive);
    }
  } catch (error) {
    console.error('[Guest Purchase] Error updating status:', error);
    throw error;
  }
}
