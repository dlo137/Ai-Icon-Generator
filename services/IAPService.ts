// IAPService.ts - Production-ready IAP service for react-native-iap v14+
// Supports iOS StoreKit 2 and Android Google Play Billing

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as RNIap from 'react-native-iap';
import { PLAN_CONFIG, type SubscriptionPlan } from '../src/features/subscription/plans';

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

      // react-native-iap v14.5.0 API for consumables
      // Must specify type: 'in-app' for consumables (one-time purchases)
      const products = await RNIap.fetchProducts({
        skus: CONSUMABLE_SKUS,
        type: 'in-app' // Explicitly specify consumable type
      });

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
  * @param productId - Product SKU (e.g., 'starter.25', 'value.75', 'pro.200')
   * @param plan - The plan the user selected (starter/value/pro)
   */
  async purchaseProduct(productId: string, plan: SubscriptionPlan): Promise<void> {
    // Granular debug logging at the very start
    if (this.debugCallback) {
      this.debugCallback({
        listenerStatus: 'PURCHASE_PRODUCT CALLED',
        purchaseProductParams: {
          productId,
          plan,
          productIdType: typeof productId,
          productIdIsNull: productId === null,
          productIdIsUndefined: productId === undefined,
          productIdTrimmed: productId?.trim ? productId.trim() : 'N/A',
          productIdLength: productId?.length || 0,
          stack: (new Error().stack || '').split('\n').slice(0, 5).join('\n')
        }
      });
    }
    // Store the plan the user selected - this is our source of truth
    this.currentPurchaseAttempt = plan;
    console.log('[IAP] 🛒 === PURCHASE REQUEST ===');
    console.log('[IAP]   sku:', productId);
    console.log('[IAP]   platform:', Platform.OS);
    console.log('[IAP]   selected plan:', plan);

    // Send received parameters to debug callback FIRST
    if (this.debugCallback) {
      this.debugCallback({
        listenerStatus: 'PURCHASE REQUEST RECEIVED',
        iapServiceReceived: {
          productId: productId,
          productIdType: typeof productId,
          productIdValue: String(productId),
          productIdLength: productId?.length || 0,
          productIdIsNull: productId === null,
          productIdIsUndefined: productId === undefined,
          productIdTrimmed: productId?.trim ? productId.trim() : 'N/A',
          productIdPassesValidation: !!(productId && typeof productId === 'string' && productId.trim()),
          plan: plan
        }
      });
    }

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
      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'PURCHASE INITIATED - WAITING... ⏳'
        });
      }

      if (!productId || typeof productId !== 'string' || !productId.trim()) {
        // Send detailed validation failure info to debug callback
        if (this.debugCallback) {
          this.debugCallback({
            listenerStatus: 'VALIDATION FAILED ❌',
            validationFailure: {
              productIdFalsy: !productId,
              productIdNotString: typeof productId !== 'string',
              productIdEmptyAfterTrim: productId && typeof productId === 'string' && !productId.trim(),
              productIdRawValue: productId,
              productIdType: typeof productId
            }
          });
        }
        throw new Error('Missing purchase request configuration: productId is invalid.');
      }

      // Validation passed - send confirmation to debug
      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'VALIDATION PASSED ✅ - Creating purchase params...'
        });
      }

      // Explicit parameter logging
      console.log('[IAP] About to call requestPurchase for platform:', Platform.OS);
      console.log('[IAP] Product ID:', productId);

      // Send params to debug before calling requestPurchase
      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'CALLING requestPurchase...',
          requestPurchaseParams: {
            platform: Platform.OS,
            productId: productId,
            apiVersion: 'v14.5.0',
            willUse: Platform.OS === 'ios' ? 'iOS requestPurchase' : 'Android requestPurchase'
          }
        });
      }

      // react-native-iap v14.5.0 API - requires platform-specific request wrapper
      // API changed: now requires { request: { platform: props }, type: 'in-app' }
      console.log('[IAP] Calling requestPurchase with v14.5.0 API format');
      console.log('[IAP] Platform:', Platform.OS);
      console.log('[IAP] Product ID:', productId);

      // Construct the request according to v14.5.0 API
      // For consumables (one-time purchases), use type: 'in-app'
      const purchaseRequest: RNIap.RequestPurchaseProps = {
        type: 'in-app', // Consumables are 'in-app' type
        request: Platform.OS === 'ios'
          ? {
              // Use 'apple' (preferred) or 'ios' (deprecated but supported)
              apple: {
                sku: productId,
              }
            }
          : {
              // Use 'google' (preferred) or 'android' (deprecated but supported)
              google: {
                skus: [productId],
              }
            }
      };

      console.log('[IAP] Purchase request object:', JSON.stringify(purchaseRequest, null, 2));
      await RNIap.requestPurchase(purchaseRequest);
      console.log('[IAP] requestPurchase call completed (waiting for listener)');

      // Success/error will be handled by listeners
    } catch (error: any) {
      console.error('[IAP] Purchase failed:', error);
      console.error('[IAP] Error details:', {
        message: error?.message,
        code: error?.code,
        name: error?.name,
        stack: error?.stack
      });

      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'PURCHASE FAILED ❌',
          purchaseError: {
            message: error?.message || String(error),
            code: error?.code,
            name: error?.name,
            fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
            stack: error?.stack
          }
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
      const purchases = await RNIap.getAvailablePurchases();

      if (!purchases || purchases.length === 0) {
        throw new Error('No purchases found');
      }

      console.log('[IAP] ✅ Restored', purchases.length, 'purchases');

      for (const purchase of purchases) {
        await this.finishPurchase(purchase);
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
