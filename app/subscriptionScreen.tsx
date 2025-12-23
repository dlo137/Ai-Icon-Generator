import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Alert, Image, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConsumableIAP } from '../hooks/useConsumableIAP';

// Consumable IAP credit packs - must match App Store Connect / Google Play Console
const CREDIT_PACKS = [
  { productId: 'starter.25', credits: 15, displayName: 'Starter Pack' },
  { productId: 'value.75', credits: 45, displayName: 'Value Pack' },
  { productId: 'pro.200', credits: 120, displayName: 'Pro Pack' },
];

// Quick lookup for product IDs by plan name
const PRODUCT_IDS = {
  starter: 'starter.25',
  value: 'value.75',
  pro: 'pro.200',
};

export default function SubscriptionScreen() {
  // Debounce flag to prevent duplicate purchase attempts
  const purchaseInProgressRef = useRef(false);
  const router = useRouter();
  const routerRef = useRef(router);
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'value' | 'pro'>('pro');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  
  // Initialize consumable IAP service
  const { products, isLoading, purchasingProduct, error: iapError, purchase } = useConsumableIAP(CREDIT_PACKS);
  const iapStatus = isLoading ? 'loading' : (products.length > 0 ? 'ready' : 'error');
  const currentPurchaseAttempt = purchasingProduct as 'starter' | 'value' | 'pro' | null;

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

  // Check if running in Expo Go
  const isExpoGo = Constants.executionEnvironment === 'storeClient';

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleContinue = async () => {
    if (purchaseInProgressRef.current) {
      console.log('[SubscriptionScreen] Purchase already in progress, ignoring duplicate tap');
      return;
    }
    purchaseInProgressRef.current = true;

    // If running in Expo Go, simulate the purchase
    if (isExpoGo) {
      await simulatePurchaseInExpoGo();
      purchaseInProgressRef.current = false;
      return;
    }

    const isIAPAvailable = iapStatus === 'ready' && products.length > 0;
    if (!isIAPAvailable) {
      Alert.alert('Purchases unavailable', 'In-app purchases are not available on this device.');
      purchaseInProgressRef.current = false;
      return;
    }

    console.log('[SubscriptionScreen] handleContinue called');
    console.log('[SubscriptionScreen] Selected plan:', selectedPlan);
    console.log('[SubscriptionScreen] Current products count:', products.length);

    const planId = PRODUCT_IDS[selectedPlan];
    const product = products.find(p => p.productId === planId);
    if (!product) {
      Alert.alert('Plan not available', `We couldn't find the ${selectedPlan} plan (${planId}). Please try again or contact support.`);
      purchaseInProgressRef.current = false;
      return;
    }

    try {
      const result = await purchase(planId);
      
      if (result.success) {
        // Mark onboarding as complete
        await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
        
        // Navigate to generate screen
        router.replace('/(tabs)/generate');
      } else if (result.error && !result.error.includes('cancelled')) {
        Alert.alert('Purchase Failed', result.error || 'Please try again.');
      }
    } catch (error: any) {
      console.error('Purchase failed:', error);
      if (error.message && !error.message.includes('cancelled')) {
        Alert.alert('Purchase Failed', error.message || 'Please try again.');
      }
    } finally {
      purchaseInProgressRef.current = false;
    }
  };

  const handleContinueAsGuest = async () => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // Update Supabase profile with 3 free credits
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            credits_current: 3,
            credits_max: 3,
            is_pro_version: false,
          })
          .eq('id', user.id);

        if (updateError) {
          console.error('Failed to update profile:', updateError);
        }
      }

      // Mark onboarding as complete
      await AsyncStorage.setItem('hasCompletedOnboarding', 'true');

      // Navigate to generate screen
      router.replace('/(tabs)/generate');
    } catch (error) {
      console.error('Failed to continue as guest:', error);
      Alert.alert('Error', 'Failed to continue as guest. Please try again.');
    }
  };

  const simulatePurchaseInExpoGo = async () => {
    try {

      // Get current user for authenticated flow
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('User not authenticated');
      }

      // Calculate credits based on consumable pack (no expiration for consumables)
      const now = new Date();
      let credits = 0;

      if (selectedPlan === 'starter') {
        credits = 15;
      } else if (selectedPlan === 'value') {
        credits = 45;
      } else if (selectedPlan === 'pro') {
        credits = 120;
      }

      // Get the product ID for the selected plan
      const productId = PRODUCT_IDS[selectedPlan];

      // Determine price based on plan
      let price = 0;
      if (selectedPlan === 'starter') price = 1.99;
      else if (selectedPlan === 'value') price = 5.99;
      else if (selectedPlan === 'pro') price = 14.99;

      // First check if profile exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      // Get current credits to add to them
      let currentCredits = 0;
      if (existingProfile) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('credits_current')
          .eq('id', user.id)
          .single();

        currentCredits = profileData?.credits_current || 0;
      } else {
        // Create profile if doesn't exist
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            name: user.user_metadata?.full_name || user.email?.split('@')[0],
            credits_current: 0,
          });

        if (insertError) {
          throw insertError;
        }
      }

      // Add credits to existing balance (consumable model)
      const newCreditTotal = currentCredits + credits;

      // Denominator logic: Set to pack size, unless current > pack size, then match current
      const newMax = newCreditTotal > credits ? newCreditTotal : credits;

      const updateData = {
        credits_current: newCreditTotal,
        credits_max: newMax, // Pack size, or current if current > pack size
        product_id: productId,
        email: user.email,
        purchase_time: now.toISOString(),
        price: price,
        is_pro_version: true,
      };

      const { error: updateError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)
        .select();

      if (updateError) {
        throw updateError;
      }

      // Mark onboarding as complete
      await AsyncStorage.setItem('hasCompletedOnboarding', 'true');

      // Show success message
      Alert.alert(
        'Success (Expo Go Simulation)',
        `${credits} credits added! New total: ${newCreditTotal} credits\n\nNote: This is a simulated purchase for testing in Expo Go.`,
        [
          {
            text: 'Continue',
            onPress: () => {
              router.replace('/(tabs)/generate');
            }
          }
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to simulate purchase');
    }
  };

  const handleRestore = async () => {
    Alert.alert('Restore Purchases', 'Restore functionality is handled automatically by the app. Any previous purchases will be restored when you launch the app.');
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
      await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
    } catch (err) {
      console.error('Failed to mark onboarding as complete:', err);
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
          {/* Starter Plan */}
          <TouchableOpacity
            style={[
              styles.planCard,
              selectedPlan === 'starter' && styles.selectedPlan,
            ]}
            onPress={() => setSelectedPlan('starter')}
          >
            <View style={styles.planRadio}>
              {selectedPlan === 'starter' && <View style={styles.planRadioSelected} />}
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planName}>Starter</Text>
            </View>
            <View style={styles.planPricing}>
              <Text style={styles.planPrice}>{formatPrice('$1.99')}</Text>
              <Text style={styles.planSubtext}>Quick Try · 15 AI Icons</Text>
            </View>
          </TouchableOpacity>

          {/* Value Plan */}
          <TouchableOpacity
            style={[
              styles.planCard,
              selectedPlan === 'value' && styles.selectedPlan,
            ]}
            onPress={() => setSelectedPlan('value')}
          >
            <View style={styles.planRadio}>
              {selectedPlan === 'value' && <View style={styles.planRadioSelected} />}
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planName}>Value</Text>
            </View>
            <View style={styles.planPricing}>
              <Text style={styles.planPrice}>{formatPrice('$5.99')}</Text>
              <Text style={styles.planSubtext}>Growing Channels · 45 AI Icons</Text>
            </View>
          </TouchableOpacity>

          {/* Pro Plan - Most Popular */}
          <TouchableOpacity
            style={[
              styles.planCard,
              selectedPlan === 'pro' && styles.selectedPlan,
              styles.popularPlan,
            ]}
            onPress={() => setSelectedPlan('pro')}
          >
            <View style={styles.planRadio}>
              {selectedPlan === 'pro' && <View style={styles.planRadioSelected} />}
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planName}>Pro</Text>
            </View>
            <View style={styles.planPricing}>
              <Text style={styles.planPrice}>{formatPrice('$14.99')}</Text>
              <Text style={styles.planSubtext}>Serious Growth · 120 AI Icons</Text>
            </View>
          </TouchableOpacity>
        </View>
      </Animated.ScrollView>

      {/* Continue Button - Fixed at Bottom */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.continueButton, (isExpoGo ? !!currentPurchaseAttempt : (iapStatus === 'loading' || !!currentPurchaseAttempt || iapStatus === 'error')) && { opacity: 0.6 }]}
          onPress={handleContinue}
          disabled={isExpoGo ? !!currentPurchaseAttempt : (iapStatus === 'loading' || !!currentPurchaseAttempt || iapStatus === 'error')}
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
                : (iapStatus === 'loading' ? 'Loading Products...' : currentPurchaseAttempt ? 'Processing Purchase...' : 'Get Started')
              }
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Continue as Guest Option */}
        <TouchableOpacity
          onPress={handleContinueAsGuest}
          style={styles.skipContainer}
        >
          <Text style={styles.skipText}>Continue as Guest</Text>
        </TouchableOpacity>
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
              {debugInfo.handlePurchaseCalls && (
                <Text style={[styles.debugText, { color: debugInfo.handlePurchaseCalls > 1 ? '#fbbf24' : '#22c55e', marginTop: 8 }]}>
                  handlePurchase Calls: {debugInfo.handlePurchaseCalls} {debugInfo.handlePurchaseCalls > 1 ? '⚠️ MULTIPLE CALLS!' : ''}
                </Text>
              )}
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
                IAP Available: {(iapStatus === 'ready' && products.length > 0) ? '✅' : '❌'}
              </Text>
              <Text style={styles.debugText}>
                Status: {iapStatus}
              </Text>
              {iapError && (
                <Text style={[styles.debugText, { color: '#ef4444', fontWeight: 'bold' }]}>
                  Error: {iapError}
                </Text>
              )}
              <Text style={styles.debugText}>
                Products Loaded: {products.length}
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
                • {PRODUCT_IDS.starter}
              </Text>
              <Text style={styles.debugTextSmall}>
                • {PRODUCT_IDS.value}
              </Text>
              <Text style={styles.debugTextSmall}>
                • {PRODUCT_IDS.pro}
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

            {debugInfo.purchaseAttempt && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>🛒 Purchase Attempt Details (Sent)</Text>
                <Text style={styles.debugText}>
                  Selected Plan: {debugInfo.purchaseAttempt.selectedPlan}
                </Text>
                <Text style={styles.debugText}>
                  Product ID to Use: {debugInfo.purchaseAttempt.productIdToUse || 'undefined'}
                </Text>
                <Text style={[styles.debugText, { color: debugInfo.purchaseAttempt.productIdIsValid ? '#22c55e' : '#ef4444' }]}>
                  Is Valid: {debugInfo.purchaseAttempt.productIdIsValid ? '✅ YES' : '❌ NO'}
                </Text>
                <Text style={styles.debugText}>
                  Type: {debugInfo.purchaseAttempt.productIdType}
                </Text>
                <Text style={styles.debugText}>
                  Length: {debugInfo.purchaseAttempt.productIdLength}
                </Text>
                <Text style={styles.debugSectionTitle}>Product Object:</Text>
                <Text style={styles.debugText}>
                  id: {debugInfo.purchaseAttempt.productObject?.id || 'undefined'}
                </Text>
                <Text style={styles.debugText}>
                  productId: {debugInfo.purchaseAttempt.productObject?.productId || 'undefined'}
                </Text>
                <Text style={styles.debugText}>
                  title: {debugInfo.purchaseAttempt.productObject?.title || 'undefined'}
                </Text>
                <Text style={styles.debugText}>
                  price: {debugInfo.purchaseAttempt.productObject?.price || 'undefined'}
                </Text>
                <Text style={styles.debugSectionTitle}>Full Product:</Text>
                <Text style={[styles.debugText, styles.debugCode]}>
                  {debugInfo.purchaseAttempt.productObject?.fullObject || 'No data'}
                </Text>
              </View>
            )}

            {debugInfo.lastHandlePurchaseCall && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>📞 Last handlePurchase Call</Text>
                <Text style={styles.debugText}>
                  Product ID: {debugInfo.lastHandlePurchaseCall.productId || 'undefined'}
                </Text>
                <Text style={[styles.debugText, { color: debugInfo.lastHandlePurchaseCall.productIdValid ? '#22c55e' : '#ef4444' }]}>
                  Is Valid: {debugInfo.lastHandlePurchaseCall.productIdValid ? '✅ YES' : '❌ NO'}
                </Text>
                <Text style={styles.debugText}>
                  Type: {debugInfo.lastHandlePurchaseCall.productIdType}
                </Text>
                <Text style={styles.debugText}>
                  Selected Plan: {debugInfo.lastHandlePurchaseCall.selectedPlan}
                </Text>
                <Text style={styles.debugTextSmall}>
                  Time: {new Date(debugInfo.lastHandlePurchaseCall.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            )}

            {debugInfo.callingIAPService && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>📤 Calling IAP Service</Text>
                <Text style={styles.debugText}>
                  Product ID: {debugInfo.callingIAPService.productId || 'undefined'}
                </Text>
                <Text style={styles.debugText}>
                  Selected Plan: {debugInfo.callingIAPService.selectedPlan}
                </Text>
                <Text style={styles.debugTextSmall}>
                  Time: {new Date(debugInfo.callingIAPService.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            )}

            {debugInfo.purchaseProductParams && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>🎯 purchaseProduct Params</Text>
                <Text style={styles.debugText}>
                  Product ID: {debugInfo.purchaseProductParams.productId || 'undefined'}
                </Text>
                <Text style={styles.debugText}>
                  Type: {debugInfo.purchaseProductParams.productIdType}
                </Text>
                <Text style={styles.debugText}>
                  Length: {debugInfo.purchaseProductParams.productIdLength}
                </Text>
                <Text style={styles.debugText}>
                  Is Null: {debugInfo.purchaseProductParams.productIdIsNull ? 'YES ⚠️' : 'NO'}
                </Text>
                <Text style={styles.debugText}>
                  Is Undefined: {debugInfo.purchaseProductParams.productIdIsUndefined ? 'YES ⚠️' : 'NO'}
                </Text>
                <Text style={styles.debugText}>
                  Trimmed: {debugInfo.purchaseProductParams.productIdTrimmed}
                </Text>
                <Text style={styles.debugText}>
                  Plan: {debugInfo.purchaseProductParams.plan}
                </Text>
                <Text style={styles.debugSectionTitle}>Stack Trace:</Text>
                <Text style={[styles.debugTextSmall, styles.debugCode]}>
                  {debugInfo.purchaseProductParams.stack || 'No stack'}
                </Text>
              </View>
            )}

            {debugInfo.iapServiceReceived && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>📥 IAP Service Received</Text>
                <Text style={styles.debugText}>
                  Product ID: {debugInfo.iapServiceReceived.productIdValue || 'undefined'}
                </Text>
                <Text style={[styles.debugText, { color: debugInfo.iapServiceReceived.productIdPassesValidation ? '#22c55e' : '#ef4444' }]}>
                  Passes Validation: {debugInfo.iapServiceReceived.productIdPassesValidation ? '✅ YES' : '❌ NO'}
                </Text>
                <Text style={styles.debugText}>
                  Type: {debugInfo.iapServiceReceived.productIdType}
                </Text>
                <Text style={styles.debugText}>
                  Length: {debugInfo.iapServiceReceived.productIdLength}
                </Text>
                <Text style={styles.debugText}>
                  Is Null: {debugInfo.iapServiceReceived.productIdIsNull ? 'YES ⚠️' : 'NO'}
                </Text>
                <Text style={styles.debugText}>
                  Is Undefined: {debugInfo.iapServiceReceived.productIdIsUndefined ? 'YES ⚠️' : 'NO'}
                </Text>
                <Text style={styles.debugText}>
                  Trimmed Value: {debugInfo.iapServiceReceived.productIdTrimmed}
                </Text>
                <Text style={styles.debugText}>
                  Plan: {debugInfo.iapServiceReceived.plan}
                </Text>
              </View>
            )}

            {debugInfo.requestPurchaseParams && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>🚀 Calling requestPurchase</Text>
                <Text style={styles.debugText}>
                  Platform: {debugInfo.requestPurchaseParams.platform}
                </Text>
                <Text style={styles.debugText}>
                  Will Use: {debugInfo.requestPurchaseParams.willUse}
                </Text>
                <Text style={styles.debugSectionTitle}>iOS Params:</Text>
                <Text style={[styles.debugText, styles.debugCode]}>
                  {JSON.stringify(debugInfo.requestPurchaseParams.paramsIOS, null, 2)}
                </Text>
                <Text style={styles.debugSectionTitle}>Android Params:</Text>
                <Text style={[styles.debugText, styles.debugCode]}>
                  {JSON.stringify(debugInfo.requestPurchaseParams.paramsAndroid, null, 2)}
                </Text>
              </View>
            )}

            {debugInfo.purchaseError && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>💥 Purchase Error Details</Text>
                <Text style={[styles.debugText, { color: '#ef4444', fontWeight: 'bold' }]}>
                  Message: {debugInfo.purchaseError.message}
                </Text>
                <Text style={styles.debugText}>
                  Code: {debugInfo.purchaseError.code || 'None'}
                </Text>
                <Text style={styles.debugText}>
                  Name: {debugInfo.purchaseError.name || 'None'}
                </Text>
                <Text style={styles.debugSectionTitle}>Full Error:</Text>
                <Text style={[styles.debugText, styles.debugCode]}>
                  {debugInfo.purchaseError.fullError || 'No details'}
                </Text>
                {debugInfo.purchaseError.stack && (
                  <>
                    <Text style={styles.debugSectionTitle}>Stack Trace:</Text>
                    <Text style={[styles.debugTextSmall, styles.debugCode]}>
                      {debugInfo.purchaseError.stack}
                    </Text>
                  </>
                )}
              </View>
            )}

            {debugInfo.validationFailure && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>❌ Validation Failure Details</Text>
                <Text style={[styles.debugText, { color: '#ef4444' }]}>
                  Product ID Falsy: {debugInfo.validationFailure.productIdFalsy ? 'YES ⚠️' : 'NO'}
                </Text>
                <Text style={[styles.debugText, { color: '#ef4444' }]}>
                  Not String: {debugInfo.validationFailure.productIdNotString ? 'YES ⚠️' : 'NO'}
                </Text>
                <Text style={[styles.debugText, { color: '#ef4444' }]}>
                  Empty After Trim: {debugInfo.validationFailure.productIdEmptyAfterTrim ? 'YES ⚠️' : 'NO'}
                </Text>
                <Text style={styles.debugText}>
                  Raw Value: {String(debugInfo.validationFailure.productIdRawValue)}
                </Text>
                <Text style={styles.debugText}>
                  Type: {debugInfo.validationFailure.productIdType}
                </Text>
              </View>
            )}

            {debugInfo.lastError && (
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>⚠️ Last Purchase Error</Text>
                <Text style={[styles.debugText, { color: '#ef4444' }]}>
                  Message: {debugInfo.lastError.message}
                </Text>
                {debugInfo.lastError.productId && (
                  <Text style={styles.debugText}>
                    Product ID: {debugInfo.lastError.productId}
                  </Text>
                )}
                {debugInfo.lastError.searchedFor && (
                  <Text style={styles.debugText}>
                    Searched For: {debugInfo.lastError.searchedFor}
                  </Text>
                )}
                {debugInfo.lastError.availableProducts && (
                  <Text style={styles.debugText}>
                    Available: {debugInfo.lastError.availableProducts.join(', ') || 'None'}
                  </Text>
                )}
                <Text style={styles.debugText}>
                  Selected Plan: {debugInfo.lastError.selectedPlan}
                </Text>
                <Text style={styles.debugTextSmall}>
                  Time: {debugInfo.lastError.timestamp ? new Date(debugInfo.lastError.timestamp).toLocaleTimeString() : ''}
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
                setDebugInfo((prev: any) => ({
                  ...prev,
                  timestamp: new Date().toISOString(),
                  iapStatus: iapStatus,
                  productsCount: products.length,
                  manualCheck: true
                }));
              }}
            >
              <Text style={styles.debugButtonText}>🔄 Refresh Debug Info</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.debugButton, { backgroundColor: '#dc2626' }]}
              onPress={async () => {
                try {
                  await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
                } catch (err) {
                  console.error('Failed to mark onboarding as complete:', err);
                }
                try {
                  router.replace('/(tabs)/generate');
                } catch (err) {
                  Alert.alert('Navigation Failed', 'Please restart the app to continue.');
                }
              }}
            >
              <Text style={styles.debugButtonText}>🚀 Force Navigate to Generate</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.debugButton, { backgroundColor: '#f59e0b' }]}
              onPress={() => {
                Alert.alert('Loading State Cleared', 'Note: Purchase state is now managed by the IAP hook.');
              }}
            >
              <Text style={styles.debugButtonText}>⏹️ Clear Loading State</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Debug Button - Enabled for IAP debugging */}
      {!showDebug && (
        <TouchableOpacity
          style={styles.showDebugButton}
          onPress={() => setShowDebug(true)}
        >
          <Text style={styles.showDebugText}>🔧</Text>
        </TouchableOpacity>
      )}
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
  skipContainer: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    fontSize: 13,
    color: '#8a9099',
    textAlign: 'center',
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
