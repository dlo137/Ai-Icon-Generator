// IAPService.ts - Production-ready IAP service for react-native-iap v14+
// Supports iOS StoreKit 2 and Android Google Play Billing

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as RNIap from 'react-native-iap';

// Product IDs - must match App Store Connect / Google Play Console exactly
const SUBSCRIPTION_SKUS = Platform.OS === 'ios'
  ? ['ai.icons.weekly', 'ai.icons.monthly', 'ai.icons.yearly']
  : ['ai.icons.weekly', 'ai.icons.monthly', 'ai.icons.yearly']; // Android uses same IDs

// Detect Expo Go environment
const isExpoGo = Constants.executionEnvironment === 'storeClient';

class IAPService {
  private static instance: IAPService;
  private isInitialized = false;
  private purchaseUpdateListener: any = null;
  private purchaseErrorListener: any = null;
  private debugCallback: ((info: any) => void) | null = null;

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
        console.log('[IAP] Purchase updated:', purchase.productId || purchase.productIds?.[0]);

        try {
          // Verify and finish the purchase
          await this.finishPurchase(purchase);

          // Notify success
          if (this.debugCallback) {
            this.debugCallback({
              status: 'success',
              productId: purchase.productId || purchase.productIds?.[0],
            });
          }
        } catch (error) {
          console.error('[IAP] Error processing purchase:', error);
        }
      }
    );

    // Listen for purchase errors
    this.purchaseErrorListener = RNIap.purchaseErrorListener(
      (error: any) => {
        console.error('[IAP] Purchase error:', error.message);

        if (this.debugCallback) {
          this.debugCallback({
            status: 'error',
            error: error.message,
          });
        }
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
          await this.finishPurchase(purchase);
        }
      }
    } catch (error) {
      console.error('[IAP] Error checking pending purchases:', error);
    }
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
   * Get available subscription products
   * Returns products from App Store Connect / Google Play Console
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
      console.log('[IAP] Fetching subscriptions:', SUBSCRIPTION_SKUS);

      // Get subscription products (v14+ API: fetchProducts with type: 'subs')
      const products = await RNIap.fetchProducts({
        skus: SUBSCRIPTION_SKUS,
        type: 'subs'
      });

      if (!products) {
        console.error('[IAP] No products returned');
        return [];
      }

      console.log('[IAP] ✅ Products loaded:', products.length);

      products.forEach((p: any) => {
        console.log('[IAP]   -', p.id, ':', p.displayPrice);
      });

      return products;
    } catch (error) {
      console.error('[IAP] Error fetching products:', error);
      throw error;
    }
  }

  /**
   * Purchase a subscription
   * @param productId - Product SKU (e.g., 'ai.icons.yearly')
   */
  async purchaseProduct(productId: string): Promise<void> {
    if (isExpoGo) {
      console.log('[IAP] Expo Go - simulating purchase');
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (this.debugCallback) {
        this.debugCallback({ status: 'success', productId });
      }
      return;
    }

    try {
      console.log('[IAP] Purchasing:', productId);

      // v14+ API: requestPurchase with type: 'subs' and platform-specific request
      // Purchases are handled by listeners (event-based, not promise-based)
      if (Platform.OS === 'ios') {
        await RNIap.requestPurchase({
          type: 'subs',
          request: {
            apple: {
              sku: productId,
            },
          },
        });
      } else {
        await RNIap.requestPurchase({
          type: 'subs',
          request: {
            google: {
              skus: [productId],
            },
          },
        });
      }

      // Success/error will be handled by listeners
    } catch (error: any) {
      console.error('[IAP] Purchase failed:', error);

      // User cancelled
      if (error.code === 'E_USER_CANCELLED') {
        throw new Error('Purchase cancelled');
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
        productId: 'ai.icons.weekly',
        title: 'Weekly Plan (Mock)',
        description: 'Mock weekly subscription',
        price: '$2.99',
        localizedPrice: '$2.99',
        currency: 'USD',
      },
      {
        productId: 'ai.icons.monthly',
        title: 'Monthly Plan (Mock)',
        description: 'Mock monthly subscription',
        price: '$5.99',
        localizedPrice: '$5.99',
        currency: 'USD',
      },
      {
        productId: 'ai.icons.yearly',
        title: 'Yearly Plan (Mock)',
        description: 'Mock yearly subscription',
        price: '$59.99',
        localizedPrice: '$59.99',
        currency: 'USD',
      },
    ];
  }
}

export default IAPService.getInstance();
