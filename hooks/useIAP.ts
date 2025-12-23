import { useEffect, useRef, useState, useCallback } from 'react';
import * as RNIap from 'react-native-iap';
import { Platform, Alert } from 'react-native';

export type IAPStatus = 'idle' | 'loading' | 'success' | 'error';

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
  purchase?: any;
}

export function useIAP(productIds: string[]) {
  const [products, setProducts] = useState<IAPProduct[]>([]);
  const [status, setStatus] = useState<IAPStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [purchaseResult, setPurchaseResult] = useState<IAPPurchaseResult | null>(null);
  const purchaseUpdateListener = useRef<any>(null);
  const purchaseErrorListener = useRef<any>(null);

  useEffect(() => {
    let isMounted = true;
    async function initIAP() {
      try {
        await RNIap.initConnection();
        const fetchedProducts = await RNIap.getProducts(productIds);
        if (isMounted) {
          setProducts(fetchedProducts.map(p => ({
            productId: p.productId || p.sku || p.id,
            title: p.title,
            description: p.description,
            price: p.price,
            currency: p.currency
          })));
        }
      } catch (e: any) {
        if (isMounted) setError(e.message || String(e));
      }
    }
    initIAP();
    return () => {
      isMounted = false;
      RNIap.endConnection();
      if (purchaseUpdateListener.current) purchaseUpdateListener.current.remove();
      if (purchaseErrorListener.current) purchaseErrorListener.current.remove();
    };
  }, [productIds]);

  useEffect(() => {
    purchaseUpdateListener.current = RNIap.purchaseUpdatedListener(async (purchase) => {
      try {
        await RNIap.finishTransaction({ purchase, isConsumable: true });
        setPurchaseResult({ success: true, productId: purchase.productId || purchase.sku, purchase });
        setStatus('success');
      } catch (e: any) {
        setPurchaseResult({ success: false, error: e.message || String(e), purchase });
        setStatus('error');
      }
    });
    purchaseErrorListener.current = RNIap.purchaseErrorListener((err) => {
      setPurchaseResult({ success: false, error: err.message || String(err) });
      setStatus('error');
    });
    return () => {
      if (purchaseUpdateListener.current) purchaseUpdateListener.current.remove();
      if (purchaseErrorListener.current) purchaseErrorListener.current.remove();
    };
  }, []);

  const purchase = useCallback(async (productId: string) => {
    setStatus('loading');
    setError(null);
    try {
      if (Platform.OS === 'ios') {
        await RNIap.requestPurchase({ sku: productId });
      } else {
        await RNIap.requestPurchase({ skus: [productId] });
      }
    } catch (e: any) {
      setError(e.message || String(e));
      setStatus('error');
      setPurchaseResult({ success: false, error: e.message || String(e) });
      Alert.alert('Purchase Error', e.message || String(e));
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