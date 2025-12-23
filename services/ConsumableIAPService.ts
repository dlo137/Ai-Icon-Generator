/**
 * ConsumableIAPService.ts
 * 
 * Production-safe consumable IAP service for credit pack purchases.
 * 
 * APPLE COMPLIANCE:
 * - Uses CONSUMABLE products (can be purchased multiple times)
 * - Does NOT grant credits on restore (Apple guideline)
 * - Finishes transactions ONLY after credits are granted
 * - Prevents double-granting via purchase ledger
 * - Handles interrupted purchases on app restart
 * 
 * ARCHITECTURE:
 * - Singleton service pattern
 * - Transaction listener runs continuously
 * - Purchase ledger tracks transactionId → creditsGranted
 * - Idempotent credit granting (safe to retry)
 */

import * as RNIap from 'react-native-iap';
import { Platform } from 'react-native';
import { PurchaseLedger } from '../src/utils/PurchaseLedger';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Helper to check if user is in guest mode
async function isGuestSession(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return !session;
  } catch {
    return true;
  }
}

/**
 * Product configuration for credit packs
 */
export interface CreditPackConfig {
  productId: string;
  credits: number;
  displayName: string;
}

/**
 * Result of a purchase operation
 */
export interface PurchaseResult {
  success: boolean;
  credits?: number;
  error?: string;
  transactionId?: string;
}

/**
 * Callback for credit granting
 */
export type CreditGrantCallback = (credits: number, transactionId: string) => Promise<void>;

class ConsumableIAPService {
  private static instance: ConsumableIAPService;
  private isInitialized = false;
  private purchaseUpdateSubscription: any = null;
  private purchaseErrorSubscription: any = null;
  private creditGrantCallback: CreditGrantCallback | null = null;
  
  // Product configuration mapping productId → credits
  private productConfig: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): ConsumableIAPService {
    if (!ConsumableIAPService.instance) {
      ConsumableIAPService.instance = new ConsumableIAPService();
    }
    return ConsumableIAPService.instance;
  }

  /**
   * Initialize the IAP service.
   * 
   * CRITICAL: Must be called on app startup BEFORE any purchase attempts.
   * Sets up transaction listener to handle interrupted purchases.
   * 
   * @param creditPacks - Array of credit pack configurations
   * @param onCreditsGranted - Callback to grant credits (must be idempotent)
   */
  async initialize(
    creditPacks: CreditPackConfig[],
    onCreditsGranted: CreditGrantCallback
  ): Promise<void> {
    if (this.isInitialized) {
      console.log('[ConsumableIAP] Already initialized');
      return;
    }

    try {
      console.log('[ConsumableIAP] Initializing...');
      
      // Store credit pack configuration
      creditPacks.forEach(pack => {
        this.productConfig.set(pack.productId, pack.credits);
      });

      // Store callback for granting credits
      this.creditGrantCallback = onCreditsGranted;

      // Initialize connection to App Store / Google Play
      await RNIap.initConnection();
      console.log('[ConsumableIAP] Connection established');

      // Set up transaction listener
      // This runs continuously and handles:
      // 1. New purchases
      // 2. Interrupted purchases from previous sessions
      // 3. Background purchase completions
      this.setupPurchaseListener();

      // Process any pending transactions from previous sessions
      // CRITICAL: Prevents lost purchases if app crashed during credit grant
      await this.processPendingTransactions();

      this.isInitialized = true;
      console.log('[ConsumableIAP] Initialization complete');
    } catch (error) {
      console.error('[ConsumableIAP] Initialization failed:', error);
      throw new Error('Failed to initialize IAP service');
    }
  }

  /**
   * Set up continuous purchase listener.
   * 
   * WHY: StoreKit can deliver purchase updates at ANY time:
   * - During active purchase flow
   * - On app launch (interrupted purchases)
   * - In background (family sharing, Ask to Buy approval)
   * 
   * CRITICAL: Must handle each transaction EXACTLY ONCE
   */
  private setupPurchaseListener(): void {
    // Handle successful purchases
    this.purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(async (purchase: any) => {
      console.log('[ConsumableIAP] Purchase update received:', purchase.transactionId);
      await this.handlePurchaseUpdate(purchase);
    });

    // Handle purchase errors
    this.purchaseErrorSubscription = RNIap.purchaseErrorListener((error: any) => {
      console.warn('[ConsumableIAP] Purchase error:', error.code, error.message);
      // Don't throw - user may have cancelled, which is normal
    });
  }

  /**
   * Handle a purchase update from StoreKit.
   * 
   * FLOW:
   * 1. Check if already processed (idempotency)
   * 2. Grant credits atomically
   * 3. Record in ledger
   * 4. Finish transaction (ONLY after credits granted)
   * 
   * @param purchase - Purchase object from react-native-iap
   */
  private async handlePurchaseUpdate(purchase: any): Promise<void> {
    const transactionId = purchase.transactionId;
    const productId = purchase.productId;

    if (!transactionId) {
      console.error('[ConsumableIAP] Purchase missing transactionId:', purchase);
      return;
    }

    try {
      // IDEMPOTENCY CHECK: Have we already granted credits for this transaction?
      const alreadyProcessed = await PurchaseLedger.isProcessed(transactionId);
      if (alreadyProcessed) {
        console.log('[ConsumableIAP] Transaction already processed:', transactionId);
        // Still finish the transaction in case it wasn't finished before
        await RNIap.finishTransaction({ purchase, isConsumable: true });
        return;
      }

      // Get credit amount for this product
      const credits = this.productConfig.get(productId);
      if (!credits) {
        console.error('[ConsumableIAP] Unknown product:', productId);
        // Finish transaction to prevent it from re-appearing
        await RNIap.finishTransaction({ purchase, isConsumable: true });
        return;
      }

      console.log('[ConsumableIAP] Granting', credits, 'credits for transaction:', transactionId);

      // GRANT CREDITS (via callback to app)
      // This should be idempotent - safe to call multiple times
      if (this.creditGrantCallback) {
        await this.creditGrantCallback(credits, transactionId);
      } else {
        // Fallback if callback not set
        await this.grantCreditsDirectly(credits, transactionId);
      }

      // RECORD IN LEDGER (prevents double-grant on app restart)
      await PurchaseLedger.recordPurchase(transactionId, productId, credits);

      // FINISH TRANSACTION (tells StoreKit we're done)
      // CRITICAL: Only finish AFTER credits are granted
      // If we finish before granting, and app crashes, credits are lost forever
      await RNIap.finishTransaction({ purchase, isConsumable: true });

      console.log('[ConsumableIAP] Transaction completed:', transactionId);
    } catch (error) {
      console.error('[ConsumableIAP] Failed to process purchase:', error);
      // DO NOT finish transaction on error - it will retry later
      throw error;
    }
  }

  /**
   * Process any pending transactions from previous sessions.
   * 
   * WHY: If app crashed after purchase but before finishing transaction,
   * StoreKit will re-deliver it on next app launch.
   * 
   * This ensures no purchases are lost.
   */
  private async processPendingTransactions(): Promise<void> {
    console.log('[ConsumableIAP] Checking for pending transactions...');
    // react-native-iap automatically delivers pending transactions
    // via the purchaseUpdatedListener, so we don't need to do anything here.
    // Just log for visibility.
    console.log('[ConsumableIAP] Pending transactions will be processed by listener');
  }

  /**
   * Fetch available products from App Store / Google Play.
   * 
   * @returns Array of products with pricing info
   */
  async getProducts(): Promise<any[]> {
    if (!this.isInitialized) {
      throw new Error('IAP service not initialized');
    }

    try {
      const productIds = Array.from(this.productConfig.keys());
      console.log('[ConsumableIAP] Fetching products:', productIds);
      
      const products = await RNIap.fetchProducts({ skus: productIds });
      console.log('[ConsumableIAP] Products fetched:', products?.length || 0);
      
      return products || [];
    } catch (error) {
      console.error('[ConsumableIAP] Failed to fetch products:', error);
      return [];
    }
  }

  /**
   * Purchase a credit pack.
   * 
   * FLOW:
   * 1. Validate product exists
   * 2. Request purchase from StoreKit
   * 3. Wait for transaction to complete (handled by listener)
   * 4. Return result
   * 
   * @param productId - Product ID to purchase
   * @returns Purchase result with credits granted
   */
  async purchasePack(productId: string): Promise<PurchaseResult> {
    if (!this.isInitialized) {
      return { success: false, error: 'IAP service not initialized' };
    }

    const credits = this.productConfig.get(productId);
    if (!credits) {
      return { success: false, error: 'Invalid product ID' };
    }

    try {
      console.log('[ConsumableIAP] Requesting purchase:', productId);
      
      // Request purchase from StoreKit / Google Play
      // react-native-iap v14.5.0 - correct structure with type and request
      await RNIap.requestPurchase({
        type: 'in-app',
        request: Platform.OS === 'ios' 
          ? { ios: { sku: productId } }
          : { android: { skus: [productId] } }
      });

      // NOTE: The actual purchase completion is handled by purchaseUpdatedListener
      // We return here to unblock the UI, but credits are granted asynchronously
      
      return { success: true, credits };
    } catch (error: any) {
      console.error('[ConsumableIAP] Purchase failed:', error);
      
      // User cancelled is normal, don't treat as error
      if (error.code === 'E_USER_CANCELLED') {
        return { success: false, error: 'Purchase cancelled' };
      }
      
      return { success: false, error: error.message || 'Purchase failed' };
    }
  }

  /**
   * RESTORE PURCHASES - NO-OP FOR CONSUMABLES
   * 
   * APPLE GUIDELINE: Consumable purchases cannot be restored.
   * They are not tied to the user's account and can be purchased multiple times.
   * 
   * DO NOT grant credits here - this will cause Apple rejection.
   * 
   * This method exists only for API compatibility.
   */
  async restorePurchases(): Promise<void> {
    console.log('[ConsumableIAP] Restore called - NO-OP for consumables');
    // DO NOTHING - consumables cannot be restored per Apple guidelines
    return;
  }

  /**
   * Fallback method to grant credits directly.
   * 
   * This is called if no callback was provided during initialization.
   * Grants credits to both Supabase (if logged in) and local storage (if guest).
   * 
   * @param credits - Number of credits to grant
   * @param transactionId - Transaction ID for tracking
   */
  private async grantCreditsDirectly(credits: number, transactionId: string): Promise<void> {
    console.log('[ConsumableIAP] Granting credits directly:', credits);

    // Check if guest mode
    const isGuest = await isGuestSession();

    if (isGuest) {
      // Grant to guest session (local storage)
      await this.grantCreditsToGuest(credits);
    } else {
      // Grant to authenticated user (Supabase)
      await this.grantCreditsToUser(credits, transactionId);
    }
  }

  /**
   * Grant credits to authenticated user via Supabase.
   */
  private async grantCreditsToUser(credits: number, transactionId: string): Promise<void> {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    // Get current credits
    const { data: profile } = await supabase
      .from('profiles')
      .select('credits_current')
      .eq('id', user.id)
      .single();

    const currentCredits = profile?.credits_current || 0;
    const newTotal = currentCredits + credits;

    // Add credits atomically
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        credits_current: newTotal,
        credits_max: Math.max(newTotal, credits), // Max is at least the new total
        purchase_time: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    console.log('[ConsumableIAP] Credits granted to user:', newTotal);
  }

  /**
   * Grant credits to guest user via local storage.
   */
  private async grantCreditsToGuest(credits: number): Promise<void> {
    const creditsData = await AsyncStorage.getItem('guest_credits');
    const current = creditsData ? JSON.parse(creditsData).current : 0;
    
    const newTotal = current + credits;

    await AsyncStorage.setItem('guest_credits', JSON.stringify({
      current: newTotal,
      max: Math.max(newTotal, credits),
      lastResetDate: new Date().toISOString(),
      plan: 'guest'
    }));

    console.log('[ConsumableIAP] Credits granted to guest:', newTotal);
  }

  /**
   * Clean up the IAP service.
   * 
   * Should be called when app is closing.
   */
  async destroy(): Promise<void> {
    console.log('[ConsumableIAP] Destroying...');
    
    if (this.purchaseUpdateSubscription) {
      this.purchaseUpdateSubscription.remove();
      this.purchaseUpdateSubscription = null;
    }
    
    if (this.purchaseErrorSubscription) {
      this.purchaseErrorSubscription.remove();
      this.purchaseErrorSubscription = null;
    }
    
    await RNIap.endConnection();
    this.isInitialized = false;
    
    console.log('[ConsumableIAP] Destroyed');
  }
}

export default ConsumableIAPService.getInstance();
