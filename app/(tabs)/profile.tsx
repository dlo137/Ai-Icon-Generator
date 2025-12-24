import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Linking, Platform, Modal, TouchableWithoutFeedback, Keyboard, Animated, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { getCurrentUser, getMyProfile, updateMyProfile, signOut, deleteAccount } from '../../src/features/auth/api';
import { useModal } from '../../src/contexts/ModalContext';
import { useCredits } from '../../src/contexts/CreditsContext';
import { supabase } from '../../lib/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import { getSubscriptionInfo, SubscriptionInfo, getCredits, CreditsInfo } from '../../src/utils/subscriptionStorage';
import IAPService from '../../services/IAPService';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function ProfileScreen() {
  // Hard deletion guard to prevent recreation and repeated deletes
  const isDeletingRef = useRef(false);
  
  const storeUrl = Platform.OS === 'android'
    ? 'https://play.google.com/store/apps/details?id=com.watsonsweb.icongenerator'
    : 'https://apps.apple.com/app/id6755940269?action=write-review';
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: ''
  });
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null);
  const [currentPlan, setCurrentPlan] = useState('Free');
  const [credits, setCredits] = useState<CreditsInfo>({ current: 100, max: 100 });
  const [subscriptionDisplay, setSubscriptionDisplay] = useState({
    plan: 'Free',
    price: '$0.00',
    renewalDate: null as string | null,
    status: 'free',
    isCancelled: false
  });
  const {
    isAboutModalVisible,
    setIsAboutModalVisible,
    isContactModalVisible,
    setIsContactModalVisible,
    isBillingModalVisible,
    setIsBillingModalVisible,
    isBillingManagementModalVisible,
    setIsBillingManagementModalVisible,
  } = useModal();
  const { refreshCredits } = useCredits();
  const [selectedPlan, setSelectedPlan] = useState('pro');
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const router = useRouter();
  const [products, setProducts] = useState<any[]>([]);
  const [iapReady, setIapReady] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [currentPurchaseAttempt, setCurrentPurchaseAttempt] = useState<'starter' | 'value' | 'pro' | null>(null);

  // Platform-specific product IDs - must match App Store Connect / Google Play Console
  const PRODUCT_IDS = Platform.OS === 'ios' ? {
    starter: 'starter.25',
    value: 'value.75',
    pro: 'pro.200',
  } : {
    starter: 'starter.25',
    value: 'value.75',
    pro: 'pro.200',
  };

  // Helper function to format price - always use fallback to show consistent format
  const formatPrice = (fallbackPrice: string) => {
    return fallbackPrice;
  };

  const isIAPAvailable = IAPService.isAvailable();

  // Check if running in Expo Go
  const isExpoGo = Constants.appOwnership === 'expo';

  const settings = [
    { id: 'upgrade', title: 'AI Icon Packs', subtitle: 'Purchase more AI Icons' },
    { id: 'about', title: 'About', subtitle: 'App information' },
    { id: 'billing', title: 'Purchase History', subtitle: 'View your last purchase' },
    // Only show rate button on iOS
    // ...(Platform.OS === 'ios' ? [{
    //   id: 'rate',
    //   title: 'Rate the App',
    //   subtitle: 'Share your feedback on the App Store'
    // }] : []),
  ];

  const subscriptionPlans = [
    {
      id: 'starter',
      name: 'Starter',
      price: '$1.99',
      billingPrice: '$1.99',
      imageLimit: '15 AI Icons',
      description: 'One-time purchase.\nNo auto-renewal'
    },
    {
      id: 'value',
      name: 'Value',
      price: '$5.99',
      billingPrice: '$5.99',
      imageLimit: '45 AI Icons',
      description: 'One-time purchase.\nNo auto-renewal'
    },
    {
      id: 'pro',
      name: 'Pro',
      price: '$14.99',
      billingPrice: '$14.99',
      imageLimit: '120 AI Icons',
      description: 'One-time purchase.\nNo auto-renewal'
    }
  ];


  // Get current subscription data from state
  const getCurrentSubscriptionDisplay = async () => {
    // Try to get from Supabase first
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) {
      return {
        plan: 'Free',
        price: '$0.00',
        renewalDate: null,
        status: 'free'
      };
    }

    const { data: supabaseSubInfo } = await supabase
      .from('profiles')
      .select('is_pro_version, subscription_plan, product_id, purchase_time, price')
      .eq('id', currentUser.id)
      .single();

    if (supabaseSubInfo && supabaseSubInfo.is_pro_version) {
      let price = '';
      let planName = currentPlan;

      // Try to determine from product_id first
      if (supabaseSubInfo.product_id) {
        if (supabaseSubInfo.product_id === 'pro.200') {
          price = '$14.99';
          planName = 'Pro';
        } else if (supabaseSubInfo.product_id === 'value.75') {
          price = '$5.99';
          planName = 'Value';
        } else if (supabaseSubInfo.product_id === 'starter.25') {
          price = '$1.99';
          planName = 'Starter';
        }
      } else if (supabaseSubInfo.subscription_plan) {
        // Fallback to subscription_plan
        if (supabaseSubInfo.subscription_plan === 'pro') {
          price = '$14.99';
          planName = 'Pro';
        } else if (supabaseSubInfo.subscription_plan === 'value') {
          price = '$5.99';
          planName = 'Value';
        } else if (supabaseSubInfo.subscription_plan === 'starter') {
          price = '$1.99';
          planName = 'Starter';
        }
      }
      
      // Use stored price if available
      if (supabaseSubInfo.price) {
        price = supabaseSubInfo.price;
      }

      return {
        plan: planName,
        price: price,
        renewalDate: supabaseSubInfo.purchase_time,
        status: 'active'
      };
    }

    // Fallback to local storage
    if (!subscriptionInfo || !subscriptionInfo.isActive) {
      return {
        plan: 'Free',
        price: '$0.00',
        renewalDate: null,
        status: 'free'
      };
    }

    let price = '';
    let planName = currentPlan;

    if (subscriptionInfo.productId === 'pro.200') {
      price = '$14.99';
      planName = 'Pro';
    } else if (subscriptionInfo.productId === 'value.75') {
      price = '$5.99';
      planName = 'Value';
    } else if (subscriptionInfo.productId === 'starter.25') {
      price = '$1.99';
      planName = 'Starter';
    }

    return {
      plan: planName,
      price: price,
      renewalDate: subscriptionInfo.expiryDate || subscriptionInfo.purchaseDate,
      status: 'active'
    };
  };

  useEffect(() => {
    loadUserData();
    initializeIAP();

    // Fallback: Set IAP ready after 5 seconds if still not ready
    const timeout = setTimeout(() => {
      setIapReady(true);
      console.log('[PROFILE] IAP initialization timeout - unblocking button');
    }, 5000);

    return () => clearTimeout(timeout);
  }, []);

  // Refresh data when screen is focused (important for guest mode)
  useFocusEffect(
    useCallback(() => {
      // Add a small delay to ensure Supabase has processed the update
      const timer = setTimeout(() => {
        loadUserData();
      }, 100);
      
      return () => clearTimeout(timer);
    }, [])
  );

  // IAP callback handler for purchase events
  const handleIAPCallback = useCallback(async (info: any) => {
    console.log('[PROFILE] IAP Callback:', info);

    // Handle successful purchase
    if (info.listenerStatus?.includes('SUCCESS')) {
      console.log('[PROFILE] Purchase successful! Reloading user data...');
      setCurrentPurchaseAttempt(null);
      setIsBillingModalVisible(false);

      // Immediately refresh user data
      try {
        console.log('[PROFILE] Refreshing user data immediately...');
        await loadUserData();
        console.log('[PROFILE] User data refreshed successfully');

        Alert.alert('Success!', 'Your credits have been added. Thank you for your purchase!');
      } catch (error) {
        console.error('[PROFILE] Error refreshing data after purchase:', error);
      }
    }

    // Handle purchase errors/cancellations
    if (info.listenerStatus?.includes('CANCELLED') || info.listenerStatus?.includes('FAILED')) {
      console.log('[PROFILE] Purchase cancelled or failed');
      setCurrentPurchaseAttempt(null);
    }
  }, []);

  const initializeIAP = async () => {
    if (!isIAPAvailable) {
      console.log('[PROFILE] IAP not available on this platform');
      // Set IAP ready to true even if unavailable so button is not stuck
      setIapReady(true);
      return;
    }

    try {
      const initialized = await IAPService.initialize();
      console.log('[PROFILE] IAP initialized:', initialized);
      setIapReady(initialized);

      if (initialized) {
        // Set up IAP callback
        IAPService.setDebugCallback(handleIAPCallback);

        // Check for orphaned transactions
        await IAPService.checkForOrphanedTransactions();

        // Fetch products
        await fetchProducts();
      } else {
        // If initialization failed, still set ready to true to unblock the button
        setIapReady(true);
      }
    } catch (error) {
      console.error('[PROFILE] Error initializing IAP:', error);
      // Set ready to true even on error to prevent button from being stuck
      setIapReady(true);
    }
  };

  const fetchProducts = async (showErrors = false) => {
    if (!isIAPAvailable) {
      if (showErrors) {
        Alert.alert(
          'Setup Required',
          'In-app purchases are not available.\n\n' +
          'To test IAP:\n' +
          '• Use Expo Go for simulated purchases, OR\n' +
          '• Build the app and set up products in App Store Connect\n\n' +
          'Note: Consumable products must be created in App Store Connect before they can be purchased.',
          [{ text: 'OK' }]
        );
      }
      return [];
    }

    console.log('[PROFILE] 🔍 Fetching products...');
    try {
      setLoadingProducts(true);
      const results = await IAPService.getProducts();
      console.log('[PROFILE] 📦 Products received:', results?.length || 0);

      if (results?.length) {
        setProducts(results);
        console.log('[PROFILE] ✅ Products loaded:', results.map(p => `${p.productId}: ${p.price}`).join(', '));
        return results;
      } else {
        setProducts([]);
        console.warn('[PROFILE] ⚠️ No products returned from App Store!');
        console.warn('[PROFILE] Expected product IDs:', ['starter.25', 'value.75', 'pro.200']);
        console.warn('[PROFILE] Make sure products are created in App Store Connect and approved for testing');

        if (showErrors) {
          Alert.alert(
            'Products Not Set Up',
            'Could not load any credit packs.\n\n' +
            'Next Steps:\n' +
            '1. Create consumable IAP products in App Store Connect:\n' +
            '   • starter.25 ($1.99 - 15 AI Icons)\n' +
            '   • value.75 ($5.99 - 45 AI Icons)\n' +
            '   • pro.200 ($14.99 - 120 AI Icons)\n\n' +
            '2. Submit your app for review\n\n' +
            '3. Products will appear after approval\n\n' +
            'For testing: Use Expo Go to simulate purchases without App Store setup.',
            [{ text: 'Got It' }]
          );
        }
        return [];
      }
    } catch (err: any) {
      setProducts([]);
      console.error('[PROFILE] ❌ Error fetching products:', err);
      console.error('[PROFILE] ❌ Error message:', err?.message || 'Unknown error');
      console.error('[PROFILE] ❌ Error code:', err?.code);
      console.error('[PROFILE] ❌ Full error details:', JSON.stringify(err, null, 2));

      if (showErrors) {
        const errorMsg = err?.message || String(err);
        Alert.alert(
          'Failed to Load Products',
          `Error: ${errorMsg}\n\nPlease check:\n` +
          '• Internet connection\n' +
          '• App Store Connect setup\n' +
          '• Console logs for details',
          [{ text: 'OK' }]
        );
      }
      return [];
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadUserData = async () => {
    try {
      const userData = await getCurrentUser();
      if (!userData) {
        router.push('/login');
        return;
      }

      setUser(userData);

      const profileData = await getMyProfile();
      setProfile(profileData);

      if (profileData) {
        setEditForm({
          name: profileData.name || ''
        });
      }

      // Load subscription info from Supabase profile
      const { data: supabaseSubInfo } = await supabase
        .from('profiles')
        .select('subscription_plan, product_id, is_pro_version, purchase_time, price')
        .eq('id', userData.id)
        .single();

      console.log('[PROFILE] Loaded Supabase subscription info:', supabaseSubInfo);

      // Load local subscription info as fallback
      const subInfo = await getSubscriptionInfo();
      setSubscriptionInfo(subInfo);

      // Load credits
      const creditsInfo = await getCredits();
      setCredits(creditsInfo);

      // Determine current plan based on Supabase profile first, then fallback to local storage
      if (supabaseSubInfo && (supabaseSubInfo.product_id || supabaseSubInfo.subscription_plan)) {
        let planName = '';
        let price = '';

        // Try to determine from product_id first (most reliable for IAP)
        if (supabaseSubInfo.product_id) {
          if (supabaseSubInfo.product_id === 'pro.200') {
            planName = 'Pro';
            price = '$14.99';
          } else if (supabaseSubInfo.product_id === 'value.75') {
            planName = 'Value';
            price = '$5.99';
          } else if (supabaseSubInfo.product_id === 'starter.25') {
            planName = 'Starter';
            price = '$1.99';
          }
        } else if (supabaseSubInfo.subscription_plan) {
          // Fallback to subscription_plan
          const plan = supabaseSubInfo.subscription_plan;
          if (plan === 'pro') {
            planName = 'Pro';
            price = '$14.99';
          } else if (plan === 'value') {
            planName = 'Value';
            price = '$5.99';
          } else if (plan === 'starter') {
            planName = 'Starter';
            price = '$1.99';
          }
        }

        // Use stored price if available
        if (supabaseSubInfo.price) {
          price = supabaseSubInfo.price;
        }

        // Default to Pro if no match found
        if (!planName) {
          planName = 'Pro';
          price = '$14.99';
        }

        setCurrentPlan(planName);
        setSubscriptionDisplay({
          plan: planName,
          price: price,
          renewalDate: supabaseSubInfo.purchase_time,
          status: supabaseSubInfo.is_pro_version ? 'active' : 'inactive',
          isCancelled: !supabaseSubInfo.is_pro_version
        });
        
        console.log('[PROFILE] Set subscription display:', { planName, price, renewalDate: supabaseSubInfo.purchase_time });
      } else if (subInfo && subInfo.isActive) {
        // Fallback to local storage
        let planName = '';
        let price = '';

        if (subInfo.productId === 'pro.200') {
          planName = 'Pro';
          price = '$14.99';
        } else if (subInfo.productId === 'value.75') {
          planName = 'Value';
          price = '$5.99';
        } else if (subInfo.productId === 'starter.25') {
          planName = 'Starter';
          price = '$1.99';
        } else {
          // Fallback to Pro
          planName = 'Pro';
          price = '$14.99';
        }

        setCurrentPlan(planName);
        setSubscriptionDisplay({
          plan: planName,
          price: price,
          renewalDate: subInfo.expiryDate || subInfo.purchaseDate,
          status: 'active',
          isCancelled: false
        });
      } else {
        setCurrentPlan('Free');
        setSubscriptionDisplay({
          plan: 'Free',
          price: '$0.00',
          renewalDate: null,
          status: 'free',
          isCancelled: false
        });
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    console.log('[PROFILE] Sign out initiated');
    
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      
      // Only clear onboarding flag
      await AsyncStorage.removeItem('hasCompletedOnboarding');
      console.log('[PROFILE] Cleared onboarding flag');
      
      // Show success alert and redirect
      Alert.alert(
        'Signed Out Successfully',
        'You will see the onboarding screen on next launch.',
        [
          {
            text: 'OK',
            onPress: () => {
              console.log('[PROFILE] Redirecting to onboarding...');
              router.replace('/');
            }
          }
        ]
      );
    } catch (error) {
      console.error('[PROFILE] Sign out error:', error);
      
      Alert.alert(
        'Signed Out',
        'You will see the onboarding screen on next launch.',
        [
          {
            text: 'OK',
            onPress: () => {
              console.log('[PROFILE] Redirecting to onboarding...');
              router.replace('/');
            }
          }
        ]
      );
    }
  };

  const handleSaveProfile = async () => {
    try {
      const updatedProfile = await updateMyProfile(editForm);
      setProfile(updatedProfile);
      setIsEditing(false);
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error) {
      console.error('Profile update error:', error);
      Alert.alert('Error', 'Failed to update profile');
    }
  };

  const handleDeleteAccount = async () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to permanently delete your account? This action cannot be undone and all your data will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              // FIX #1: Hard isDeletingAccount guard
              if (isDeletingRef.current) {
                console.log('[DELETE] Deletion already in progress — aborting');
                return;
              }
              
              isDeletingRef.current = true;

              console.log('[DELETE] Starting account deletion...');

              // Step 1: Delete from Supabase (profile, storage, and sign out)
              await deleteAccount();
              console.log('[DELETE] Supabase account deleted');

              // Step 2: Clear all local data
              await AsyncStorage.multiRemove([
                'device_id',
                'hasCompletedOnboarding',
                'guest_credits',
                'credits',
                'lastAuthCheck',
                'hasValidSession',
                'lastValidAuth'
              ]);
              console.log('[DELETE] Cleared all local data');
              
              // Wait to ensure all operations complete
              await new Promise(resolve => setTimeout(resolve, 500));
              
              console.log('[DELETE] Redirecting to onboarding...');

              // Redirect to onboarding screen
              isDeletingRef.current = false;
              
              // Show success alert first
              Alert.alert(
                'Account Deleted Successfully',
                'All your data has been removed. The app will restart.',
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      // Redirect after alert
                      try {
                        router.replace('/');
                      } catch (navError) {
                        console.error('[DELETE] Router replace failed:', navError);
                        router.push('/');
                      }
                    }
                  }
                ]
              );
            } catch (error: any) {
              // ALWAYS redirect no matter what error occurs
              console.error('[DELETE] Delete account error:', error);

              // Clear storage even on error
              try {
                await AsyncStorage.multiRemove([
                  'device_id',
                  'hasCompletedOnboarding',
                  'guest_credits',
                  'credits',
                  'lastAuthCheck',
                  'hasValidSession',
                  'lastValidAuth'
                ]);
              } catch (clearError) {
                console.error('[DELETE] Failed to clear storage:', clearError);
              }

              // Force redirect even on error
              isDeletingRef.current = false;
              
              Alert.alert(
                'Data Cleared', 
                'All local data has been removed. The app will restart.',
                [
                  {
                    text: 'OK',
                    onPress: () => router.replace('/')
                  }
                ]
              );
            }
          }
        }
      ]
    );
  };

  const handleRateApp = () => {
    Linking.openURL(storeUrl);
  };

  const handleContactSubmit = async () => {
    // Validate form
    if (!contactForm.name || !contactForm.email || !contactForm.subject || !contactForm.message) {
      Alert.alert('Incomplete Form', 'Please fill in all fields before submitting.');
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contactForm.email)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    try {
      // Send email via Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('send-contact-email', {
        body: {
          name: contactForm.name,
          email: contactForm.email,
          subject: contactForm.subject,
          message: contactForm.message,
        },
      });

      if (error) {
        console.error('Error sending email:', error);
        Alert.alert('Error', 'Failed to send message. Please try again later.');
        return;
      }

      // Success
      Alert.alert(
        'Message Sent!',
        'Thank you for your feedback. We\'ll get back to you as soon as possible.',
        [
          {
            text: 'OK',
            onPress: () => {
              setIsContactModalVisible(false);
              setContactForm({ name: '', email: '', subject: '', message: '' });
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error submitting contact form:', error);
      Alert.alert('Error', 'Failed to send message. Please try again later.');
    }
  };

  const simulateUpgradeInExpoGo = async (planId: string) => {
    try {
      console.log('[EXPO GO] Simulating consumable purchase for plan:', planId);

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('User not authenticated');
      }

      console.log('[EXPO GO] User ID:', user.id);

      // Get current credits to add to them
      const { data: profileData } = await supabase
        .from('profiles')
        .select('credits_current, credits_max')
        .eq('id', user.id)
        .single();

      const currentCredits = profileData?.credits_current || 0;
      const currentMax = profileData?.credits_max || 0;

      // Determine credits to add based on consumable pack
      let creditsToAdd = 0;
      switch (planId) {
        case 'pro': creditsToAdd = 120; break;
        case 'value': creditsToAdd = 45; break;
        case 'starter': creditsToAdd = 15; break;
      }

      const newTotal = currentCredits + creditsToAdd;
      // Always increase max to accommodate new total if needed
      const newMax = Math.max(currentMax, newTotal);

      console.log('[EXPO GO] Current credits:', currentCredits, 'Current max:', currentMax);
      console.log('[EXPO GO] Adding', creditsToAdd, 'credits');
      console.log('[EXPO GO] New total:', newTotal, 'New max:', newMax);

      // Update profile - ADD credits (consumable model)
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          subscription_plan: planId,
          is_pro_version: true,
          subscription_id: `expo_go_${planId}_${Date.now()}`,
          purchase_time: new Date().toISOString(),
          credits_current: newTotal,
          credits_max: newMax, // Pack size, or current if current > pack size
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      console.log('[EXPO GO] Simulated consumable purchase successful!');

      // Close modals and reload data
      setIsBillingModalVisible(false);
      setIsBillingManagementModalVisible(false);

      // Immediately refresh user data
      console.log('[EXPO GO] Refreshing user data...');
      await loadUserData();
      console.log('[EXPO GO] User data refreshed successfully');

      // Show success message
      Alert.alert(
        'Success (Expo Go Simulation)',
        `${creditsToAdd} AI Icons added! New total: ${newTotal}/${newMax} AI Icons\n\nNote: This is a simulated purchase for testing in Expo Go.`,
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('[EXPO GO] Simulated purchase error:', error);
      Alert.alert('Error', error.message || 'Failed to simulate purchase');
    }
  };

  const handleSubscribe = async (planId: string) => {
    // Simplified for consumables - just purchase more credits
    if (isExpoGo) {
      await simulateUpgradeInExpoGo(planId);
      return;
    }

    if (!isIAPAvailable) {
      Alert.alert(
        'Setup Required',
        'In-app purchases are not available.\n\n' +
        'To make purchases:\n' +
        '• Test in Expo Go for simulated purchases, OR\n' +
        '• Set up consumable products in App Store Connect (starter.25, value.75, pro.200)'
      );
      return;
    }

    const list = products.length ? products : await fetchProducts(true);
    const productId = PRODUCT_IDS[planId as keyof typeof PRODUCT_IDS];
    const product = list.find(p => p.productId === productId);

    if (!product) {
      Alert.alert(
        'Credit pack not available',
        'We couldn\'t find that credit pack. Please check your internet connection and try again.'
      );
      return;
    }

    // Set the current purchase attempt
    setCurrentPurchaseAttempt(planId as any);
    await handlePurchase(product.productId, planId as 'starter' | 'value' | 'pro');
  };

  const handlePurchase = async (productId: string, plan: 'starter' | 'value' | 'pro') => {
    if (!isIAPAvailable) {
      Alert.alert(
        'Setup Required',
        'In-app purchases are not available.\n\n' +
        'To make purchases:\n' +
        '• Test in Expo Go for simulated purchases, OR\n' +
        '• Set up consumable products in App Store Connect (starter.25, value.75, pro.200)'
      );
      setCurrentPurchaseAttempt(null);
      return;
    }

    try {
      console.log('[PROFILE] Attempting to purchase:', productId, 'for plan:', plan);
      await IAPService.purchaseProduct(productId, plan);

      // On success, close modal and reload data
      setIsBillingModalVisible(false);
      setCurrentPurchaseAttempt(null);

      // Immediately refresh user data
      console.log('[PROFILE] Purchase successful, refreshing user data...');
      await loadUserData();
      console.log('[PROFILE] User data refreshed successfully');
      
      // Force refresh credits in the header
      console.log('[PROFILE] Refreshing credits in header...');
      await refreshCredits();
      
      // Refresh again after a delay to ensure UI updates
      setTimeout(async () => {
        await refreshCredits();
        console.log('[PROFILE] Credits refreshed after delay');
      }, 500);

      // Show success message
      Alert.alert('Success!', 'Your credits have been added. Thank you for your purchase!');
    } catch (e: any) {
      setCurrentPurchaseAttempt(null);
      const msg = String(e?.message || e);

      // Handle user cancellation
      if (/user.*(cancel|abort)/i.test(msg) || /cancel/i.test(msg)) {
        console.log('[PROFILE] Purchase was cancelled by user');
        return;
      }

      if (/item.*unavailable|product.*not.*available/i.test(msg)) {
        Alert.alert('Not available', 'This credit pack isn\'t available for purchase right now.');
        return;
      }

      console.error('[PROFILE] Purchase error:', msg);
      Alert.alert('Purchase error', msg);
    }
  };

  const handleCancelSubscription = async () => {
    Alert.alert(
      'Cancel Subscription',
      'Are you sure you want to cancel your subscription? You will lose access to Pro features at the end of your current billing period.',
      [
        { text: 'Keep Subscription', style: 'cancel' },
        {
          text: 'Cancel Subscription',
          style: 'destructive',
          onPress: async () => {
            try {
              // Note: Subscription cancellation is handled through the app store
              // Users can cancel their subscription through their Apple ID or Google Play account

              // Update subscription display to show cancelled/inactive state
              setSubscriptionDisplay({
                ...subscriptionDisplay,
                status: 'inactive',
                isCancelled: true
              });

              // Reload user data to reflect changes
              await loadUserData();

              Alert.alert(
                'Subscription Cancelled',
                'Your subscription has been cancelled. You will continue to have access to Pro features until the next billing cycle.',
                [{ text: 'OK', onPress: () => setIsBillingManagementModalVisible(false) }]
              );
            } catch (error) {
              console.error('Error cancelling subscription:', error);
              Alert.alert('Error', 'Failed to cancel subscription. Please try again or contact support.');
            }
          }
        }
      ]
    );
  };

  const handleUpgradeFromBilling = async () => {
    setIsBillingManagementModalVisible(false);
    // Ensure products are loaded before opening billing modal
    if (!products.length) {
      console.log('[PROFILE] Fetching products before opening billing modal...');
      await fetchProducts(true);
    }
    setIsBillingModalVisible(true);
  };

  const handleSettingPress = async (settingId: string) => {
    switch (settingId) {
      case 'rate':
        handleRateApp();
        break;
      case 'upgrade':
        // Ensure products are loaded before opening billing modal
        if (!products.length) {
          console.log('[PROFILE] Fetching products before opening billing modal...');
          await fetchProducts(true);
        }
        setIsBillingModalVisible(true);
        break;
      case 'billing':
        setIsBillingManagementModalVisible(true);
        break;
      case 'help':
        setIsContactModalVisible(true);
        break;
      case 'about':
        setIsAboutModalVisible(true);
        break;
      default:
        break;
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.name}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.isGuest
                ? (profile?.name?.charAt(0).toUpperCase() || 'G')
                : (user?.email?.charAt(0).toUpperCase() || '?')
              }
            </Text>
          </View>
          <Text style={styles.email}>
            {user?.isGuest ? (profile?.name || 'Guest') : user?.email}
          </Text>
        </View>


        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>Settings</Text>
          {settings.map((setting) => {
            if (setting.id === 'upgrade') {
              return (
                <LinearGradient
                  key={setting.id}
                  colors={['#14b8a6', '#1e3a8a']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientBorder}
                >
                  <TouchableOpacity
                    style={styles.settingItemWithGradient}
                    onPress={() => handleSettingPress(setting.id)}
                  >
                    <View style={styles.settingContent}>
                      <Text style={styles.settingTitle}>{setting.title}</Text>
                      <Text style={styles.settingSubtitle}>{setting.subtitle}</Text>
                    </View>
                    <Text style={styles.settingArrow}>›</Text>
                  </TouchableOpacity>
                </LinearGradient>
              );
            }

            return (
              <TouchableOpacity
                key={setting.id}
                style={styles.settingItem}
                onPress={() => handleSettingPress(setting.id)}
              >
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>{setting.title}</Text>
                  <Text style={styles.settingSubtitle}>{setting.subtitle}</Text>
                </View>
                <Text style={styles.settingArrow}>›</Text>
              </TouchableOpacity>
            );
          })}
        </View>


        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteAccountButton} onPress={handleDeleteAccount}>
          <Text style={styles.deleteAccountText}>Delete Account</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* About Modal */}
      <Modal
        visible={isAboutModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsAboutModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.aboutModal}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.aboutTitle}>About Ai Icon Generator</Text>

              <View style={styles.aboutSection}>
                <Text style={styles.aboutHeading}>Our Mission</Text>
                <Text style={styles.aboutText}>
                  We're building with AI to help provide creators with more control over their content.
                  Our goal is to empower content creators, small or big, with powerful, intuitive
                  tools that enhance their creative process while maintaining their unique vision and style.
                  Every creator deserves access to professional-grade tools that amplify their creativity.
                </Text>
              </View>

              <View style={styles.aboutSection}>
                <Text style={styles.aboutHeading}>Be Considerate</Text>
                <Text style={styles.aboutText}>
                  We believe in responsible AI usage. Please use our tools thoughtfully and respect
                  others' intellectual property. Always ensure you have proper rights to any images
                  you upload, and consider the impact of AI-generated content on the creative community.
                </Text>
              </View>

              <View style={styles.aboutSection}>
                <Text style={styles.aboutHeading}>Features</Text>
                <Text style={styles.aboutText}>
                  • AI-powered thumbnail generation{'\n'}
                  • Subject and reference image integration{'\n'}
                  • Advanced editing tools with drawing and text{'\n'}
                  • Cloud storage and history management{'\n'}
                  • Cross-platform compatibility
                </Text>
              </View>

              <View style={styles.aboutSection}>
                <Text style={styles.aboutHeading}>Version</Text>
                <Text style={styles.aboutText}>1.0.0</Text>
              </View>

              <View style={styles.aboutSection}>
                <Text style={styles.aboutHeading}>Contact</Text>
                <Text style={styles.aboutText}>
                  Have feedback or suggestions? We'd love to hear from you.
                  Rate us on the app store or reach out through our support channels.
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.aboutCloseButton}
              onPress={() => setIsAboutModalVisible(false)}
            >
              <Text style={styles.aboutCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Contact Form Modal */}
      <Modal
        visible={isContactModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsContactModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={(e: any) => e.stopPropagation()}>
              <View style={styles.contactModal}>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={styles.contactTitle}>Help & Support</Text>
                  <Text style={styles.contactSubtitle}>
                    We're here to help! Send us a message and we'll get back to you as soon as possible.
                  </Text>

                  <View style={styles.contactForm}>
                    <View style={styles.inputContainer}>
                      <Text style={styles.inputLabel}>Name</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Your full name"
                        placeholderTextColor="#8a9099"
                        value={contactForm.name}
                        onChangeText={(text: string) => setContactForm({...contactForm, name: text})}
                      />
                    </View>

                    <View style={styles.inputContainer}>
                      <Text style={styles.inputLabel}>Email</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="your.email@example.com"
                        placeholderTextColor="#8a9099"
                        value={contactForm.email}
                        onChangeText={(text: string) => setContactForm({...contactForm, email: text})}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>

                    <View style={styles.inputContainer}>
                      <Text style={styles.inputLabel}>Subject</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="What's this about?"
                        placeholderTextColor="#8a9099"
                        value={contactForm.subject}
                        onChangeText={(text: string) => setContactForm({...contactForm, subject: text})}
                      />
                    </View>

                    <View style={styles.inputContainer}>
                      <Text style={styles.inputLabel}>Message</Text>
                      <TextInput
                        style={[styles.input, styles.messageInput]}
                        placeholder="Tell us how we can help you..."
                        placeholderTextColor="#8a9099"
                        value={contactForm.message}
                        onChangeText={(text: string) => setContactForm({...contactForm, message: text})}
                        multiline={true}
                        numberOfLines={6}
                        textAlignVertical="top"
                      />
                    </View>
                  </View>
                </ScrollView>

                <View style={styles.contactActions}>
                  <TouchableOpacity
                    style={styles.contactSubmitButton}
                    onPress={handleContactSubmit}
                  >
                    <Text style={styles.contactSubmitText}>Send Message</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.contactCancelButton}
                    onPress={() => setIsContactModalVisible(false)}
                  >
                    <Text style={styles.contactCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Billing Modal */}
      <Modal
        visible={isBillingModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsBillingModalVisible(false)}
      >
        <LinearGradient
          colors={['#050810', '#0d1120', '#08091a']}
          style={styles.gradientModalOverlay}
        >
          {/* Expo Go Banner */}
          {isExpoGo && (
            <View style={styles.expoGoBanner}>
              <Text style={styles.expoGoBannerText}>🧪 Expo Go - Purchases will be simulated</Text>
            </View>
          )}

          {/* Close Button */}
          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={() => setIsBillingModalVisible(false)}
          >
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>


          <ScrollView
            contentContainerStyle={styles.gradientScrollContainer}
            showsVerticalScrollIndicator={false}
          >
            {/* Logo/Icon with Glow */}
            <View style={styles.logoContainer}>
              <View style={styles.logoGlow}>
                <View style={styles.logo}>
                  <Image
                    source={require('../../assets/icon.png')}
                    style={styles.logoImage}
                    resizeMode="contain"
                  />
                </View>
              </View>
            </View>

            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.billingTitle}>Turn Ideas Into Clicks.</Text>
              <Text style={styles.billingSubtitle}>
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
          </ScrollView>

          {/* Continue Button - Fixed at Bottom */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.continueButton, (!iapReady || loadingProducts || currentPurchaseAttempt) && { opacity: 0.6 }]}
              onPress={() => handleSubscribe(selectedPlan)}
              disabled={!iapReady || loadingProducts || !!currentPurchaseAttempt}
            >
              <LinearGradient
                colors={['#1e40af', '#1e3a8a']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.continueGradient}
              >
                <Text style={styles.continueText}>
                  {!iapReady ? 'Connecting...' : loadingProducts ? 'Loading...' : currentPurchaseAttempt ? 'Processing...' : 'Purchase Credits'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </Modal>

      {/* Billing Management Modal */}
      <Modal
        visible={isBillingManagementModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsBillingManagementModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.billingManagementModal}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.billingManagementTitle}>Purchase History</Text>

              <View style={styles.currentPlanSection}>
                <Text style={styles.currentPlanTitle}>Last Purchase</Text>
                <View style={styles.planDetailsCard}>
                  <View style={styles.planInfo}>
                    <Text style={styles.planNameText}>{subscriptionDisplay.plan}</Text>
                    <Text style={styles.planPriceText}>{subscriptionDisplay.price}</Text>
                  </View>
                  {subscriptionDisplay.status === 'active' && (
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusText}>Purchased</Text>
                    </View>
                  )}
                  {subscriptionDisplay.status === 'inactive' && (
                    <View style={styles.inactiveStatusBadge}>
                      <Text style={styles.inactiveStatusText}>Inactive</Text>
                    </View>
                  )}
                </View>

                {subscriptionDisplay.renewalDate && (
                  <View style={styles.renewalInfo}>
                    <Text style={styles.renewalLabel}>Purchase Date</Text>
                    <Text style={styles.renewalDate}>
                      {new Date(subscriptionDisplay.renewalDate).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </Text>
                  </View>
                )}

                <View style={styles.billingActionsContainer}>
                  <TouchableOpacity
                    style={styles.upgradeButton}
                    onPress={handleUpgradeFromBilling}
                  >
                    <Text style={styles.upgradeButtonText}>
                      Purchase More Credits
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.billingCloseButton}
              onPress={() => setIsBillingManagementModalVisible(false)}
            >
              <Text style={styles.billingCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const BG = '#0b0f14';
const CARD = '#151a21';
const BORDER = '#232932';
const TEXT = '#e7ebf0';
const MUTED = '#8a9099';
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
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
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  profileHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 15,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2a3038',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    color: TEXT,
    fontSize: 24,
    fontWeight: 'bold',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: TEXT,
    marginBottom: 4,
  },
  email: {
    fontSize: 16,
    color: MUTED,
    marginBottom: 8,
  },
  plan: {
    fontSize: 14,
    color: TEXT,
    fontWeight: '600',
    backgroundColor: '#2a3038',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  creditsContainer: {
    marginTop: 16,
    backgroundColor: '#1e40af',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#1e40af',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  creditsText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  settingsSection: {
    marginBottom: 32,
    flex: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 16,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  gradientBorder: {
    borderRadius: 12,
    padding: 2,
    marginBottom: 8,
  },
  settingItemWithGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    padding: 16,
    borderRadius: 10,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 14,
    color: MUTED,
  },
  settingArrow: {
    fontSize: 24,
    color: MUTED,
  },
  quickActions: {
    gap: 12,
    marginBottom: 32,
  },
  actionButton: {
    backgroundColor: '#2a3038',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonText: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '600',
  },
  signOutButton: {
    backgroundColor: CARD,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#5a2d2d',
    marginBottom: 20,
  },
  signOutText: {
    color: '#f87171',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteAccountButton: {
    backgroundColor: '#7f1d1d',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#991b1b',
    marginBottom: 12,
  },
  deleteAccountText: {
    color: '#fca5a5',
    fontSize: 16,
    fontWeight: '600',
  },
  editSection: {
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 8,
  },
  input: {
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: TEXT,
  },
  editActions: {
    gap: 12,
    marginTop: 16,
  },
  saveButton: {
    backgroundColor: '#6366f1',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  aboutModal: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 24,
    maxHeight: '80%',
    width: '100%',
    borderWidth: 1,
    borderColor: BORDER,
  },
  aboutTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: TEXT,
    textAlign: 'center',
    marginBottom: 24,
  },
  aboutSection: {
    marginBottom: 20,
  },
  aboutHeading: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 8,
  },
  aboutText: {
    fontSize: 14,
    lineHeight: 20,
    color: MUTED,
  },
  aboutCloseButton: {
    backgroundColor: '#1e40af',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  aboutCloseText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  contactModal: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 24,
    maxHeight: '85%',
    width: '100%',
    borderWidth: 1,
    borderColor: BORDER,
  },
  contactTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: TEXT,
    textAlign: 'center',
    marginBottom: 8,
  },
  contactSubtitle: {
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  contactForm: {
    marginBottom: 16,
  },
  messageInput: {
    height: 120,
    paddingTop: 16,
  },
  contactActions: {
    gap: 12,
  },
  contactSubmitButton: {
    backgroundColor: '#1e40af',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  contactSubmitText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  contactCancelButton: {
    backgroundColor: 'transparent',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  contactCancelText: {
    color: MUTED,
    fontSize: 16,
    fontWeight: '600',
  },
  gradientModalOverlay: {
    flex: 1,
  },
  modalCloseButton: {
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
  modalCloseText: {
    fontSize: 24,
    color: '#ffffff',
    fontWeight: '300',
  },
  shape: {
    position: 'absolute',
    opacity: 0.15,
  },
  triangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 15,
    borderRightWidth: 15,
    borderBottomWidth: 25,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#5b6ef5',
  },
  square: {
    width: 20,
    height: 20,
    backgroundColor: '#3b4fd9',
    transform: [{ rotate: '45deg' }],
  },
  gradientScrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 120,
    paddingBottom: 20,
    justifyContent: 'center',
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
  logoText: {
    fontSize: 50,
  },
  header: {
    marginBottom: 40,
    alignItems: 'center',
  },
  billingTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 36,
  },
  billingSubtitle: {
    fontSize: 15,
    color: '#a0a8b8',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  plansContainer: {
    gap: 16,
    marginBottom: 16,
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
  popularBadge: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    backgroundColor: '#1e40af',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 10,
    shadowColor: '#1e40af',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
  },
  popularText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  disabledPlan: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    opacity: 0.5,
  },
  disabledRadio: {
    borderColor: '#5a6069',
  },
  disabledText: {
    color: '#5a6069',
  },
  activeBadge: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    backgroundColor: '#059669',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 10,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
  },
  activeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  planRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#a0a8b8',
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
    color: '#ffffff',
  },
  planPricing: {
    alignItems: 'flex-end',
  },
  planPrice: {
    fontSize: 14,
    fontWeight: '500',
    color: '#a0a8b8',
  },
  planSubtext: {
    fontSize: 12,
    color: '#a0a8b8',
    opacity: 0.7,
    marginTop: 2,
  },
  trialInfo: {
    fontSize: 13,
    color: '#a0a8b8',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 18,
  },
  buttonContainer: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 10,
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
  billingManagementModal: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 24,
    maxHeight: '80%',
    width: '100%',
    borderWidth: 1,
    borderColor: BORDER,
  },
  billingManagementTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: TEXT,
    textAlign: 'center',
    marginBottom: 24,
  },
  currentPlanSection: {
    marginBottom: 16,
  },
  currentPlanTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 16,
  },
  planDetailsCard: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  planInfo: {
    flex: 1,
  },
  planNameText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: TEXT,
    marginBottom: 4,
  },
  planPriceText: {
    fontSize: 16,
    color: MUTED,
  },
  statusBadge: {
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  inactiveStatusBadge: {
    backgroundColor: '#4b5563',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  inactiveStatusText: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
  },
  renewalInfo: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  renewalLabel: {
    fontSize: 14,
    color: MUTED,
    marginBottom: 4,
  },
  renewalDate: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
  },
  billingActionsContainer: {
    gap: 12,
  },
  upgradeButton: {
    backgroundColor: '#1e40af',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  upgradeButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: 'transparent',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '500',
  },
  billingCloseButton: {
    backgroundColor: 'transparent',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  billingCloseText: {
    color: MUTED,
    fontSize: 16,
    fontWeight: '600',
  },
});