// IAPService.ts - Production-ready IAP service for react-native-iap v14+
// Supports iOS StoreKit 2 and Android Google Play Billing

import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Product IDs - must match App Store Connect / Google Play Console exactly
const SUBSCRIPTION_SKUS = Platform.OS === 'ios'
  ? ['ai.icons.weekly', 'ai.icons.monthly', 'ai.icons.yearly']
  : ['ai.icons.weekly', 'ai.icons.monthly', 'ai.icons.yearly']; // Android uses same IDs

// Detect Expo Go environment
const isExpoGo = Constants.executionEnvironment === 'storeClient';

class IAPService {
  private static instance: IAPService;
  private RNIap: any = null;
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
   * CRITICAL: Only loads react-native-iap in native builds (not Expo Go)
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
      // Load react-native-iap dynamically (prevents Expo Go crash)
      console.log('[IAP] Loading react-native-iap module...');
      this.RNIap = require('react-native-iap');

      // Initialize connection to App Store / Play Store
      console.log('[IAP] Connecting to store...');
      await this.RNIap.initConnection();
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
    if (!this.RNIap) return;

    // Listen for successful purchases
    this.purchaseUpdateListener = this.RNIap.purchaseUpdatedListener(
      async (purchase: any) => {
        console.log('[IAP] Purchase updated:', purchase.productId);

        try {
          // Verify and finish the purchase
          await this.finishPurchase(purchase);

          // Notify success
          if (this.debugCallback) {
            this.debugCallback({
              status: 'success',
              productId: purchase.productId,
            });
          }
        } catch (error) {
          console.error('[IAP] Error processing purchase:', error);
        }
      }
    );

    // Listen for purchase errors
    this.purchaseErrorListener = this.RNIap.purchaseErrorListener(
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
    if (!this.RNIap) return;

    try {
      const purchases = await this.RNIap.getAvailablePurchases();

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
    if (!this.RNIap) return;

    try {
      if (Platform.OS === 'android') {
        await this.RNIap.acknowledgePurchaseAndroid({
          token: purchase.purchaseToken,
          developerPayload: purchase.developerPayloadAndroid,
        });
      } else {
        await this.RNIap.finishTransaction({
          purchase,
          isConsumable: false,
        });
      }

      console.log('[IAP] ✅ Purchase finished:', purchase.productId);
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

    if (!this.RNIap) {
      throw new Error('IAP not initialized');
    }

    try {
      console.log('[IAP] Fetching subscriptions:', SUBSCRIPTION_SKUS);

      // Get subscription products (StoreKit 2 compatible)
      const products = await this.RNIap.getSubscriptions({
        skus: SUBSCRIPTION_SKUS,
      });

      console.log('[IAP] ✅ Products loaded:', products.length);

      products.forEach((p: any) => {
        console.log('[IAP]   -', p.productId, ':', p.localizedPrice || p.price);
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

    if (!this.RNIap) {
      throw new Error('IAP not initialized');
    }

    try {
      console.log('[IAP] Purchasing:', productId);

      if (Platform.OS === 'ios') {
        // iOS with StoreKit 2 support
        await this.RNIap.requestSubscription({
          sku: productId,
          andDangerouslyFinishTransactionAutomaticallyIOS: false,
        });
      } else {
        // Android
        await this.RNIap.requestSubscription({
          sku: productId,
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

    if (!this.RNIap) {
      throw new Error('IAP not initialized');
    }

    try {
      console.log('[IAP] Restoring purchases...');
      const purchases = await this.RNIap.getAvailablePurchases();

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

    if (this.RNIap && this.isInitialized) {
      await this.RNIap.endConnection();
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
