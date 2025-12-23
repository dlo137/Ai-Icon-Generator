/**
 * useConsumableIAP.ts
 * 
 * React hook for consumable IAP purchases.
 * 
 * PURPOSE:
 * Provides a clean React interface to ConsumableIAPService.
 * Manages state for UI (loading, products, errors).
 * 
 * USAGE IN UI:
 * ```tsx
 * const { products, isLoading, purchase, error } = useConsumableIAP([
 *   { productId: 'starter.25', credits: 15, displayName: 'Starter Pack' },
 *   { productId: 'value.75', credits: 45, displayName: 'Value Pack' },
 *   { productId: 'pro.200', credits: 120, displayName: 'Pro Pack' },
 * ]);
 * 
 * // In button handler:
 * await purchase('starter.25');
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as RNIap from 'react-native-iap';
import ConsumableIAPService from '../services/ConsumableIAPService';
import { CreditPackConfig, PurchaseResult } from '../services/ConsumableIAPService';
import { useCredits } from '../src/contexts/CreditsContext';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface UseConsumableIAPResult {
  /** Available products from App Store / Google Play */
  products: any[];
  
  /** Loading state for product fetch */
  isLoading: boolean;
  
  /** Currently processing purchase (productId) */
  purchasingProduct: string | null;
  
  /** Last error message */
  error: string | null;
  
  /** Function to purchase a credit pack */
  purchase: (productId: string) => Promise<PurchaseResult>;
  
  /** Function to manually refresh products */
  refreshProducts: () => Promise<void>;
}

/**
 * Hook to manage consumable IAP purchases.
 * 
 * @param creditPacks - Configuration for available credit packs
 * @returns IAP state and purchase function
 */
export function useConsumableIAP(creditPacks: CreditPackConfig[]): UseConsumableIAPResult {
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [purchasingProduct, setPurchasingProduct] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const { refreshCredits } = useCredits();
  const isInitializedRef = useRef(false);

  /**
   * Initialize IAP service on mount.
   * 
   * CRITICAL: This sets up the transaction listener that handles purchases.
   */
  useEffect(() => {
    if (isInitializedRef.current) {
      return;
    }

    const initializeIAP = async () => {
      try {
        console.log('[useConsumableIAP] Initializing IAP service...');
        
        // Initialize with credit grant callback
        await ConsumableIAPService.initialize(creditPacks, async (credits: number, transactionId: string) => {
          console.log('[useConsumableIAP] Credits granted via callback:', credits, transactionId);
          
          try {
            // Check if user is authenticated
            const { data: { session } } = await supabase.auth.getSession();
            
            if (session?.user) {
              // Grant credits to authenticated user
              const { data: profile } = await supabase
                .from('profiles')
                .select('credits_current, product_id')
                .eq('id', session.user.id)
                .single();

              const currentCredits = profile?.credits_current || 0;
              const newTotal = currentCredits + credits;

              // Get the product ID and price from credit packs
              const creditPack = creditPacks.find(p => p.credits === credits);
              const productId = creditPack?.productId || profile?.product_id;
              
              // Determine subscription plan and price based on product ID
              let subscriptionPlan = 'pro';
              let price = '$14.99';
              
              if (productId === 'starter.25') {
                subscriptionPlan = 'starter';
                price = '$1.99';
              } else if (productId === 'value.75') {
                subscriptionPlan = 'value';
                price = '$5.99';
              } else if (productId === 'pro.200') {
                subscriptionPlan = 'pro';
                price = '$14.99';
              }

              // Update profile with new credits
              console.log('[useConsumableIAP] Updating Supabase profile...');
              
              const { data: updateData, error: updateError } = await supabase
                .from('profiles')
                .update({
                  credits_current: newTotal,
                  credits_max: Math.max(newTotal, credits),
                  purchase_time: new Date().toISOString(),
                  product_id: productId,
                  subscription_plan: subscriptionPlan,
                  price: price,
                  is_pro_version: true,
                })
                .eq('id', session.user.id)
                .select();

              if (updateError) {
                console.error('[useConsumableIAP] Failed to update profile:', updateError);
                throw updateError;
              }

              console.log('[useConsumableIAP] ✅ Supabase profile updated:', updateData);
              console.log('[useConsumableIAP] ✅ Credits granted to user:', newTotal);
              
              // Wait a moment to ensure Supabase processes the update
              await new Promise(resolve => setTimeout(resolve, 500));
            } else {
              // Grant credits to guest (local storage)
              const creditsData = await AsyncStorage.getItem('guest_credits');
              const current = creditsData ? JSON.parse(creditsData).current : 0;
              
              const newTotal = current + credits;

              await AsyncStorage.setItem('guest_credits', JSON.stringify({
                current: newTotal,
                max: Math.max(newTotal, credits),
                lastResetDate: new Date().toISOString(),
                plan: 'guest'
              }));

              console.log('[useConsumableIAP] ✅ Credits granted to guest:', newTotal);
            }
          } catch (error) {
            console.error('[useConsumableIAP] Error granting credits:', error);
            throw error;
          }
          
          // Refresh credits in UI
          await refreshCredits();
          
          // Clear purchasing state
          setPurchasingProduct(null);
        });

        // Fetch products
        const fetchedProducts = await ConsumableIAPService.getProducts();
        setProducts(fetchedProducts);
        setIsLoading(false);
        
        isInitializedRef.current = true;
        console.log('[useConsumableIAP] Initialization complete');
      } catch (err: any) {
        console.error('[useConsumableIAP] Initialization failed:', err);
        setError(err.message || 'Failed to initialize purchases');
        setIsLoading(false);
      }
    };

    initializeIAP();

    // Cleanup on unmount
    return () => {
      // Note: Don't destroy here - service should persist across component mounts
      // Only destroy on app close
    };
  }, [creditPacks, refreshCredits]);

  /**
   * Refresh products from store.
   */
  const refreshProducts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const fetchedProducts = await ConsumableIAPService.getProducts();
      setProducts(fetchedProducts);
    } catch (err: any) {
      console.error('[useConsumableIAP] Failed to refresh products:', err);
      setError(err.message || 'Failed to load products');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Purchase a credit pack.
   * 
   * @param productId - Product ID to purchase
   * @returns Purchase result
   */
  const purchase = useCallback(async (productId: string): Promise<PurchaseResult> => {
    if (purchasingProduct) {
      console.warn('[useConsumableIAP] Purchase already in progress');
      return { success: false, error: 'Purchase already in progress' };
    }

    try {
      console.log('[useConsumableIAP] Starting purchase:', productId);
      setPurchasingProduct(productId);
      setError(null);

      const result = await ConsumableIAPService.purchasePack(productId);

      if (result.success) {
        console.log('[useConsumableIAP] Purchase initiated successfully');
        // Note: Credits will be granted via the transaction listener callback
        // Don't clear purchasingProduct here - wait for callback
      } else {
        console.warn('[useConsumableIAP] Purchase failed:', result.error);
        setError(result.error || 'Purchase failed');
        setPurchasingProduct(null);
      }

      return result;
    } catch (err: any) {
      console.error('[useConsumableIAP] Purchase error:', err);
      const errorMessage = err.message || 'Purchase failed';
      setError(errorMessage);
      setPurchasingProduct(null);
      return { success: false, error: errorMessage };
    }
  }, [purchasingProduct]);

  return {
    products,
    isLoading,
    purchasingProduct,
    error,
    purchase,
    refreshProducts,
  };
}
