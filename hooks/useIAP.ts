import { useEffect, useRef, useState, useCallback } from 'react';
import * as RNIap from 'react-native-iap';
import { Platform } from 'react-native';

export type IAPStatus = 'idle' | 'loading' | 'ready' | 'purchasing' | 'success' | 'error';

export interface IAPProduct {
  productId: string;
  title: string;
  description: string;
  price: string;
  currency: string;
}

export interface IAPPurchaseResult {
  success: boolean;
  productId?: string;
  error?: string;
}

let isInitialized = false;
let connectionPromise: Promise<boolean> | null = null;

export function useIAP(productIds: string[]) {
  const [products, setProducts] = useState<IAPProduct[]>([]);
  const [status, setStatus] = useState<IAPStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [purchaseResult, setPurchaseResult] = useState<IAPPurchaseResult | null>(null);
  const purchaseUpdateListener = useRef<any>(null);
  const purchaseErrorListener = useRef<any>(null);
  const isMounted = useRef(true);

  // Initialize IAP connection (once globally)
  useEffect(() => {
    isMounted.current = true;

    async function init() {
      if (isInitialized) {
        await loadProducts();
        return;
      }

      if (connectionPromise) {
        await connectionPromise;
        await loadProducts();
        return;
      }

      connectionPromise = (async () => {
        try {
          console.log('[useIAP] Initializing IAP connection...');
          await RNIap.initConnection();
          isInitialized = true;
          console.log('[useIAP] ✅ IAP connection initialized');
          return true;
        } catch (e: any) {
          console.error('[useIAP] ❌ Failed to initialize:', e);
          if (isMounted.current) {
            setError(e.message || String(e));
            setStatus('error');
          }
          return false;
        }
      })();

      await connectionPromise;
      await loadProducts();
    }

    async function loadProducts() {
      if (!isMounted.current) return;

      try {
        console.log('[useIAP] Loading products:', productIds);
        setStatus('loading');

        const fetchedProducts = await RNIap.fetchProducts({
          skus: productIds,
          type: 'in-app'
        });

        console.log('[useIAP] Fetched products:', fetchedProducts?.length || 0);

        if (!isMounted.current) return;

        if (fetchedProducts && fetchedProducts.length > 0) {
          const mappedProducts = fetchedProducts.map((p: any) => ({
            productId: p.id || p.productId,
            title: p.title || '',
            description: p.description || '',
            price: String(p.displayPrice || p.price || ''),
            currency: p.currency || 'USD'
          }));

          setProducts(mappedProducts);
          setStatus('ready');
          console.log('[useIAP] ✅ Products loaded successfully');
        } else {
          setStatus('error');
          setError('No products available');
          console.error('[useIAP] ❌ No products returned');
        }
      } catch (e: any) {
        console.error('[useIAP] ❌ Error loading products:', e);
        if (isMounted.current) {
          setError(e.message || String(e));
          setStatus('error');
        }
      }
    }

    init();

    return () => {
      isMounted.current = false;
    };
  }, [productIds.join(',')]); // Use join to avoid array reference changes

  // Set up purchase listeners
  useEffect(() => {
    console.log('[useIAP] Setting up purchase listeners');

    purchaseUpdateListener.current = RNIap.purchaseUpdatedListener(async (purchase: any) => {
      console.log('[useIAP] 📦 Purchase update received:', purchase);

      try {
        // Finish the transaction
        await RNIap.finishTransaction({ purchase, isConsumable: true });
        console.log('[useIAP] ✅ Transaction finished');

        // Extract productId
        const productId = purchase.productId || (purchase as any).productIds?.[0] || '';

        if (isMounted.current) {
          setPurchaseResult({ success: true, productId });
          setStatus('success');
          console.log('[useIAP] ✅ Purchase successful:', productId);
        }
      } catch (e: any) {
        console.error('[useIAP] ❌ Error finishing transaction:', e);
        if (isMounted.current) {
          setPurchaseResult({ success: false, error: e.message || String(e) });
          setStatus('error');
        }
      }
    });

    purchaseErrorListener.current = RNIap.purchaseErrorListener((err: any) => {
      console.error('[useIAP] ❌ Purchase error:', err);

      if (isMounted.current) {
        const errorMessage = err.message || String(err);

        // Don't treat user cancellation as an error
        if (errorMessage.toLowerCase().includes('cancel')) {
          console.log('[useIAP] Purchase cancelled by user');
          setStatus('ready');
          return;
        }

        setPurchaseResult({ success: false, error: errorMessage });
        setError(errorMessage);
        setStatus('error');
      }
    });

    return () => {
      if (purchaseUpdateListener.current) {
        purchaseUpdateListener.current.remove();
        purchaseUpdateListener.current = null;
      }
      if (purchaseErrorListener.current) {
        purchaseErrorListener.current.remove();
        purchaseErrorListener.current = null;
      }
    };
  }, []);

  const purchase = useCallback(async (productId: string) => {
    console.log('[useIAP] 🛒 Starting purchase for:', productId);

    setStatus('purchasing');
    setError(null);
    setPurchaseResult(null);

    try {
      // Build request using v14.5.0 API
      const purchaseRequest: RNIap.RequestPurchaseProps = {
        type: 'in-app',
        request: Platform.OS === 'ios'
          ? { apple: { sku: productId } }
          : { google: { skus: [productId] } }
      };

      console.log('[useIAP] Sending purchase request:', purchaseRequest);
      await RNIap.requestPurchase(purchaseRequest);
      console.log('[useIAP] Purchase request sent, waiting for response...');
    } catch (e: any) {
      console.error('[useIAP] ❌ Purchase request failed:', e);
      const errorMessage = e.message || String(e);

      // Don't treat user cancellation as an error
      if (errorMessage.toLowerCase().includes('cancel')) {
        console.log('[useIAP] Purchase cancelled by user');
        setStatus('ready');
        return;
      }

      setError(errorMessage);
      setStatus('error');
      setPurchaseResult({ success: false, error: errorMessage });
    }
  }, []);

  return {
    products,
    status,
    error,
    purchaseResult,
    purchase,
  };
}
