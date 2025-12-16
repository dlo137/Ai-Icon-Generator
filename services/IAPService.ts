import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import * as RNIap from 'react-native-iap';
import type {
  Product,
  Purchase,
  PurchaseError,
} from 'react-native-iap';

// Platform-specific product IDs
const IOS_PRODUCT_IDS = [
  'icon.yearly',
  'icon.monthly',
  'icon.weekly'
];

const ANDROID_PRODUCT_IDS = [
  'ai.icon.pro:yearly',
  'ai.icon.pro:monthly',
  'ai.icon.pro:weekly'
];

const INFLIGHT_KEY = 'iapPurchaseInFlight';

class IAPService {
  private static instance: IAPService;
  private isConnected: boolean = false;
  private hasListener: boolean = false;
  private processedIds: Set<string> = new Set();
  private lastPurchaseResult: any = null;
  private debugCallback: ((info: any) => void) | null = null;
  private currentPurchaseStartTime: number | null = null;
  private currentPurchaseProductId: string | null = null;
  private purchasePromiseResolve: ((value: void) => void) | null = null;
  private purchasePromiseReject: ((reason?: any) => void) | null = null;
  private purchaseUpdateSubscription: any = null;
  private purchaseErrorSubscription: any = null;

  private constructor() {}

  static getInstance(): IAPService {
    if (!IAPService.instance) {
      IAPService.instance = new IAPService();
    }
    return IAPService.instance;
  }

  async initialize(): Promise<boolean> {
    try {
      console.log('[IAP-SERVICE] 🚀 Initializing react-native-iap...');
      console.log('[IAP-SERVICE] 📱 Platform:', Platform.OS);
      console.log('[IAP-SERVICE] 📦 RNIap version:', require('react-native-iap/package.json').version);

      if (!this.isConnected) {
        console.log('[IAP-SERVICE] 🔌 Attempting to connect to App Store...');
        const result = await RNIap.initConnection();
        console.log('[IAP-SERVICE] ✅ Connection established:', result);
        this.isConnected = true;
      } else {
        console.log('[IAP-SERVICE] ✅ Already connected to App Store');
      }

      // Set up purchase listeners
      if (!this.hasListener) {
        console.log('[IAP-SERVICE] 👂 Setting up purchase listeners...');
        this.setupPurchaseListeners();
        this.hasListener = true;
        console.log('[IAP-SERVICE] ✅ Purchase listeners active');
      } else {
        console.log('[IAP-SERVICE] ✅ Purchase listeners already active');
      }

      // Clear any pending transactions on iOS
      if (Platform.OS === 'ios') {
        console.log('[IAP-SERVICE] 🧹 Clearing pending iOS transactions...');
        await RNIap.clearTransactionIOS();
        console.log('[IAP-SERVICE] ✅ iOS transactions cleared');
      }

      // Check for unfinished transactions (important for Android)
      console.log('[IAP-SERVICE] 🔍 Checking for pending purchases...');
      await this.checkForPendingPurchases();

      console.log('[IAP-SERVICE] ✅ Initialization complete!');
      console.log('[IAP-SERVICE] 📊 Final status:', {
        isConnected: this.isConnected,
        hasListener: this.hasListener
      });

      return true;
    } catch (error: any) {
      console.error('[IAP-SERVICE] ❌ CRITICAL: Failed to initialize');
      console.error('[IAP-SERVICE] ❌ Error:', error?.message || 'Unknown error');
      console.error('[IAP-SERVICE] ❌ Full error:', JSON.stringify(error, null, 2));
      this.isConnected = false;
      this.hasListener = false;
      return false;
    }
  }

  private setupPurchaseListeners() {
    // Purchase update listener
    this.purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
      async (purchase: Purchase) => {
        console.log('[IAP-SERVICE] 🎉 Purchase updated:', purchase);
        this.lastPurchaseResult = purchase;

        if (this.debugCallback) {
          this.debugCallback({
            lastPurchase: purchase,
            listenerStatus: 'PURCHASE RECEIVED ✅'
          });
        }

        await this.handlePurchaseUpdate(purchase);
      }
    );

    // Purchase error listener
    this.purchaseErrorSubscription = RNIap.purchaseErrorListener(
      (error: PurchaseError) => {
        console.error('[IAP-SERVICE] Purchase error:', error);

        if (this.debugCallback) {
          this.debugCallback({
            listenerStatus: `PURCHASE ERROR ❌: ${error.message}`
          });
        }

        // Clear purchase tracking
        this.currentPurchaseStartTime = null;
        this.currentPurchaseProductId = null;
        AsyncStorage.setItem(INFLIGHT_KEY, 'false');

        // Reject the purchase promise
        if (this.purchasePromiseReject) {
          this.purchasePromiseReject(new Error(error.message));
          this.purchasePromiseResolve = null;
          this.purchasePromiseReject = null;
        }
      }
    );

    console.log('[IAP-SERVICE] Purchase listeners set up successfully');
  }

  private async handlePurchaseUpdate(purchase: Purchase) {
    try {
      console.log('[IAP-SERVICE] Processing purchase update:', {
        productId: purchase.productId,
        transactionId: purchase.transactionId,
        purchaseToken: purchase.purchaseToken
      });

      await this.processPurchase(purchase, 'listener');

      // Resolve the purchase promise
      if (this.purchasePromiseResolve) {
        console.log('[IAP-SERVICE] Resolving purchase promise (success)');
        this.purchasePromiseResolve();
        this.purchasePromiseResolve = null;
        this.purchasePromiseReject = null;
      }

    } catch (error) {
      console.error('[IAP-SERVICE] Error handling purchase update:', error);

      if (this.purchasePromiseReject) {
        this.purchasePromiseReject(error);
        this.purchasePromiseResolve = null;
        this.purchasePromiseReject = null;
      }
    }
  }

  private async checkForPendingPurchases() {
    try {
      console.log('[IAP-SERVICE] Checking for pending purchases...');
      const purchases = await RNIap.getAvailablePurchases();

      if (purchases && purchases.length > 0) {
        console.log(`[IAP-SERVICE] Found ${purchases.length} pending purchases`);

        for (const purchase of purchases) {
          const txId = purchase.transactionId;
          if (txId && !this.processedIds.has(txId)) {
            console.log('[IAP-SERVICE] Processing pending purchase:', purchase.productId);
            await this.processPurchase(purchase, 'orphan');
          }
        }
      } else {
        console.log('[IAP-SERVICE] No pending purchases found');
      }
    } catch (error) {
      console.error('[IAP-SERVICE] Error checking pending purchases:', error);
    }
  }

  private async processPurchase(
    purchase: Purchase,
    source: 'listener' | 'restore' | 'orphan'
  ) {
    const txId = purchase.transactionId;
    console.log(`[IAP-SERVICE] Processing purchase from ${source}:`, {
      productId: purchase.productId,
      transactionId: txId,
    });

    if (!txId || this.processedIds.has(txId)) {
      console.log(`[IAP-SERVICE] Skipping already processed transaction: ${txId}`);
      return;
    }

    this.processedIds.add(txId);

    try {
      // Map productId to plan
      let planToUse: 'yearly' | 'monthly' | 'weekly' = 'yearly';
      const productId = purchase.productId.toLowerCase();

      if (productId.includes('monthly')) {
        planToUse = 'monthly';
      } else if (productId.includes('weekly')) {
        planToUse = 'weekly';
      }

      const subscriptionId = `${purchase.productId}_${Date.now()}`;
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      console.log(`[IAP-SERVICE] Purchase details:`, {
        planToUse,
        subscriptionId,
        userId: userId ? 'found' : 'missing',
        source
      });

      // Determine if we should grant entitlement
      const inFlight = (await AsyncStorage.getItem(INFLIGHT_KEY)) === 'true';
      const shouldEntitle =
        (source === 'listener' && inFlight) ||
        source === 'restore' ||
        source === 'orphan';

      console.log(`[IAP-SERVICE] Should entitle: ${shouldEntitle}`);

      if (shouldEntitle && userId) {
        console.log('[IAP-SERVICE] Granting entitlement...');

        // Determine credits based on plan
        let credits_max = 0;
        switch (planToUse) {
          case 'yearly': credits_max = 90; break;
          case 'monthly': credits_max = 75; break;
          case 'weekly': credits_max = 10; break;
        }

        // Update Supabase profile
        const now = new Date().toISOString();

        // Calculate subscription end date based on plan
        const endDate = new Date();
        if (planToUse === 'weekly') {
          endDate.setDate(endDate.getDate() + 7);
        } else if (planToUse === 'monthly') {
          endDate.setMonth(endDate.getMonth() + 1);
        } else if (planToUse === 'yearly') {
          endDate.setFullYear(endDate.getFullYear() + 1);
        }

        // Determine price based on plan
        let price = 0;
        if (planToUse === 'weekly') {
          price = 2.99;
        } else if (planToUse === 'monthly') {
          price = 5.99;
        } else if (planToUse === 'yearly') {
          price = 59.99;
        }

        // Get user's name/email for the name field
        const userName = userData?.user?.user_metadata?.full_name ||
                        userData?.user?.email?.split('@')[0] ||
                        'User';

        const updateData = {
          subscription_plan: planToUse,
          subscription_id: subscriptionId,
          is_pro_version: true,
          credits_current: credits_max,
          credits_max: credits_max,
          subscription_start_date: now,
          subscription_end_date: endDate.toISOString(),
          last_credit_reset: now,
          purchase_time: now,
          product_id: purchase.productId,
          price: price,
          name: userName,
          email: userData?.user?.email || null
        };

        console.log('[IAP-SERVICE] Updating profile with data:', updateData);

        const { error: supabaseError } = await supabase.from('profiles')
          .update(updateData)
          .eq('id', userId);

        if (supabaseError) {
          console.error('[IAP-SERVICE] Supabase update error:', supabaseError);
          throw supabaseError;
        }

        // Update AsyncStorage
        await AsyncStorage.multiSet([
          ['profile.subscription_plan', planToUse],
          ['profile.subscription_id', subscriptionId],
          ['profile.is_pro_version', 'true'],
        ]);

        console.log('[IAP-SERVICE] Entitlement granted successfully');
      }

      // Acknowledge/finish the purchase
      console.log('[IAP-SERVICE] Finishing transaction...');
      if (Platform.OS === 'android') {
        // On Android, acknowledge the purchase
        if (purchase.purchaseToken) {
          await RNIap.acknowledgePurchaseAndroid(purchase.purchaseToken);
        } else {
          console.error('[IAP-SERVICE] ❌ No purchaseToken available for Android purchase');
        }
      } else {
        // On iOS, finish the transaction
        await RNIap.finishTransaction({ purchase, isConsumable: false });
      }

      // Navigate and clear flag for deliberate purchases
      if (shouldEntitle) {
        console.log('[IAP-SERVICE] Clearing in-flight flag...');
        await AsyncStorage.setItem(INFLIGHT_KEY, 'false');

        // Clear purchase session tracking on success
        this.currentPurchaseStartTime = null;
        this.currentPurchaseProductId = null;

        console.log(`[IAP-SERVICE] ✅ Purchase complete from ${source}!`);

        if (this.debugCallback) {
          this.debugCallback({
            listenerStatus: 'PURCHASE SUCCESS! ✅',
            shouldNavigate: true,
            purchaseComplete: true
          });
        }
      }

    } catch (error) {
      console.error(`[IAP-SERVICE] Error processing purchase:`, error);
      await AsyncStorage.setItem(INFLIGHT_KEY, 'false');
      throw error;
    }
  }

  async getProducts(): Promise<any[]> {
    console.log('[IAP-SERVICE] 🔍 getProducts() called');

    if (!this.isConnected) {
      console.log('[IAP-SERVICE] Not connected, initializing first...');
      await this.initialize();
    }

    try {
      const productIds = Platform.OS === 'ios' ? IOS_PRODUCT_IDS : ANDROID_PRODUCT_IDS;
      console.log('[IAP-SERVICE] 📱 Platform:', Platform.OS);
      console.log('[IAP-SERVICE] 🎯 Requesting product IDs:', productIds);
      console.log('[IAP-SERVICE] 🔌 Connection status:', {
        isConnected: this.isConnected,
        hasListener: this.hasListener
      });

      let products: any[] = [];

      // Try fetchProducts with type 'subs' first (for auto-renewable subscriptions)
      try {
        console.log('[IAP-SERVICE] 📞 Attempting fetchProducts() with type: subs...');
        const result = await RNIap.fetchProducts({ skus: productIds, type: 'subs' });
        products = result || [];
        console.log('[IAP-SERVICE] ✅ fetchProducts(subs) returned:', products.length, 'products');
      } catch (subError: any) {
        console.warn('[IAP-SERVICE] ⚠️ fetchProducts(subs) failed:', subError.message);
        console.log('[IAP-SERVICE] 📞 Trying fetchProducts() with type: in-app as fallback...');

        // Fallback to fetchProducts with in-app type (for non-consumables or if subscriptions fail)
        try {
          const result = await RNIap.fetchProducts({ skus: productIds, type: 'in-app' });
          products = result || [];
          console.log('[IAP-SERVICE] ✅ fetchProducts(in-app) returned:', products.length, 'products');
        } catch (prodError: any) {
          console.error('[IAP-SERVICE] ❌ fetchProducts(in-app) also failed:', prodError.message);

          // Last resort: try without type parameter
          console.log('[IAP-SERVICE] 📞 Final attempt: fetchProducts() without type...');
          const result = await RNIap.fetchProducts({ skus: productIds });
          products = result || [];
          console.log('[IAP-SERVICE] ✅ fetchProducts() returned:', products.length, 'products');
        }
      }

      console.log('[IAP-SERVICE] ✅ Raw products response:', JSON.stringify(products, null, 2));
      console.log('[IAP-SERVICE] ✅ Final products count:', products.length);

      if (products.length === 0) {
        console.warn('[IAP-SERVICE] ⚠️ WARNING: Zero products returned from App Store!');
        console.warn('[IAP-SERVICE] ⚠️ Possible reasons:');
        console.warn('[IAP-SERVICE] ⚠️ 1. Products not created in App Store Connect');
        console.warn('[IAP-SERVICE] ⚠️ 2. Product IDs mismatch - Expected:', productIds);
        console.warn('[IAP-SERVICE] ⚠️ 3. Bundle ID mismatch');
        console.warn('[IAP-SERVICE] ⚠️ 4. Paid Apps Agreement not signed');
        console.warn('[IAP-SERVICE] ⚠️ 5. Products not approved/available in App Store Connect');
        console.warn('[IAP-SERVICE] ⚠️ 6. Using wrong Apple ID for testing (not Sandbox tester)');
      } else {
        products.forEach((product, index) => {
          console.log(`[IAP-SERVICE] Product ${index + 1}:`, {
            productId: (product as any).productId || product.id,
            title: product.title,
            price: product.price,
            localizedPrice: (product as any).localizedPrice,
            currency: product.currency,
            type: (product as any).type
          });
        });
      }

      return products;
    } catch (err: any) {
      console.error('[IAP-SERVICE] ❌ CRITICAL ERROR fetching products');
      console.error('[IAP-SERVICE] ❌ Error type:', typeof err);
      console.error('[IAP-SERVICE] ❌ Error message:', err?.message || 'Unknown');
      console.error('[IAP-SERVICE] ❌ Error code:', err?.code || 'No code');
      console.error('[IAP-SERVICE] ❌ Full error object:', JSON.stringify(err, null, 2));

      // Provide specific guidance based on error
      if (err?.message?.includes('E_IAP_NOT_AVAILABLE')) {
        console.error('[IAP-SERVICE] ❌ IAP not available on this device/simulator');
        console.error('[IAP-SERVICE] ❌ Note: IAP does not work in iOS Simulator - use real device');
      } else if (err?.message?.includes('E_NETWORK_ERROR')) {
        console.error('[IAP-SERVICE] ❌ Network error - check internet connection');
      } else if (err?.message?.includes('E_UNKNOWN')) {
        console.error('[IAP-SERVICE] ❌ Unknown error - possible App Store Connect issue');
      } else if (err?.message?.includes('E_SERVICE_ERROR')) {
        console.error('[IAP-SERVICE] ❌ Service error - App Store might be temporarily unavailable');
      } else if (err?.message?.includes('E_RECEIPT_FAILED')) {
        console.error('[IAP-SERVICE] ❌ Receipt validation failed');
      }

      return [];
    }
  }

  async purchaseProduct(productId: string): Promise<void> {
    if (!this.isConnected) {
      console.log('[IAP-SERVICE] Not connected, initializing...');
      await this.initialize();
    }

    // Track current purchase session
    this.currentPurchaseStartTime = Date.now();
    this.currentPurchaseProductId = productId;

    console.log(`[IAP-SERVICE] Setting in-flight flag and attempting purchase: ${productId}`);
    await AsyncStorage.setItem(INFLIGHT_KEY, 'true');

    // Create a promise that will be resolved/rejected by the purchase listener
    const purchasePromise = new Promise<void>((resolve, reject) => {
      this.purchasePromiseResolve = resolve;
      this.purchasePromiseReject = reject;

      // Set a timeout
      setTimeout(() => {
        if (this.purchasePromiseReject) {
          this.purchasePromiseReject(new Error('Purchase timeout'));
          this.purchasePromiseResolve = null;
          this.purchasePromiseReject = null;
        }
      }, 60000); // 60 second timeout
    });

    try {
      console.log('[IAP-SERVICE] Requesting purchase...');
      console.log('[IAP-SERVICE] Using requestPurchase() with productId:', productId);

      // In v14, requestPurchase handles both subscriptions and products
      // Use platform-specific request format
      if (Platform.OS === 'ios') {
        await RNIap.requestPurchase({
          type: 'subs',
          request: {
            ios: {
              sku: productId,
              quantity: 1
            }
          }
        });
      } else {
        await RNIap.requestPurchase({
          type: 'subs',
          request: {
            google: { skus: [productId] }
          }
        });
      }
      console.log('[IAP-SERVICE] requestPurchase() initiated');

      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'PURCHASE INITIATED - WAITING... ⏳'
        });
      }

      // Wait for the purchase to complete via listener
      console.log('[IAP-SERVICE] Waiting for purchase completion...');
      await purchasePromise;
      console.log('[IAP-SERVICE] Purchase completed successfully!');

    } catch (error: any) {
      console.error('[IAP-SERVICE] Purchase failed:', error);
      await AsyncStorage.setItem(INFLIGHT_KEY, 'false');

      // Clear session tracking on error
      this.currentPurchaseStartTime = null;
      this.currentPurchaseProductId = null;

      // Clear promise handlers
      this.purchasePromiseResolve = null;
      this.purchasePromiseReject = null;

      if (this.debugCallback) {
        this.debugCallback({
          listenerStatus: 'PURCHASE FAILED ❌'
        });
      }

      // Check if user cancelled
      if (error?.code === 'E_USER_CANCELLED' || error?.message?.includes('cancel')) {
        console.log('[IAP-SERVICE] User cancelled purchase');
        throw new Error('User cancelled purchase');
      }

      throw error;
    }
  }

  async restorePurchases(): Promise<Purchase[]> {
    if (!this.isConnected) {
      await this.initialize();
    }

    try {
      await AsyncStorage.setItem(INFLIGHT_KEY, 'true');
      console.log('[IAP-SERVICE] Restoring purchases...');

      const purchases = await RNIap.getAvailablePurchases();

      if (!purchases || purchases.length === 0) {
        await AsyncStorage.setItem(INFLIGHT_KEY, 'false');
        throw new Error('No previous purchases found');
      }

      console.log(`[IAP-SERVICE] Found ${purchases.length} purchases to restore`);

      for (const purchase of purchases) {
        await this.processPurchase(purchase, 'restore');
      }

      await AsyncStorage.setItem(INFLIGHT_KEY, 'false');
      return purchases;
    } catch (error) {
      await AsyncStorage.setItem(INFLIGHT_KEY, 'false');
      throw error;
    }
  }

  async checkForOrphanedTransactions(): Promise<void> {
    if (!this.isConnected) {
      await this.initialize();
    }

    await this.checkForPendingPurchases();
  }

  isAvailable(): boolean {
    // react-native-iap works on both iOS and Android
    return true;
  }

  setDebugCallback(callback: (info: any) => void) {
    this.debugCallback = callback;
  }

  getLastPurchaseResult() {
    return this.lastPurchaseResult;
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      hasListener: this.hasListener,
    };
  }

  async cleanup() {
    if (this.purchaseUpdateSubscription) {
      this.purchaseUpdateSubscription.remove();
      this.purchaseUpdateSubscription = null;
    }

    if (this.purchaseErrorSubscription) {
      this.purchaseErrorSubscription.remove();
      this.purchaseErrorSubscription = null;
    }

    if (this.isConnected) {
      await RNIap.endConnection();
      this.isConnected = false;
    }

    this.hasListener = false;
  }
}

export default IAPService.getInstance();
