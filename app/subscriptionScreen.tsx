import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Alert, Image, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useState, useEffect, useRef, useCallback } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import IAPService from '../services/IAPService';
import { completeOnboarding } from '../src/features/auth/api';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';

// Platform-specific product IDs - must match App Store Connect / Google Play Console
const PRODUCT_IDS = Platform.OS === 'ios' ? {
  yearly: 'ai.icons.yearly',
  monthly: 'ai.icons.monthly',
  weekly: 'ai.icons.weekly',
} : {
  yearly: 'ai.icons.yearly',
  monthly: 'ai.icons.monthly',
  weekly: 'ai.icons.weekly',
};

export default function SubscriptionScreen() {
  const router = useRouter();
  const routerRef = useRef(router);
  const [selectedPlan, setSelectedPlan] = useState<'yearly' | 'monthly' | 'weekly'>('yearly');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [products, setProducts] = useState<any[]>([]);
  const [iapReady, setIapReady] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [currentPurchaseAttempt, setCurrentPurchaseAttempt] = useState<'monthly' | 'yearly' | 'weekly' | null>(null);
  const hasProcessedOrphansRef = useRef<boolean>(false);

  // Keep router ref updated
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Debug state
  const [debugInfo, setDebugInfo] = useState<any>({
    listenerStatus: 'Not started',
    connectionStatus: { isConnected: false, hasListener: false },
    lastPurchaseResult: null,
    lastError: null,
    timestamp: new Date().toISOString()
  });
  const [showDebug, setShowDebug] = useState(false); // Debug panel hidden for production

  // Check if IAP is available
  const isIAPAvailable = IAPService.isAvailable();

  // Check if running in Expo Go
  const isExpoGo = Constants.executionEnvironment === 'storeClient';

  // Stable callback for IAP events
  const handleIAPCallback = useCallback((info: any) => {
    console.log('[SUBSCRIPTION] IAP Debug:', info);

    // Update debug info
    setDebugInfo((prev: any) => ({
      ...prev,
      ...info,
      connectionStatus: IAPService.getConnectionStatus(),
      timestamp: new Date().toISOString()
    }));

    // Handle successful purchase - navigate to generate screen
    if (info.listenerStatus?.includes('SUCCESS') || info.listenerStatus?.includes('Navigating')) {
      console.log('[SUBSCRIPTION] Purchase successful! Navigating to generate screen...');
      setCurrentPurchaseAttempt(null);

      // Mark onboarding as complete
      completeOnboarding().catch(err => {
        console.error('[SUBSCRIPTION] Error completing onboarding:', err);
      });

      // Navigate immediately without delay
      console.log('[SUBSCRIPTION] Navigating to generate screen now...');
      try {
        router.replace('/(tabs)/generate');
      } catch (err) {
        console.error('[SUBSCRIPTION] Navigation failed:', err);
        // Fallback: try router ref
        const currentRouter = routerRef.current;
        if (currentRouter && typeof currentRouter.replace === 'function') {
          currentRouter.replace('/(tabs)/generate');
        }
      }
    }

    // Update loading state based on listener status
    if (info.listenerStatus?.includes('CANCELLED') || info.listenerStatus?.includes('FAILED') || info.listenerStatus?.includes('TIMEOUT')) {
      setCurrentPurchaseAttempt(null);
    }
  }, [router]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    initializeIAP();

    // Fallback: Set IAP ready after 5 seconds if still not ready
    const timeout = setTimeout(() => {
      setIapReady(true);
      console.log('[SUBSCRIPTION] IAP initialization timeout - unblocking button');
    }, 5000);

    return () => clearTimeout(timeout);
  }, []);

  // Re-register callback whenever it changes
  useEffect(() => {
    if (iapReady) {
      console.log('[SUBSCRIPTION] Re-registering IAP callback');
      IAPService.setDebugCallback(handleIAPCallback);
    }
  }, [handleIAPCallback, iapReady]);

  const initializeIAP = async () => {
    if (!isIAPAvailable) {
      console.log('[SUBSCRIPTION] IAP not available on this platform');
      // Set IAP ready to true even if unavailable so button is not stuck
      setIapReady(true);
      return;
    }

    try {
      const initialized = await IAPService.initialize();
      setIapReady(initialized);

      if (initialized) {
        // Set up debug callback using the stable callback
        IAPService.setDebugCallback(handleIAPCallback);

        // Check for orphaned transactions on startup
        if (!hasProcessedOrphansRef.current) {
          hasProcessedOrphansRef.current = true;
          await IAPService.checkForOrphanedTransactions();
        }

        // Fetch products
        await fetchProducts();
      } else {
        // If initialization failed, still set ready to true to unblock the button
        setIapReady(true);
      }
    } catch (error) {
      console.error('[SUBSCRIPTION] Error initializing IAP:', error);
      // Set ready to true even on error to prevent button from being stuck
      setIapReady(true);
      Alert.alert('Error', 'Failed to initialize purchases. Please restart the app.');
    }
  };

  const fetchProducts = async (showErrors = false) => {
    if (!isIAPAvailable) {
      if (showErrors) {
        Alert.alert('IAP Unavailable', 'In-app purchases are not available on this platform.');
      }
      return [];
    }

    console.log('[SUBSCRIPTION] Fetching products...');
    try {
      setLoadingProducts(true);
      const results = await IAPService.getProducts();
      if (results?.length) {
        setProducts(results);
        console.log('[SUBSCRIPTION] Products loaded:', results.map(p => `${p.productId}: ${p.price}`).join(', '));
        return results;
      } else {
        setProducts([]);
        console.log('[SUBSCRIPTION] No products available');
        if (showErrors) {
          Alert.alert('Products Unavailable', 'Could not load subscription products. Please check your internet connection and try again.');
        }
        return [];
      }
    } catch (err) {
      setProducts([]);
      console.error('[SUBSCRIPTION] Error fetching products:', err);
      if (showErrors) {
        Alert.alert('Error', 'Failed to load products: ' + String(err instanceof Error ? err.message : err));
      }
      return [];
    } finally {
      setLoadingProducts(false);
    }
  };

  const handleContinue = async () => {
    // If running in Expo Go, simulate the purchase
    if (isExpoGo) {
      await simulatePurchaseInExpoGo();
      return;
    }

    if (!isIAPAvailable) {
      Alert.alert('Purchases unavailable', 'In-app purchases are not available on this device.');
      return;
    }

    const list = products.length ? products : await fetchProducts(true);
    const planId = PRODUCT_IDS[selectedPlan];
    const product = list.find(p => p.productId === planId);

    if (!product) {
      Alert.alert(
        'Plan not available',
        'We couldn\'t find that plan. Please check your internet connection and try again.'
      );
      return;
    }

    // Set the current purchase attempt BEFORE starting the purchase
    setCurrentPurchaseAttempt(selectedPlan);
    await handlePurchase(product.productId);
  };

  const simulatePurchaseInExpoGo = async () => {
    try {
      setCurrentPurchaseAttempt(selectedPlan);
      console.log('[EXPO GO] Simulating purchase for plan:', selectedPlan);

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('User not authenticated');
      }

      console.log('[EXPO GO] User ID:', user.id);
      console.log('[EXPO GO] User email:', user.email);

      // Calculate subscription dates and credits based on plan
      const now = new Date();
      let credits = 0;
      let subscriptionEndDate = new Date(now);

      if (selectedPlan === 'weekly') {
        credits = 10;
        subscriptionEndDate.setDate(subscriptionEndDate.getDate() + 7);
      } else if (selectedPlan === 'monthly') {
        credits = 75;
        subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);
      } else if (selectedPlan === 'yearly') {
        credits = 90;
        subscriptionEndDate.setFullYear(subscriptionEndDate.getFullYear() + 1);
      }

      // Get the product ID for the selected plan
      const productId = PRODUCT_IDS[selectedPlan];

      // Determine price based on plan
      let price = 0;
      if (selectedPlan === 'weekly') price = 2.99;
      else if (selectedPlan === 'monthly') price = 5.99;
      else if (selectedPlan === 'yearly') price = 59.99;

      // First check if profile exists
      const { data: existingProfile, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      console.log('[EXPO GO] Profile exists:', !!existingProfile);
      console.log('[EXPO GO] Check error:', checkError);

      // If no profile exists, create one first
      if (!existingProfile) {
        console.log('[EXPO GO] Creating new profile...');
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            name: user.user_metadata?.full_name || user.email?.split('@')[0],
          });

        if (insertError) {
          console.error('[EXPO GO] Error creating profile:', insertError);
          throw insertError;
        }
        console.log('[EXPO GO] Profile created successfully');
      }

      // Update profile with subscription data
      console.log('[EXPO GO] Updating profile with subscription data...');
      const updateData = {
        subscription_plan: selectedPlan,
        subscription_status: 'active',
        subscription_start_date: now.toISOString(),
        subscription_end_date: subscriptionEndDate.toISOString(),
        credits_current: credits,
        credits_max: credits,
        product_id: productId,
        email: user.email,
        purchase_time: now.toISOString(),
        price: price,
        is_pro_version: true,
        last_credit_reset: now.toISOString(),
      };

      console.log('[EXPO GO] Update data:', updateData);

      const { data: updateResult, error: updateError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)
        .select();

      console.log('[EXPO GO] Update result:', updateResult);
      console.log('[EXPO GO] Update error:', updateError);

      if (updateError) {
        console.error('[EXPO GO] Full update error:', JSON.stringify(updateError));
        throw updateError;
      }

      console.log('[EXPO GO] Simulated purchase successful!');

      // Mark onboarding as complete
      await completeOnboarding();

      // Show success message
      Alert.alert(
        'Success (Expo Go Simulation)',
        `${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} plan activated with ${credits} credits!\n\nNote: This is a simulated purchase for testing in Expo Go.`,
        [
          {
            text: 'Continue',
            onPress: () => {
              setCurrentPurchaseAttempt(null);
              router.replace('/(tabs)/generate');
            }
          }
        ]
      );
    } catch (error: any) {
      console.error('[EXPO GO] Simulated purchase error:', error);
      setCurrentPurchaseAttempt(null);
      Alert.alert('Error', error.message || 'Failed to simulate purchase');
    }
  };

  const handlePurchase = async (productId: string) => {
    if (!isIAPAvailable) {
      Alert.alert('Purchases unavailable', 'In-app purchases are not available on this device.');
      setCurrentPurchaseAttempt(null);
      return;
    }

    try {
      console.log('[SUBSCRIPTION] Attempting to purchase:', productId, 'for plan:', selectedPlan);
      await IAPService.purchaseProduct(productId, selectedPlan);
    } catch (e: any) {
      setCurrentPurchaseAttempt(null); // Clear on error
      const msg = String(e?.message || e);

      if (/already.*(owned|subscribed)/i.test(msg)) {
        Alert.alert(
          'Already subscribed',
          'You already have an active subscription. Manage your subscriptions from the App Store.',
          [
            { text: 'OK' },
          ]
        );
        return;
      }

      if (/item.*unavailable|product.*not.*available/i.test(msg)) {
        Alert.alert('Not available', 'This plan isn\'t available for purchase right now.');
        return;
      }

      // Handle user cancellation
      if (/user.*(cancel|abort)/i.test(msg) || /cancel/i.test(msg)) {
        console.log('[SUBSCRIPTION] Purchase was cancelled by user');
        return;
      }

      // Handle timeout
      if (/timeout/i.test(msg)) {
        console.error('[SUBSCRIPTION] Purchase timeout');
        Alert.alert(
          'Purchase Timeout',
          'The purchase is taking too long. Please check your connection and try again. If you were charged, the purchase will be processed automatically.',
          [{ text: 'OK' }]
        );
        return;
      }

      console.error('[SUBSCRIPTION] Purchase error:', msg);
      Alert.alert('Purchase error', msg);
    }
  };

  const handleRestore = async () => {
    if (!isIAPAvailable) {
      Alert.alert('Restore Failed', 'In-app purchases are not available on this device.');
      return;
    }

    try {
      console.log('[SUBSCRIPTION] Attempting to restore purchases...');
      const results = await IAPService.restorePurchases();
      if (results.length > 0) {
        // Mark onboarding as complete
        await completeOnboarding();

        Alert.alert('Success', 'Your purchases have been restored!', [
          { text: 'Continue', onPress: () => router.replace('/(tabs)/generate') }
        ]);
      }
    } catch (err: any) {
      const errorMsg = String(err?.message || err);
      if (errorMsg.includes('No previous purchases')) {
        Alert.alert('No Purchases', 'No previous purchases were found.');
      } else if (errorMsg.includes('Could not connect')) {
        Alert.alert('Restore Failed', 'Could not connect to App Store.');
      } else {
        Alert.alert('Error', 'Something went wrong while restoring.');
      }
    }
  };

  // Helper function to format price - always use fallback to show "/week" format
  const formatPrice = (fallbackPrice: string) => {
    // Always return the fallback price to maintain consistent "/week" format
    // Apple's IAP prices don't include the duration suffix
    return fallbackPrice;
  };

  const handleClose = async () => {
    // Mark onboarding as complete when user closes without purchasing
    try {
      await completeOnboarding();
    } catch (err) {
      console.error('[SUBSCRIPTION] Error completing onboarding:', err);
    }

    router.replace('/(tabs)/generate');
  };

  return (
    <LinearGradient
      colors={['#050810', '#0d1120', '#08091a']}
      style={styles.container}
    >
      <StatusBar style="light" />

      {/* Expo Go Banner */}
      {isExpoGo && (
        <View style={styles.expoGoBanner}>
          <Text style={styles.expoGoBannerText}>🧪 Expo Go - Purchases will be simulated</Text>
        </View>
      )}

      {/* Close Button */}
      <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>

      {/* Already Purchased / Restore */}
      <TouchableOpacity style={styles.alreadyPurchased} onPress={handleRestore}>
        <Text style={styles.alreadyPurchasedText}>Restore Purchases</Text>
      </TouchableOpacity>

      <Animated.ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        style={{ opacity: fadeAnim, flex: 1 }}
      >
        {/* Logo/Icon with Glow */}
        <View style={styles.logoContainer}>
          <View style={styles.logoGlow}>
            <View style={styles.logo}>
              <Image
                source={require('../assets/icon.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
          </View>
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Turn Ideas Into Clicks.</Text>
          <Text style={styles.subtitle}>
            Every click counts. Create and save eye-catching icons that grow your channel, build your audience, and boost your revenue.
          </Text>
        </View>

        {/* Plans */}
        <View style={styles.plansContainer}>
          {/* Weekly Plan */}
          <TouchableOpacity
            style={[
              styles.planCard,
              selectedPlan === 'weekly' && styles.selectedPlan,
            ]}
            onPress={() => setSelectedPlan('weekly')}
          >
            <View style={styles.planRadio}>
              {selectedPlan === 'weekly' && <View style={styles.planRadioSelected} />}
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planName}>Weekly</Text>
            </View>
            <View style={styles.planPricing}>
              <Text style={styles.planPrice}>{formatPrice('$2.99/week')}</Text>
              <Text style={styles.planSubtext}>10 images per week</Text>
            </View>
          </TouchableOpacity>

          {/* Monthly Plan */}
          <TouchableOpacity
            style={[
              styles.planCard,
              selectedPlan === 'monthly' && styles.selectedPlan,
            ]}
            onPress={() => setSelectedPlan('monthly')}
          >
            <View style={styles.planRadio}>
              {selectedPlan === 'monthly' && <View style={styles.planRadioSelected} />}
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planName}>Monthly</Text>
            </View>
            <View style={styles.planPricing}>
              <Text style={styles.planPrice}>{formatPrice('$5.99/month')}</Text>
              <Text style={styles.planSubtext}>75 images per month</Text>
            </View>
          </TouchableOpacity>

          {/* Yearly Plan - Most Popular */}
          <TouchableOpacity
            style={[
              styles.planCard,
              selectedPlan === 'yearly' && styles.selectedPlan,
              styles.popularPlan,
            ]}
            onPress={() => setSelectedPlan('yearly')}
          >
            <View style={styles.planRadio}>
              {selectedPlan === 'yearly' && <View style={styles.planRadioSelected} />}
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planName}>Yearly</Text>
            </View>
            <View style={styles.planPricing}>
              <Text style={styles.planPrice}>{formatPrice('$59.99/year')}</Text>
              <Text style={styles.planSubtext}>90 images per month</Text>
            </View>
          </TouchableOpacity>
        </View>
      </Animated.ScrollView>

      {/* Continue Button - Fixed at Bottom */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.continueButton, (isExpoGo ? !!currentPurchaseAttempt : (!iapReady || loadingProducts || currentPurchaseAttempt)) && { opacity: 0.6 }]}
          onPress={handleContinue}
          disabled={isExpoGo ? !!currentPurchaseAttempt : (!iapReady || loadingProducts || !!currentPurchaseAttempt)}
        >
          <LinearGradient
            colors={['#1e40af', '#1e3a8a']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.continueGradient}
          >
            <Text style={styles.continueText}>
              {isExpoGo
                ? (currentPurchaseAttempt ? 'Simulating...' : 'Get Started (Simulated)')
                : (!iapReady ? 'Connecting...' : loadingProducts ? 'Loading...' : currentPurchaseAttempt ? 'Processing...' : 'Get Started')
              }
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Retry Connection Button - Show when not ready (not in Expo Go) */}
        {!isExpoGo && !iapReady && !loadingProducts && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={initializeIAP}
          >
            <Text style={styles.retryButtonText}>🔄 Retry Connection</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Debug Panel */}
      {showDebug && (
        <View style={styles.debugPanel}>
          <View style={styles.debugHeader}>
            <Text style={styles.debugTitle}>🔧 IAP Debug Monitor</Text>
            <TouchableOpacity onPress={() => setShowDebug(false)} style={styles.debugCloseButton}>
              <Text style={styles.debugCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.debugContent} showsVerticalScrollIndicator={true}>
            <View style={styles.debugSection}>
              <Text style={styles.debugSectionTitle}>Current Status</Text>
              <View style={styles.debugRow}>
                <View style={[styles.statusIndicator, currentPurchaseAttempt ? styles.statusActive : styles.statusInactive]} />
                <Text style={styles.debugText}>{debugInfo.listenerStatus || 'Idle'}</Text>
              </View>
            </View>

            <View style={styles.debugSection}>
              <Text style={styles.debugSectionTitle}>App Configuration</Text>
              <Text style={styles.debugText}>
                Bundle ID: com.watson.AI-Icon-Generator
              </Text>
              <Text style={[styles.debugTextSmall, { color: '#fbbf24', marginTop: 4 }]}>
                ⚠️ Verify this EXACTLY matches App Store Connect
              </Text>
            </View>

            <View style={styles.debugSection}>
              <Text style={styles.debugSectionTitle}>Connection</Text>
              <Text style={styles.debugText}>
                IAP Available: {isIAPAvailable ? '✅' : '❌'}
              </Text>
              <Text style={styles.debugText}>
                Connected: {debugInfo.connectionStatus?.isConnected ? '✅' : '❌'}
              </Text>
              <Text style={styles.debugText}>
                Listener Active: {debugInfo.connectionStatus?.hasListener ? '✅' : '❌'}
              </Text>
              <Text style={styles.debugText}>
                IAP Ready: {iapReady ? '✅' : '❌'}
              </Text>
            </View>

            <View style={styles.debugSection}>
              <Text style={styles.debugSectionTitle}>Purchase State</Text>
              <Text style={styles.debugText}>
                Current Attempt: {currentPurchaseAttempt || 'None'}
              </Text>
              <Text style={styles.debugText}>
                Selected Plan: {selectedPlan}
              </Text>
              <Text style={styles.debugText}>
                Products Loaded: {products.length}
              </Text>
            </View>

            <View style={styles.debugSection}>
              <Text style={styles.debugSectionTitle}>Product IDs</Text>
              <Text style={styles.debugText}>
                Platform: {Platform.OS}
              </Text>
              <Text style={styles.debugText}>
                Expected IDs:
              </Text>
              <Text style={styles.debugTextSmall}>
                • {PRODUCT_IDS.yearly}
              </Text>
              <Text style={styles.debugTextSmall}>
                • {PRODUCT_IDS.monthly}
              </Text>
              <Text style={styles.debugTextSmall}>
                • {PRODUCT_IDS.weekly}
              </Text>
              <Text style={[styles.debugText, { marginTop: 8, color: products.length > 0 ? '#22c55e' : '#ef4444', fontWeight: 'bold' }]}>
                Products Returned: {products.length}
              </Text>
              {products.length > 0 ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.debugTextSmall, { color: '#22c55e' }]}>✅ Available Products:</Text>
                  {products.map((p, idx) => {
                    const prodId = (p as any).productId || (p as any).id;
                    return (
                      <Text key={prodId || idx} style={styles.debugText}>
                        • {prodId} - {p.title || 'No title'} - {p.price || 'No price'}
                      </Text>
                    );
                  })}
                </View>
              ) : (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.debugTextSmall, { color: '#ef4444' }]}>❌ NO PRODUCTS LOADED!</Text>
                  <Text style={[styles.debugTextSmall, { color: '#fbbf24', marginTop: 4 }]}>Possible issues:</Text>
                  <Text style={styles.debugTextSmall}>• Bundle ID mismatch</Text>
                  <Text style={styles.debugTextSmall}>• Products not approved</Text>
                  <Text style={styles.debugTextSmall}>• Not signed in with test account</Text>
                  <Text style={styles.debugTextSmall}>• Subscription order still propagating</Text>
                </View>
              )}
            </View>

            {debugInfo.lastError && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>⚠️ Last Error</Text>
                <Text style={[styles.debugText, { color: '#ef4444' }]}>
                  Message: {debugInfo.lastError.message}
                </Text>
                {debugInfo.lastError.code && (
                  <Text style={styles.debugText}>
                    Code: {debugInfo.lastError.code}
                  </Text>
                )}
                <Text style={styles.debugTextSmall}>
                  Time: {new Date(debugInfo.lastError.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            )}

            {debugInfo.lastPurchaseResult && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>Last Purchase Result</Text>
                <Text style={[styles.debugText, styles.debugCode]}>
                  {JSON.stringify(debugInfo.lastPurchaseResult, null, 2)}
                </Text>
              </View>
            )}

            <View style={styles.debugSection}>
              <Text style={styles.debugTextSmall}>
                Last Update: {new Date(debugInfo.timestamp).toLocaleTimeString()}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.debugButton}
              onPress={() => {
                const status = IAPService.getConnectionStatus();
                const lastResult = IAPService.getLastPurchaseResult();
                setDebugInfo((prev: any) => ({
                  ...prev,
                  connectionStatus: status,
                  lastPurchaseResult: lastResult,
                  timestamp: new Date().toISOString(),
                  manualCheck: true
                }));
              }}
            >
              <Text style={styles.debugButtonText}>🔄 Refresh Debug Info</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.debugButton, { backgroundColor: '#16a34a' }]}
              onPress={async () => {
                await fetchProducts(true);
              }}
            >
              <Text style={styles.debugButtonText}>🔄 Retry Load Products</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.debugButton, { backgroundColor: '#dc2626' }]}
              onPress={async () => {
                console.log('[SUBSCRIPTION] Manual navigation triggered');
                setCurrentPurchaseAttempt(null);
                try {
                  await completeOnboarding();
                  console.log('[SUBSCRIPTION] Onboarding marked complete');
                } catch (err) {
                  console.error('[SUBSCRIPTION] Error completing onboarding:', err);
                }
                try {
                  router.replace('/(tabs)/generate');
                  console.log('[SUBSCRIPTION] Manual navigation successful');
                } catch (err) {
                  console.error('[SUBSCRIPTION] Manual navigation failed:', err);
                  Alert.alert('Navigation Failed', 'Please restart the app to continue.');
                }
              }}
            >
              <Text style={styles.debugButtonText}>🚀 Force Navigate to Generate</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.debugButton, { backgroundColor: '#f59e0b' }]}
              onPress={() => {
                setCurrentPurchaseAttempt(null);
                Alert.alert('Loading State Cleared', 'The "Processing..." state has been cleared.');
              }}
            >
              <Text style={styles.debugButtonText}>⏹️ Clear Loading State</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Debug Button - Commented out for production */}
      {/* {!showDebug && (
        <TouchableOpacity
          style={styles.showDebugButton}
          onPress={() => setShowDebug(true)}
        >
          <Text style={styles.showDebugText}>🔧</Text>
        </TouchableOpacity>
      )} */}
    </LinearGradient>
  );
}

const TEXT = '#ffffff';
const MUTED = '#a0a8b8';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  expoGoBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#f59e0b',
    paddingVertical: 8,
    paddingHorizontal: 16,
    zIndex: 100,
    alignItems: 'center',
  },
  expoGoBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#000000',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
  },
  closeText: {
    fontSize: 24,
    color: TEXT,
    fontWeight: '300',
  },
  alreadyPurchased: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    zIndex: 10,
  },
  alreadyPurchasedText: {
    fontSize: 13,
    color: MUTED,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 120,
    paddingBottom: 20,
    justifyContent: 'center',
  },
  buttonContainer: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 10,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  logoGlow: {
    shadowColor: '#1e40af',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 10,
  },
  logo: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImage: {
    width: 100,
    height: 100,
    borderRadius: 20,
  },
  header: {
    marginBottom: 40,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: TEXT,
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  plansContainer: {
    gap: 16,
    marginBottom: 16,
  },
  trialInfo: {
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 18,
  },
  planCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  selectedPlan: {
    borderColor: '#1e40af',
    backgroundColor: 'rgba(30, 64, 175, 0.1)',
    ...Platform.select({
      ios: {
        shadowColor: '#1e40af',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 15,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  popularPlan: {
    // Additional styling for popular plan
  },
  planRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: MUTED,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  planRadioSelected: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1e40af',
  },
  planContent: {
    flex: 1,
  },
  planName: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
  },
  planPricing: {
    alignItems: 'flex-end',
  },
  planPrice: {
    fontSize: 14,
    fontWeight: '500',
    color: MUTED,
  },
  planSubtext: {
    fontSize: 12,
    color: MUTED,
    opacity: 0.7,
    marginTop: 2,
  },
  continueButton: {
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#1e40af',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  continueGradient: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  retryButton: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(30, 64, 175, 0.2)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e40af',
    alignItems: 'center',
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#93c5fd',
  },
  // Debug Panel Styles
  debugPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: '#1e40af',
    shadowColor: '#1e40af',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 20,
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1e40af',
  },
  debugTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e40af',
  },
  debugCloseButton: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 64, 175, 0.2)',
    borderRadius: 15,
  },
  debugCloseText: {
    fontSize: 18,
    color: '#1e40af',
  },
  debugContent: {
    flex: 1,
    padding: 15,
  },
  debugSection: {
    marginBottom: 15,
    padding: 10,
    backgroundColor: 'rgba(30, 64, 175, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(30, 64, 175, 0.3)',
  },
  debugSectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#60a5fa',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusActive: {
    backgroundColor: '#22c55e',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  statusInactive: {
    backgroundColor: '#6b7280',
  },
  debugText: {
    fontSize: 12,
    color: '#e5e7eb',
    marginVertical: 3,
    fontFamily: 'monospace',
  },
  debugTextSmall: {
    fontSize: 10,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  debugCode: {
    fontSize: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 8,
    borderRadius: 4,
    color: '#10b981',
  },
  debugButton: {
    backgroundColor: '#1e40af',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  debugButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  showDebugButton: {
    position: 'absolute',
    bottom: 120,
    right: 20,
    width: 50,
    height: 50,
    backgroundColor: '#1e40af',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1e40af',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 10,
  },
  showDebugText: {
    fontSize: 24,
  },
});
