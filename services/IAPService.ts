// IAPService.ts - Production-ready IAP service for react-native-iap v14+
// Supports iOS StoreKit 2 and Android Google Play Billing

import { Platform, Alert } from 'react-native';
import Constants from 'expo-constants';
import * as RNIap from 'react-native-iap';
import { updateSubscriptionInProfile } from '../src/features/subscription/api';
import { PLAN_CONFIG, type SubscriptionPlan } from '../src/features/subscription/plans';
import { isGuestSession } from '../src/utils/guestSession';
import { saveGuestPurchase } from '../src/utils/guestPurchaseStorage';
import { initializeGuestCredits } from '../src/utils/guestCredits';

// Product IDs - must match App Store Connect / Google Play Console exactly
// CONSUMABLE IAP product IDs
const CONSUMABLE_SKUS = Platform.OS === 'ios'
  ? ['starter.25', 'value.75', 'pro.200']
  : ['starter.25', 'value.75', 'pro.200']; // Android uses same IDs

// Detect Expo Go environment
const isExpoGo = Constants.executionEnvironment === 'storeClient';

class IAPService {
  private static instance: IAPService;
  private isInitialized = false;
  private purchaseUpdateListener: any = null;
  private purchaseErrorListener: any = null;
  private debugCallback: ((info: any) => void) | null = null;
  private processedIds: Set<string> = new Set();
  private lastPurchaseResult: any = null;
  private currentPurchaseAttempt: SubscriptionPlan | null = null; // The plan the user SELECTED

  private constructor() {}

  static getInstance(): IAPService {
    if (!IAPService.instance) {
      IAPService.instance = new IAPService();
    }
    return IAPService.instance;
  }

  /**
   * Initialize IAP connection
   */
  async initialize(): Promise<boolean> {
    if (isExpoGo) {
      console.log('[IAP] Running in Expo Go - IAP disabled');
      return false;
    }

    if (this.isInitialized) {
      console.log('[IAP] Already initialized');
      return true;
    }

    try {
      // Initialize connection to App Store / Play Store
      console.log('[IAP] Connecting to store...');
      await RNIap.initConnection();
      console.log('[IAP] ✅ Connected to store');

      // Set up purchase listeners
      this.setupListeners();

      // Check for pending/unfinished purchases
      await this.checkPendingPurchases();

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('[IAP] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Set up purchase event listeners
   */
  private setupListeners(): void {
    // Listen for successful purchases
    this.purchaseUpdateListener = RNIap.purchaseUpdatedListener(
      async (purchase: any) => {
        console.log('[IAP] ========== PURCHASE RECEIVED ==========');
        console.log('[IAP] Full purchase object:', JSON.stringify(purchase, null, 2));

        // Use the plan the user SELECTED, not what Apple/Google says
        // Apple's purchase object is unreliable for subscription groups
        const plan = this.currentPurchaseAttempt;

        if (!plan) {
          console.error('[IAP] ❌ No current purchase attempt! Cannot determine which plan was selected.');
          throw new Error('Purchase succeeded but no plan was selected. This should never happen.');
        }

        console.log('[IAP] ✅ Using user-selected plan:', plan);
        console.log('[IAP] (Ignoring purchase object productId - Apple is unreliable for subscription groups)');

        // Get the correct productId from our plan config
        const productId = PLAN_CONFIG[plan].productId;
        console.log('[IAP] Product ID from plan config:', productId);

        if (this.debugCallback) {
          this.debugCallback({
            lastPurchase: purchase,
            listenerStatus: 'PURCHASE RECEIVED ✅'
          });
        }

        try {
          // Check if this is a guest purchase
          const isGuest = await isGuestSession();

          if (isGuest) {
            console.log('[IAP] Guest mode detected - using local storage');
            await this.handleGuestPurchase(purchase, plan);
            return;
          }

          // Verify and finish the purchase
          await this.finishPurchase(purchase);

          // Update Supabase profile with subscription data (non-blocking)
          console.log('[IAP] Updating Supabase profile...');

          // Generate unique subscription ID
          let purchaseId = purchase.transactionId || purchase.purchaseToken;

          if (!purchaseId) {
            // Generate unique ID if purchase doesn't provide one
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(2, 15);
            purchaseId = `${productId}_${timestamp}_${random}`;
            console.log('[IAP] Generated subscription ID:', purchaseId);
          } else {
            console.log('[IAP] Using purchase ID from store:', purchaseId);
          }

          // Convert purchase time to ISO string (transactionDate may be a timestamp in ms)
          let purchaseTime: string;
          if (purchase.transactionDate) {
            // If it's a number (timestamp in ms), convert to ISO string
            if (typeof purchase.transactionDate === 'number') {
              purchaseTime = new Date(purchase.transactionDate).toISOString();
              console.log('[IAP] Converted timestamp to ISO:', purchase.transactionDate, '->', purchaseTime);
            } else {
              purchaseTime = purchase.transactionDate;
              console.log('[IAP] Using transaction date as-is:', purchaseTime);
            }
          } else {
            purchaseTime = new Date().toISOString();
            console.log('[IAP] No transaction date, using current time:', purchaseTime);
          }

          // Try to update Supabase, but don't let it block the success flow
          console.log('[IAP] Calling updateSubscriptionInProfile with:');
          console.log('[IAP]   - plan (user selected):', plan);
          console.log('[IAP]   - purchaseId:', purchaseId);
          console.log('[IAP]   - purchaseTime:', purchaseTime);
          updateSubscriptionInProfile(plan, purchaseId, purchaseTime)
            .then(() => {
              console.log('[IAP] ✅ Supabase profile updated successfully');
            })
            .catch((error) => {
              console.error('[IAP] ⚠️ Supabase update failed (non-blocking):', error);
              // Error is logged but not shown to user since purchase succeeded
            });

          // Update last purchase result
          this.lastPurchaseResult = {
            success: true,
            productId,
            timestamp: new Date().toISOString()
          };

          // Notify success immediately (don't wait for Supabase)
          if (this.debugCallback) {
            this.debugCallback({
              listenerStatus: 'PURCHASE SUCCESS! ✅',
              shouldNavigate: true,
              purchaseComplete: true,
              productId
            });
          }
        } catch (error) {
          console.error('[IAP] Error processing purchase:', error);

          if (this.debugCallback) {
            this.debugCallback({
              listenerStatus: 'PURCHASE FAILED ❌'
            });
          }
        }
      }
    );

    // Listen for purchase errors
    this.purchaseErrorListener = RNIap.purchaseErrorListener(
      (error: any) => {
        console.error('[IAP] Purchase error:', error.message);

        if (this.debugCallback) {
          this.debugCallback({
            listenerStatus: `PURCHASE ERROR ❌: ${error.message}`
          });
        }

        this.lastPurchaseResult = {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    );

    console.log('[IAP] ✅ Listeners active');
  }

  /**
   * Check for pending/unfinished purchases
   */
  private async checkPendingPurchases(): Promise<void> {
    try {
      const purchases = await RNIap.getAvailablePurchases();

      if (purchases && purchases.length > 0) {
        console.log('[IAP] Found', purchases.length, 'pending purchases');

        for (const purchase of purchases) {
          const txId = purchase.transactionId;
          if (txId && !this.processedIds.has(txId)) {
            const productId = (purchase as any).productId || (purchase as any).productIds?.[0];
            console.log('[IAP] Processing pending purchase:', productId);
            this.processedIds.add(txId);
            await this.finishPurchase(purchase);
          }
        }
      }
    } catch (error) {
      console.error('[IAP] Error checking pending purchases:', error);
    }
  }

  /**
   * Check for orphaned transactions (alias for checkPendingPurchases)
   */
  async checkForOrphanedTransactions(): Promise<void> {
    return this.checkPendingPurchases();
  }

  /**
   * Finish a purchase (acknowledge on Android, finish on iOS)
   */
  private async finishPurchase(purchase: any): Promise<void> {
    try {
      if (Platform.OS === 'android') {
        // v14+ API: acknowledgePurchaseAndroid takes just the token string
        await RNIap.acknowledgePurchaseAndroid(purchase.purchaseToken);
      } else {
        // iOS: finishTransaction with purchase object
        await RNIap.finishTransaction({ purchase });
      }

      const productId = purchase.productId || purchase.productIds?.[0];
      console.log('[IAP] ✅ Purchase finished:', productId);
    } catch (error) {
      console.error('[IAP] Error finishing purchase:', error);
      throw error;
    }
  }

  /**
   * Handle guest purchase (device-local storage only)
   */
  private async handleGuestPurchase(purchase: any, plan: SubscriptionPlan): Promise<void> {
    console.log('[IAP] ========== GUEST PURCHASE ==========');

    try {
      // 1. Finish the purchase with store
      await this.finishPurchase(purchase);

      // 2. Get purchase data
      const purchaseId = purchase.transactionId || purchase.purchaseToken || `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const purchaseTime = purchase.transactionDate
        ? (typeof purchase.transactionDate === 'number'
          ? new Date(purchase.transactionDate).toISOString()
          : purchase.transactionDate)
        : new Date().toISOString();
      const productId = PLAN_CONFIG[plan].productId;

      console.log('[IAP] Guest purchase ID:', purchaseId);
      console.log('[IAP] Guest purchase time:', purchaseTime);
      console.log('[IAP] Guest plan:', plan);

      // 3. Store purchase locally
      await saveGuestPurchase({
        plan,
        purchaseId,
        purchaseTime,
        productId,
        isActive: true
      });

      // 4. Initialize guest credits
      await initializeGuestCredits(plan);

      // 5. Update Supabase profile if guest has a Supabase user ID
      const { getGuestSession } = require('../src/utils/guestSession');
      const guestSession = await getGuestSession();

      console.log('[IAP] Guest session data:', JSON.stringify(guestSession, null, 2));

      if (guestSession?.supabaseUserId) {
        console.log('[IAP] ========== UPDATING GUEST SUPABASE PROFILE ==========');
        console.log('[IAP] Guest Supabase User ID:', guestSession.supabaseUserId);
        console.log('[IAP] Plan:', plan);
        console.log('[IAP] Purchase ID:', purchaseId);
        console.log('[IAP] Purchase Time:', purchaseTime);

        // Import updateSubscriptionInProfile to reuse the same logic
        const { updateSubscriptionInProfile } = require('../src/features/subscription/api');

        try {
          await updateSubscriptionInProfile(plan, purchaseId, purchaseTime);
          console.log('[IAP] ✅✅✅ Guest Supabase profile updated successfully! ✅✅✅');
        } catch (error) {
          console.error('[IAP] ❌❌❌ Failed to update guest Supabase profile:', error);
          console.error('[IAP] Error details:', JSON.stringify(error, null, 2));
          // Don't throw - local storage is already updated, so purchase is safe
        }
      } else {
        console.log('[IAP] ⚠️ Guest has no Supabase user ID - using local storage only');
        console.log('[IAP] This means guest profile table will NOT be updated');
      }

      // 6. Update last purchase result
      this.lastPurchaseResult = {
        success: true,
        productId,
        timestamp: purchaseTime
      };

      // 6. Notify success
      console.log('[IAP] ✅ Guest purchase complete!');
      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'GUEST PURCHASE SUCCESS! ✅',
          shouldNavigate: true,
          purchaseComplete: true,
          productId
        });
      }
    } catch (error) {
      console.error('[IAP] Error processing guest purchase:', error);

      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'GUEST PURCHASE FAILED ❌'
        });
      }

      throw error;
    }
  }

  /**
   * Detect consumable pack from purchase object
   */
  private detectPlanFromPurchase(purchase: any): SubscriptionPlan {
    const productId = (purchase.productId || purchase.productIds?.[0] || '').toLowerCase();

    console.log('[IAP] Detecting plan from productId:', productId);

    // Match actual product IDs: starter.25, value.75, pro.200
    if (productId.includes('pro') || productId.includes('200')) {
      return 'pro';
    } else if (productId.includes('value') || productId.includes('75')) {
      return 'value';
    } else if (productId.includes('starter') || productId.includes('25')) {
      return 'starter';
    }

    // Default to starter if no match
    console.warn('[IAP] Could not detect plan, defaulting to starter');
    return 'starter';
  }

  /**
   * Get available consumable IAP products
   * Returns products from App Store Connect / Google Play Console
   * Normalizes v14 products to have 'productId' property for compatibility
   */
  async getProducts(): Promise<any[]> {
    if (isExpoGo) {
      console.log('[IAP] Expo Go - returning mock products');
      return this.getMockProducts();
    }

    if (!this.isInitialized) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error('IAP not available');
      }
    }

    try {
      console.log('[IAP] Fetching consumable products:', CONSUMABLE_SKUS);
      console.log('[IAP] Platform:', Platform.OS);
      console.log('[IAP] Expected product count:', CONSUMABLE_SKUS.length);

      // ✅ CORRECT - react-native-iap API for consumables
      const products = await RNIap.fetchProducts({ skus: CONSUMABLE_SKUS });

      console.log('[IAP] Raw products response:', JSON.stringify(products, null, 2));

      if (!products || products.length === 0) {
        console.error('[IAP] No products returned or empty array');
        console.error('[IAP] This usually means:');
        console.error('[IAP]   1. Product IDs do not match App Store Connect/Google Play Console');
        console.error('[IAP]   2. Products are not approved for sale');
        console.error('[IAP]   3. Wrong product type (subscriptions vs consumables)');
        console.error('[IAP]   4. Bundle ID mismatch');
        console.error('[IAP]   5. Not signed in with test account (sandbox)');
        return [];
      }

      // Normalize products: v14 uses 'id', but we add 'productId' for compatibility
      const normalizedProducts = products.map((p: any) => ({
        ...p,
        productId: p.id || p.productId, // Ensure productId exists
        price: p.displayPrice || p.price // Normalize price
      }));

      console.log('[IAP] ✅ Products loaded:', normalizedProducts.length);

      normalizedProducts.forEach((p: any) => {
        console.log('[IAP]   -', p.productId, ':', p.price);
      });

      return normalizedProducts;
    } catch (error) {
      console.error('[IAP] Error fetching products:', error);
      throw error;
    }
  }

  /**
   * Purchase a consumable product
   * @param productId - Product SKU (e.g., 'starter.15', 'value.45', 'pro.120')
   * @param plan - The plan the user selected (starter/value/pro)
   */
  async purchaseProduct(productId: string, plan: SubscriptionPlan): Promise<void> {
    // Store the plan the user selected - this is our source of truth
    this.currentPurchaseAttempt = plan;
    console.log('[IAP] Purchase attempt started for plan:', plan);
    if (isExpoGo) {
      console.log('[IAP] Expo Go - simulating purchase');
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'PURCHASE SUCCESS! ✅',
          productId
        });
      }
      return;
    }

    try {
      console.log('[IAP] Purchasing:', productId);

      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'PURCHASE INITIATED - WAITING... ⏳'
        });
      }

      // ✅ UPDATED - react-native-iap v14+ API uses 'sku' string (not array)
      // Purchases are handled by listeners (event-based, not promise-based)
      // Type assertion needed due to incorrect type definitions in react-native-iap
      await RNIap.requestPurchase({ sku: productId } as any);

      // Success/error will be handled by listeners
    } catch (error: any) {
      console.error('[IAP] Purchase failed:', error);

      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'PURCHASE FAILED ❌'
        });
      }

      // User cancelled
      if (error.code === 'E_USER_CANCELLED' || error?.message?.includes('cancel')) {
        console.log('[IAP] User cancelled purchase');
        throw new Error('User cancelled purchase');
      }

      throw error;
    }
  }

  /**
   * Restore previous purchases
   */
  async restorePurchases(): Promise<any[]> {
    if (isExpoGo) {
      throw new Error('No purchases to restore');
    }

    try {
      console.log('[IAP] Restoring purchases...');
      const isGuest = await isGuestSession();
      const purchases = await RNIap.getAvailablePurchases();

      if (!purchases || purchases.length === 0) {
        throw new Error('No purchases found');
      }

      console.log('[IAP] ✅ Restored', purchases.length, 'purchases');

      for (const purchase of purchases) {
        await this.finishPurchase(purchase);

        if (isGuest) {
          // Restore to local storage for guests
          const plan = this.detectPlanFromPurchase(purchase);
          const purchaseId = purchase.transactionId || purchase.purchaseToken || `restored_${Date.now()}`;
          const purchaseTime = purchase.transactionDate
            ? (typeof purchase.transactionDate === 'number'
              ? new Date(purchase.transactionDate).toISOString()
              : purchase.transactionDate)
            : new Date().toISOString();

          console.log('[IAP] Restoring guest purchase:', plan);

          await saveGuestPurchase({
            plan,
            purchaseId,
            purchaseTime,
            productId: PLAN_CONFIG[plan].productId,
            isActive: true
          });

          await initializeGuestCredits(plan);
        }
      }

      return purchases;
    } catch (error) {
      console.error('[IAP] Restore failed:', error);
      throw error;
    }
  }

  /**
   * Check if IAP is available on this device
   */
  isAvailable(): boolean {
    return !isExpoGo;
  }

  /**
   * Set debug callback for UI updates
   */
  setDebugCallback(callback: (info: any) => void): void {
    this.debugCallback = callback;
  }

  /**
   * Get last purchase result (for debugging)
   */
  getLastPurchaseResult(): any {
    return this.lastPurchaseResult;
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): { isConnected: boolean; hasListener: boolean } {
    return {
      isConnected: this.isInitialized,
      hasListener: !!this.purchaseUpdateListener,
    };
  }

  /**
   * Cleanup - call when app closes
   */
  async cleanup(): Promise<void> {
    if (this.purchaseUpdateListener) {
      this.purchaseUpdateListener.remove();
      this.purchaseUpdateListener = null;
    }

    if (this.purchaseErrorListener) {
      this.purchaseErrorListener.remove();
      this.purchaseErrorListener = null;
    }

    if (this.isInitialized) {
      await RNIap.endConnection();
      this.isInitialized = false;
    }

    console.log('[IAP] Cleanup complete');
  }

  /**
   * Mock products for Expo Go testing
   */
  private getMockProducts(): any[] {
    return [
      {
        productId: 'starter.25',
        id: 'starter.25',
        title: 'Starter Pack (Mock)',
        description: 'Mock starter pack - 15 credits',
        price: '$1.99',
        localizedPrice: '$1.99',
        displayPrice: '$1.99',
        currency: 'USD',
      },
      {
        productId: 'value.75',
        id: 'value.75',
        title: 'Value Pack (Mock)',
        description: 'Mock value pack - 45 credits',
        price: '$5.99',
        localizedPrice: '$5.99',
        displayPrice: '$5.99',
        currency: 'USD',
      },
      {
        productId: 'pro.200',
        id: 'pro.200',
        title: 'Pro Pack (Mock)',
        description: 'Mock pro pack - 120 credits',
        price: '$14.99',
        localizedPrice: '$14.99',
        displayPrice: '$14.99',
        currency: 'USD',
      },
    ];
  }
}

export default IAPService.getInstance();
