import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import * as RNIap from 'react-native-iap';
import Constants from 'expo-constants';
import type {
  Product,
  ProductPurchase,
  PurchaseError,
  Subscription,
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

// Development mode detection
const isDevelopment = () => {
  // Check if running in Expo Go
  const isExpoGo = Constants.appOwnership === 'expo';
  // Check if in __DEV__ mode
  const isDevMode = __DEV__;

  return isExpoGo || isDevMode;
};

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
  private isDevMode: boolean = isDevelopment();

  private constructor() {}

  static getInstance(): IAPService {
    if (!IAPService.instance) {
      IAPService.instance = new IAPService();
    }
    return IAPService.instance;
  }

  async initialize(): Promise<boolean> {
    try {
      // In development mode, skip real IAP initialization
      if (this.isDevMode) {
        console.log('[IAP-SERVICE] 🧪 Running in DEVELOPMENT MODE - Using mock IAP');
        this.isConnected = true;
        this.hasListener = true;
        return true;
      }

      console.log('[IAP-SERVICE] Initializing react-native-iap...');

      if (!this.isConnected) {
        const result = await RNIap.initConnection();
        console.log('[IAP-SERVICE] Connection result:', result);
        this.isConnected = true;
      }

      // Set up purchase listeners
      if (!this.hasListener) {
        console.log('[IAP-SERVICE] Setting up purchase listeners...');
        this.setupPurchaseListeners();
        this.hasListener = true;
      }

      // Clear any pending transactions on iOS
      if (Platform.OS === 'ios') {
        await RNIap.clearTransactionIOS();
      }

      // Check for unfinished transactions (important for Android)
      await this.checkForPendingPurchases();

      return true;
    } catch (error) {
      console.error('[IAP-SERVICE] Failed to initialize:', error);
      return false;
    }
  }

  private setupPurchaseListeners() {
    // Purchase update listener
    this.purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
      async (purchase: ProductPurchase) => {
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

  private async handlePurchaseUpdate(purchase: ProductPurchase) {
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
          if (!this.processedIds.has(txId)) {
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
    purchase: ProductPurchase,
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

        const updateData = {
          subscription_plan: planToUse,
          subscription_id: subscriptionId,
          is_pro_version: true,
          credits_current: credits_max,
          credits_max: credits_max,
          subscription_start_date: now,
          subscription_end_date: endDate.toISOString(),
          last_credit_reset: now
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
        await RNIap.acknowledgePurchaseAndroid(purchase.purchaseToken);
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

  private getMockProducts(): Product[] {
    console.log('[IAP-SERVICE] 🧪 Returning mock products for development');
    const productIds = Platform.OS === 'ios' ? IOS_PRODUCT_IDS : ANDROID_PRODUCT_IDS;

    return productIds.map((productId) => ({
      productId,
      title: productId.includes('yearly') ? 'Yearly Plan' :
             productId.includes('monthly') ? 'Monthly Plan' : 'Weekly Plan',
      description: 'Mock subscription for development',
      price: productId.includes('yearly') ? '$59.99' :
             productId.includes('monthly') ? '$5.99' : '$2.99',
      currency: 'USD',
      type: 'subs' as const,
      localizedPrice: productId.includes('yearly') ? '$59.99' :
                      productId.includes('monthly') ? '$5.99' : '$2.99',
      subscriptionPeriodNumberIOS: '1',
      subscriptionPeriodUnitIOS: productId.includes('yearly') ? 'YEAR' :
                                 productId.includes('monthly') ? 'MONTH' : 'WEEK',
    } as Product));
  }

  async getProducts(): Promise<Product[]> {
    if (!this.isConnected) {
      await this.initialize();
    }

    // In development mode, return mock products
    if (this.isDevMode) {
      return this.getMockProducts();
    }

    try {
      const productIds = Platform.OS === 'ios' ? IOS_PRODUCT_IDS : ANDROID_PRODUCT_IDS;
      console.log('[IAP-SERVICE] Fetching products for', Platform.OS, ':', productIds);

      // Get subscriptions (most IAP products are subscriptions)
      const products = await RNIap.getSubscriptions({ skus: productIds });
      console.log('[IAP-SERVICE] Products loaded:', products.length);

      return products;
    } catch (err) {
      console.error('[IAP-SERVICE] Error fetching products:', err);
      return [];
    }
  }

  private async simulatePurchase(productId: string): Promise<void> {
    console.log('[IAP-SERVICE] 🧪 Simulating purchase in development mode:', productId);

    // Simulate a slight delay for realism
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Determine plan and credits based on productId
    let planToUse: 'yearly' | 'monthly' | 'weekly' = 'yearly';
    const productIdLower = productId.toLowerCase();

    if (productIdLower.includes('monthly')) {
      planToUse = 'monthly';
    } else if (productIdLower.includes('weekly')) {
      planToUse = 'weekly';
    }

    let credits_max = 0;
    switch (planToUse) {
      case 'yearly': credits_max = 90; break;
      case 'monthly': credits_max = 75; break;
      case 'weekly': credits_max = 10; break;
    }

    // Get current user
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    if (!userId) {
      console.error('[IAP-SERVICE] 🧪 No user found for mock purchase');
      throw new Error('User not authenticated');
    }

    // Update Supabase profile
    const now = new Date().toISOString();
    const mockSubscriptionId = `dev_${productId}_${Date.now()}`;

    // Calculate subscription end date based on plan
    const endDate = new Date();
    if (planToUse === 'weekly') {
      endDate.setDate(endDate.getDate() + 7);
    } else if (planToUse === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (planToUse === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const updateData = {
      subscription_plan: planToUse,
      subscription_id: mockSubscriptionId,
      is_pro_version: true,
      credits_current: credits_max,
      credits_max: credits_max,
      subscription_start_date: now,
      subscription_end_date: endDate.toISOString(),
      last_credit_reset: now
    };

    console.log('[IAP-SERVICE] 🧪 Updating profile with mock data:', updateData);

    const { error: supabaseError } = await supabase.from('profiles')
      .update(updateData)
      .eq('id', userId);

    if (supabaseError) {
      console.error('[IAP-SERVICE] 🧪 Supabase update error:', supabaseError);
      throw supabaseError;
    }

    // Update AsyncStorage
    await AsyncStorage.multiSet([
      ['profile.subscription_plan', planToUse],
      ['profile.subscription_id', mockSubscriptionId],
      ['profile.is_pro_version', 'true'],
    ]);

    console.log('[IAP-SERVICE] 🧪 Mock purchase completed successfully!');

    // Trigger debug callback
    if (this.debugCallback) {
      this.debugCallback({
        listenerStatus: 'PURCHASE SUCCESS! ✅ (DEV MODE)',
        shouldNavigate: true,
        purchaseComplete: true
      });
    }
  }

  async purchaseProduct(productId: string): Promise<void> {
    if (!this.isConnected) {
      console.log('[IAP-SERVICE] Not connected, initializing...');
      await this.initialize();
    }

    // In development mode, simulate the purchase
    if (this.isDevMode) {
      try {
        await this.simulatePurchase(productId);
        return;
      } catch (error) {
        console.error('[IAP-SERVICE] 🧪 Mock purchase failed:', error);
        throw error;
      }
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

      if (Platform.OS === 'android') {
        await RNIap.requestSubscription({ sku: productId });
      } else {
        await RNIap.requestSubscription({ sku: productId });
      }

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

  async restorePurchases(): Promise<ProductPurchase[]> {
    if (!this.isConnected) {
      await this.initialize();
    }

    // In development mode, simulate restore
    if (this.isDevMode) {
      console.log('[IAP-SERVICE] 🧪 Mock restore in development mode - no purchases to restore');
      throw new Error('No previous purchases found');
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
      isDevMode: this.isDevMode,
    };
  }

  isDevelopmentMode(): boolean {
    return this.isDevMode;
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
