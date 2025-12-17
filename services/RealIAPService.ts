// RealIAPService.ts - Real IAP implementation using react-native-iap
// CRITICAL: react-native-iap is loaded ONLY inside initialize() to prevent Expo Go crashes

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import type { IIAPService } from './IIAPService';

// Import types separately (these don't cause runtime issues)
import type {
  Purchase,
  PurchaseError,
} from 'react-native-iap';

const INFLIGHT_KEY = 'iapPurchaseInFlight';

class RealIAPService implements IIAPService {
  private static instance: RealIAPService;

  // CRITICAL: RNIap is loaded INSIDE initialize(), not at file scope
  // This prevents Metro from resolving NitroModules in Expo Go
  private RNIap: any = null;

  private isConnected: boolean = false;
  private hasListener: boolean = false;
  private processedIds: Set<string> = new Set();
  private lastPurchaseResult: any = null;
  private debugCallback: ((info: any) => void) | null = null;
  private purchasePromiseResolve: ((value: void) => void) | null = null;
  private purchasePromiseReject: ((reason?: any) => void) | null = null;
  private purchaseUpdateSubscription: any = null;
  private purchaseErrorSubscription: any = null;

  private constructor() {}

  static getInstance(): RealIAPService {
    if (!RealIAPService.instance) {
      RealIAPService.instance = new RealIAPService();
    }
    return RealIAPService.instance;
  }

  async initialize(): Promise<boolean> {
    try {
      // CRITICAL FIX: Load react-native-iap HERE, not at file scope
      // This prevents NitroModules from loading in Expo Go
      if (!this.RNIap) {
        console.log('[IAP-SERVICE] 🔌 Loading react-native-iap module...');
        this.RNIap = require('react-native-iap');
        console.log('[IAP-SERVICE] ✅ react-native-iap loaded successfully');
      }

      console.log('[IAP-SERVICE] 🚀 Initializing react-native-iap...');
      console.log('[IAP-SERVICE] 📱 Platform:', Platform.OS);
      console.log('[IAP-SERVICE] 📦 RNIap version:', require('react-native-iap/package.json').version);

      if (!this.isConnected) {
        console.log('[IAP-SERVICE] 🔌 Attempting to connect to App Store...');
        const result = await this.RNIap.initConnection();
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

      // NOTE: clearTransactionIOS() removed from initialization
      // It can reset StoreKit session on iOS 17+ and cause empty product responses
      // Only call this when handling stuck transactions, not on every launch

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
    this.purchaseUpdateSubscription = this.RNIap.purchaseUpdatedListener(
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
    this.purchaseErrorSubscription = this.RNIap.purchaseErrorListener(
      (error: PurchaseError) => {
        console.error('[IAP-SERVICE] Purchase error:', error);

        if (this.debugCallback) {
          this.debugCallback({
            listenerStatus: `PURCHASE ERROR ❌: ${error.message}`
          });
        }

        // Clear purchase tracking
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
      const purchases = await this.RNIap.getAvailablePurchases();

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
        const updateData = {
          subscription_plan: planToUse,
          subscription_id: subscriptionId,
          is_pro_version: true,
          product_id: purchase.productId,
          purchase_time: now,
          credits_current: credits_max,
          credits_max: credits_max,
          subscription_start_date: now,
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
        await this.RNIap.acknowledgePurchaseAndroid(purchase.purchaseToken!);
      } else {
        // On iOS, finish the transaction
        await this.RNIap.finishTransaction({ purchase, isConsumable: false });
      }

      // Navigate and clear flag for deliberate purchases
      if (shouldEntitle) {
        console.log('[IAP-SERVICE] Clearing in-flight flag...');
        await AsyncStorage.setItem(INFLIGHT_KEY, 'false');

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
    if (!this.RNIap) {
      throw new Error('IAP not initialized');
    }

    const skus = Platform.OS === 'ios'
      ? ['icon.weekly', 'icon.monthly', 'icon.yearly']
      : ['ai.icon.pro:weekly', 'ai.icon.pro:monthly', 'ai.icon.pro:yearly'];

    console.log('[IAP] Fetching subscriptions:', skus);

    const products = await this.RNIap.getSubscriptions({ skus });

    console.log('[IAP] Subscriptions returned:', products.length);

    return products;
  }

  async purchaseProduct(productId: string): Promise<void> {
    if (!this.isConnected) {
      console.log('[IAP-SERVICE] Not connected, initializing...');
      await this.initialize();
    }

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
        // Android: Use basic subscription request
        await this.RNIap.requestSubscription({ sku: productId });
      } else {
        // iOS: CRITICAL - Add StoreKit 2 flag for react-native-iap v14+
        await this.RNIap.requestSubscription({
          sku: productId,
          andDangerouslyFinishTransactionAutomaticallyIOS: false
        });
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

      const purchases = await this.RNIap.getAvailablePurchases();

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

    if (this.isConnected && this.RNIap) {
      await this.RNIap.endConnection();
      this.isConnected = false;
    }

    this.hasListener = false;
  }
}

export default RealIAPService.getInstance();
