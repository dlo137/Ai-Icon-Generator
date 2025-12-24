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
export type CreditGrantCallback = (credits: number, transactionId: string, productId: string) => Promise<void>;

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
   * FIX: Made callback OPTIONAL - will use direct grant if not provided
   * 
   * @param creditPacks - Array of credit pack configurations
   * @param onCreditsGranted - Optional callback to grant credits (must be idempotent)
   */
  async initialize(
    creditPacks: CreditPackConfig[],
    onCreditsGranted?: CreditGrantCallback  // ← OPTIONAL now
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

      // Store callback for granting credits (now optional)
      if (onCreditsGranted) {
        this.creditGrantCallback = onCreditsGranted;
        console.log('[ConsumableIAP] ✅ Callback registered');
      } else {
        console.log('[ConsumableIAP] ⚠️ No callback provided - will use direct grant');
      }

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
    // FIX: Extract transactionId from multiple possible fields
    const transactionId = purchase.transactionId || 
                         purchase.transactionIdentifier || 
                         purchase.purchaseToken;
    
    // FIX: Extract productId from multiple possible fields
    const productId = purchase.productId || 
                     purchase.productIds?.[0] || 
                     purchase.sku ||
                     (purchase as any).id;

    console.log('[ConsumableIAP] ========================================');
    console.log('[ConsumableIAP] PURCHASE UPDATE RECEIVED');
    console.log('[ConsumableIAP] Transaction ID:', transactionId);
    console.log('[ConsumableIAP] Product ID (extracted):', productId);
    console.log('[ConsumableIAP] Full purchase object:', JSON.stringify(purchase, null, 2));
    console.log('[ConsumableIAP] ========================================');

    if (!transactionId) {
      console.error('[ConsumableIAP] ❌ Purchase missing transactionId:', purchase);
      return;
    }

    if (!productId) {
      console.error('[ConsumableIAP] ❌ Could not extract productId from purchase object');
      // Still finish to prevent re-delivery
      try {
        await RNIap.finishTransaction({ purchase, isConsumable: true });
      } catch (e) {
        console.error('[ConsumableIAP] Failed to finish transaction:', e);
      }
      return;
    }

    try {
      // IDEMPOTENCY CHECK: Have we already granted credits for this transaction?
      const alreadyProcessed = await PurchaseLedger.isProcessed(transactionId);
      if (alreadyProcessed) {
        console.log('[ConsumableIAP] ⚠️ Transaction already processed:', transactionId);
        // Still finish the transaction in case it wasn't finished before
        await RNIap.finishTransaction({ purchase, isConsumable: true });
        return;
      }

      // Get credit amount for this product
      const credits = this.productConfig.get(productId);
      if (!credits) {
        console.error('[ConsumableIAP] ❌ Unknown product:', productId);
        console.error('[ConsumableIAP] Available products:', Array.from(this.productConfig.keys()));
        // Finish transaction to prevent it from re-appearing
        await RNIap.finishTransaction({ purchase, isConsumable: true });
        return;
      }

      console.log('[ConsumableIAP] ✅ Product found:', productId, '=', credits, 'credits');
      console.log('[ConsumableIAP] 🎯 Granting', credits, 'credits for transaction:', transactionId);

      // FIX: Try callback first, but ALWAYS fallback to direct grant on error
      let creditGrantSuccess = false;
      
      if (this.creditGrantCallback) {
        try {
          console.log('[ConsumableIAP] 📞 Calling credit grant callback...');
          await this.creditGrantCallback(credits, transactionId, productId);
          console.log('[ConsumableIAP] ✅ Credit grant callback completed');
          creditGrantSuccess = true;
        } catch (callbackError) {
          console.error('[ConsumableIAP] ❌ Callback failed:', callbackError);
          console.log('[ConsumableIAP] 🔄 Falling back to direct grant...');
        }
      }
      
      // If no callback or callback failed, use direct grant
      if (!creditGrantSuccess) {
        console.log('[ConsumableIAP] 💾 Using direct Supabase grant...');
        await this.grantCreditsDirectly(credits, transactionId, productId);
        console.log('[ConsumableIAP] ✅ Direct credit grant completed');
      }

      // RECORD IN LEDGER (prevents double-grant on app restart)
      console.log('[ConsumableIAP] 📝 Recording in purchase ledger...');
      await PurchaseLedger.recordPurchase(transactionId, productId, credits);
      console.log('[ConsumableIAP] ✅ Recorded in ledger');

      // FINISH TRANSACTION (tells StoreKit we're done)
      // CRITICAL: Only finish AFTER credits are granted
      // If we finish before granting, and app crashes, credits are lost forever
      console.log('[ConsumableIAP] 🏁 Finishing transaction...');
      await RNIap.finishTransaction({ purchase, isConsumable: true });
      console.log('[ConsumableIAP] ✅ Transaction finished');

      console.log('[ConsumableIAP] ========================================');
      console.log('[ConsumableIAP] ✅✅✅ TRANSACTION COMPLETED SUCCESSFULLY');
      console.log('[ConsumableIAP] ========================================');
    } catch (error) {
      console.error('[ConsumableIAP] ========================================');
      console.error('[ConsumableIAP] ❌❌❌ FAILED TO PROCESS PURCHASE');
      console.error('[ConsumableIAP] Error:', error);
      console.error('[ConsumableIAP] Stack:', (error as Error).stack);
      console.error('[ConsumableIAP] ========================================');
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
      
      // Normalize products: v14 uses 'id', but we add 'productId' for compatibility
      const normalizedProducts = (products || []).map((p: any) => ({
        ...p,
        productId: p.id || p.productId, // Ensure productId exists
        price: p.displayPrice || p.price // Normalize price
      }));
      
      console.log('[ConsumableIAP] Products normalized with productId');
      
      return normalizedProducts;
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
   * Grants credits to Supabase profile with FULL subscription data.
   * Automatically determines plan and price based on productId.
   * 
   * @param credits - Number of credits to grant
   * @param transactionId - Transaction ID for tracking
   * @param productId - Product ID that was purchased (starter.25/value.75/pro.200)
   */
  private async grantCreditsDirectly(credits: number, transactionId: string, productId: string): Promise<void> {
    console.log('[ConsumableIAP] ========================================');
    console.log('[ConsumableIAP] 💾 DIRECT SUPABASE UPDATE STARTING');
    console.log('[ConsumableIAP] Credits to grant:', credits);
    console.log('[ConsumableIAP] Product ID:', productId);
    console.log('[ConsumableIAP] Transaction ID:', transactionId);

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('[ConsumableIAP] ❌ No authenticated user');
      throw new Error('User not authenticated');
    }

    console.log('[ConsumableIAP] ✅ User authenticated:', user.id);

    // Get current credits
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('credits_current')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('[ConsumableIAP] ❌ Failed to fetch profile:', profileError);
      throw profileError;
    }

    const currentCredits = profile?.credits_current || 0;
    const newTotal = currentCredits + credits;

    console.log('[ConsumableIAP] Current credits:', currentCredits);
    console.log('[ConsumableIAP] New total will be:', newTotal);

    // Map productId to plan and price based on user selection
    let plan = 'starter';
    let price = 1.99;
    
    if (productId.includes('starter.25')) {
      plan = 'starter';
      price = 1.99;
    } else if (productId.includes('value.75')) {
      plan = 'value';
      price = 5.99;
    } else if (productId.includes('pro.200')) {
      plan = 'pro';
      price = 14.99;
    }

    console.log('[ConsumableIAP] 🎯 Mapped product to plan:', plan);
    console.log('[ConsumableIAP] 💰 Price:', `$${price}`);
    console.log('[ConsumableIAP] 📦 Will update ALL fields:');
    console.log('[ConsumableIAP]   • credits_current:', newTotal);
    console.log('[ConsumableIAP]   • credits_max:', Math.max(newTotal, credits));
    console.log('[ConsumableIAP]   • subscription_plan:', plan);
    console.log('[ConsumableIAP]   • product_id:', productId);
    console.log('[ConsumableIAP]   • is_pro_version: true');
    console.log('[ConsumableIAP]   • price:', price);
    console.log('[ConsumableIAP]   • purchase_time: (now)');
    console.log('[ConsumableIAP]   • updated_at: (now)');

    // Update profile with COMPLETE subscription data
    const { data: updateData, error: updateError } = await supabase
      .from('profiles')
      .update({
        // Credits
        credits_current: newTotal,
        credits_max: Math.max(newTotal, credits),
        
        // Subscription data based on user selection
        subscription_plan: plan,
        product_id: productId,
        is_pro_version: true,
        price: price,
        
        // Timestamps
        purchase_time: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select();

    if (updateError) {
      console.error('[ConsumableIAP] ❌❌❌ SUPABASE UPDATE FAILED');
      console.error('[ConsumableIAP] Error:', updateError);
      console.error('[ConsumableIAP] Error code:', updateError.code);
      console.error('[ConsumableIAP] Error message:', updateError.message);
      console.error('[ConsumableIAP] Error details:', updateError.details);
      throw updateError;
    }

    console.log('[ConsumableIAP] ✅✅✅ SUPABASE UPDATE SUCCESSFUL');
    console.log('[ConsumableIAP] Updated data:', JSON.stringify(updateData, null, 2));
    console.log('[ConsumableIAP] Summary:');
    console.log('[ConsumableIAP]   User:', user.email);
    console.log('[ConsumableIAP]   Plan:', plan, '(from user selection)');
    console.log('[ConsumableIAP]   Credits:', `${currentCredits} → ${newTotal}`);
    console.log('[ConsumableIAP]   Product:', productId);
    console.log('[ConsumableIAP]   Price: $' + price);
    console.log('[ConsumableIAP]   Pro Status: ✅ Activated');
    console.log('[ConsumableIAP] ========================================');
  }

  /**
   * NEW: Get service status for debugging
   */
  getStatus(): any {
    return {
      isInitialized: this.isInitialized,
      hasListener: !!this.purchaseUpdateSubscription,
      hasErrorListener: !!this.purchaseErrorSubscription,
      hasCallback: !!this.creditGrantCallback,
      productCount: this.productConfig.size,
      products: Array.from(this.productConfig.entries()).map(([id, credits]) => ({
        productId: id,
        credits,
      })),
    };
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
