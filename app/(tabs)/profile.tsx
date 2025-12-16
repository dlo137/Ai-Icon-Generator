import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Linking, Platform, Modal, TouchableWithoutFeedback, Keyboard, Animated, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { getCurrentUser, getMyProfile, updateMyProfile, signOut, deleteAccount } from '../../src/features/auth/api';
import { useModal } from '../../src/contexts/ModalContext';
import { supabase } from '../../lib/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import { getSubscriptionInfo, SubscriptionInfo, getCredits, CreditsInfo } from '../../src/utils/subscriptionStorage';
import { getSubscriptionInfo as getSupabaseSubscriptionInfo, changePlan, cancelSubscription, SubscriptionPlan } from '../../src/features/subscription/api';
import * as StoreReview from 'expo-store-review';
import IAPService from '../../services/IAPService';
import Constants from 'expo-constants';

export default function ProfileScreen() {
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
    plan: 'Free Plan',
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
  const [selectedPlan, setSelectedPlan] = useState('yearly');
  const fadeAnim = useRef(new Animated.Value(0)).current;
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
  const [currentPurchaseAttempt, setCurrentPurchaseAttempt] = useState<'monthly' | 'yearly' | 'weekly' | null>(null);

  // Platform-specific product IDs (must match subscriptionScreen.tsx)
  const PRODUCT_IDS = Platform.OS === 'ios' ? {
    yearly: 'icon.yearly',
    monthly: 'icon.monthly',
    weekly: 'icon.weekly',
  } : {
    yearly: 'ai.icon.pro:yearly',
    monthly: 'ai.icon.pro:monthly',
    weekly: 'ai.icon.pro:weekly',
  };

  const isIAPAvailable = IAPService.isAvailable();

  // Check if running in Expo Go
  const isExpoGo = Constants.appOwnership === 'expo';

  const settings = [
    { id: 'about', title: 'About', subtitle: 'App information' },
    { id: 'upgrade', title: 'Plans', subtitle: 'Choose a subscription plan' },
    { id: 'billing', title: 'Billing & Subscription', subtitle: 'Manage your current subscription' },
    // Only show rate button on iOS
    // ...(Platform.OS === 'ios' ? [{
    //   id: 'rate',
    //   title: 'Rate the App',
    //   subtitle: 'Share your feedback on the App Store'
    // }] : []),
  ];

  const subscriptionPlans = [
    {
      id: 'weekly',
      name: 'Weekly',
      price: '$2.99/week',
      billingPrice: '$2.99',
      imageLimit: '10 images per week',
      description: 'Billed weekly at $2.99.\nCancel anytime'
    },
    {
      id: 'monthly',
      name: 'Monthly',
      price: '$5.99/month',
      billingPrice: '$5.99',
      imageLimit: '75 images per month',
      description: 'Billed monthly at $5.99.\nCancel anytime'
    },
    {
      id: 'yearly',
      name: 'Yearly',
      price: '$59.99/year',
      billingPrice: '$59.99',
      imageLimit: '90 images per month',
      description: 'Billed yearly at $59.99.\nCancel anytime'
    }
  ];


  // Get current subscription data from state
  const getCurrentSubscriptionDisplay = async () => {
    // Try to get from Supabase first
    const supabaseSubInfo = await getSupabaseSubscriptionInfo();

    if (supabaseSubInfo && supabaseSubInfo.is_pro_version) {
      let price = '';
      let planName = currentPlan;

      if (supabaseSubInfo.subscription_plan === 'yearly') {
        price = '$59.99/year';
        planName = 'Yearly Plan';
      } else if (supabaseSubInfo.subscription_plan === 'monthly') {
        price = '$5.99/month';
        planName = 'Monthly Plan';
      } else if (supabaseSubInfo.subscription_plan === 'weekly') {
        price = '$2.99/week';
        planName = 'Weekly Plan';
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
        plan: 'Free Plan',
        price: '$0.00',
        renewalDate: null,
        status: 'free'
      };
    }

    let price = '';
    let planName = currentPlan;

    if (subscriptionInfo.productId === 'icon.yearly') {
      price = '$59.99/year';
    } else if (subscriptionInfo.productId === 'icon.monthly') {
      price = '$5.99/month';
    } else if (subscriptionInfo.productId === 'icon.weekly') {
      price = '$2.99/week';
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
      loadUserData();
    }, [])
  );

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
        Alert.alert('IAP Unavailable', 'In-app purchases are not available on this platform.');
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
        console.log('[PROFILE] ✅ Products loaded successfully:');
        results.forEach(p => {
          console.log(`[PROFILE]   - ${(p as any).productId}: ${p.price} (${p.title})`);
        });
        return results;
      } else {
        setProducts([]);
        console.warn('[PROFILE] ⚠️ No products returned from App Store');
        console.warn('[PROFILE] ⚠️ Check console logs above for detailed error info');

        if (showErrors) {
          Alert.alert(
            'No Products Found',
            'Could not load any subscription products.\n\n' +
            'Possible causes:\n' +
            '• Products not created in App Store Connect\n' +
            '• Bundle ID mismatch\n' +
            '• Paid Apps Agreement not signed\n\n' +
            'Check the console logs for detailed error information.',
            [{ text: 'OK' }]
          );
        }
        return [];
      }
    } catch (err: any) {
      setProducts([]);
      console.error('[PROFILE] ❌ Error fetching products:', err);
      console.error('[PROFILE] ❌ Error details:', {
        message: err?.message,
        code: err?.code,
        type: typeof err
      });

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
      // Check if we're in guest mode first
      if ((global as any)?.isGuestMode) {
        // Set guest data without any API calls
        setUser({
          email: 'Guest',
          isGuest: true
        });
        setProfile({
          name: 'Guest User'
        });
        setEditForm({
          name: 'Guest User'
        });
        setCurrentPlan('Free');
        setIsLoading(false);
        return;
      }

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
      const supabaseSubInfo = await getSupabaseSubscriptionInfo();

      // Load local subscription info as fallback
      const subInfo = await getSubscriptionInfo();
      setSubscriptionInfo(subInfo);

      // Load credits
      const creditsInfo = await getCredits();
      setCredits(creditsInfo);

      // Determine current plan based on Supabase profile first, then fallback to local storage
      if (supabaseSubInfo && supabaseSubInfo.subscription_plan) {
        const plan = supabaseSubInfo.subscription_plan;
        let planName = '';
        let price = '';

        if (plan === 'yearly') {
          planName = 'Yearly Plan';
          price = '$59.99/year';
        } else if (plan === 'monthly') {
          planName = 'Monthly Plan';
          price = '$5.99/month';
        } else if (plan === 'weekly') {
          planName = 'Weekly Plan';
          price = '$2.99/week';
        } else {
          planName = 'Pro Plan';
          price = '$0.00';
        }

        setCurrentPlan(planName);
        setSubscriptionDisplay({
          plan: planName,
          price: price,
          renewalDate: supabaseSubInfo.purchase_time,
          status: supabaseSubInfo.is_pro_version ? 'active' : 'inactive',
          isCancelled: !supabaseSubInfo.is_pro_version
        });
      } else if (subInfo && subInfo.isActive) {
        // Fallback to local storage
        let planName = '';
        let price = '';

        if (subInfo.productId === 'icon.yearly') {
          planName = 'Yearly Plan';
          price = '$59.99/year';
        } else if (subInfo.productId === 'icon.monthly') {
          planName = 'Monthly Plan';
          price = '$5.99/month';
        } else if (subInfo.productId === 'icon.weekly') {
          planName = 'Weekly Plan';
          price = '$2.99/week';
        } else {
          planName = 'Pro Plan';
          price = '$0.00';
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
          plan: 'Free Plan',
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
    try {
      if (user?.isGuest) {
        // Clear guest mode
        (global as any).isGuestMode = false;
      } else {
        await signOut();
      }
      router.push('/');
    } catch (error) {
      console.error('Sign out error:', error);
      Alert.alert('Error', 'Failed to sign out');
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
          onPress: () => {
            Alert.alert(
              'Final Confirmation',
              'This will permanently delete your account and all associated data. Type "DELETE" to confirm.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Confirm Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      // Delete the account from Supabase
                      await deleteAccount();

                      // Redirect to index
                      router.replace('/');

                      // Show confirmation after redirect
                      setTimeout(() => {
                        Alert.alert(
                          'Account Deleted',
                          'Your account has been permanently deleted.'
                        );
                      }, 500);
                    } catch (error) {
                      console.error('Delete account error:', error);
                      Alert.alert('Error', 'Failed to delete account. Please try again or contact support.');
                    }
                  }
                }
              ]
            );
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
      console.log('[EXPO GO] Simulating upgrade for plan:', planId);

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('User not authenticated');
      }

      console.log('[EXPO GO] User ID:', user.id);

      // Determine credits based on plan
      let credits_max = 0;
      switch (planId) {
        case 'yearly': credits_max = 90; break;
        case 'monthly': credits_max = 75; break;
        case 'weekly': credits_max = 10; break;
      }

      // Update profile with subscription data
      console.log('[EXPO GO] Updating profile with subscription data...');
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          subscription_plan: planId,
          is_pro_version: true,
          subscription_id: `test_${planId}_${Date.now()}`,
          purchase_time: new Date().toISOString(),
          credits_current: credits_max,
          credits_max: credits_max,
          last_credit_reset: new Date().toISOString()
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      console.log('[EXPO GO] Simulated upgrade successful!');

      // Close modals and reload data
      setIsBillingModalVisible(false);
      setIsBillingManagementModalVisible(false);
      await loadUserData();

      // Show success message
      Alert.alert(
        'Success (Expo Go Simulation)',
        `Your plan has been upgraded to ${planId}!\n\nNote: This is a simulated upgrade for testing in Expo Go.`,
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('[EXPO GO] Simulated upgrade error:', error);
      Alert.alert('Error', error.message || 'Failed to simulate upgrade');
    }
  };

  const handleSubscribe = async (planId: string) => {
    const plan = subscriptionPlans.find(p => p.id === planId);
    if (!plan) return;

    try {
      // Check if user already has an active subscription
      const hasActiveSub = subscriptionDisplay.status === 'active';

      if (hasActiveSub) {
        // This is a plan change (upgrade or downgrade)
        const currentPlanType = subscriptionDisplay.plan.toLowerCase();

        // Determine if this is a downgrade or upgrade
        const planHierarchy = { weekly: 1, monthly: 2, yearly: 3 };
        let currentPlanLevel = 0;
        if (currentPlanType.includes('yearly')) currentPlanLevel = 3;
        else if (currentPlanType.includes('monthly')) currentPlanLevel = 2;
        else if (currentPlanType.includes('weekly')) currentPlanLevel = 1;

        const newPlanLevel = planHierarchy[planId as keyof typeof planHierarchy];
        const isDowngrade = newPlanLevel < currentPlanLevel;
        const isUpgrade = newPlanLevel > currentPlanLevel;

        if (isUpgrade) {
          // Upgrade - requires payment through IAP
          Alert.alert(
            'Upgrade Plan',
            `Upgrading to ${plan.name} requires a new purchase. You will be charged ${plan.billingPrice} now and your current subscription will be cancelled.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Proceed to Payment',
                onPress: async () => {
                  // If running in Expo Go, simulate the upgrade
                  if (isExpoGo) {
                    await simulateUpgradeInExpoGo(planId);
                    return;
                  }

                  // Trigger IAP purchase flow for upgrade
                  if (!isIAPAvailable) {
                    if (__DEV__) {
                      Alert.alert(
                        'Development Mode',
                        'IAP is not available. Would you like to simulate a successful upgrade for testing?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Simulate Upgrade',
                            onPress: async () => {
                              try {
                                const { data: { user }, error: userError } = await supabase.auth.getUser();
                                if (userError || !user) throw new Error('User not authenticated');

                                let credits_max = 0;
                                switch (planId) {
                                  case 'yearly': credits_max = 90; break;
                                  case 'monthly': credits_max = 75; break;
                                  case 'weekly': credits_max = 10; break;
                                }

                                const { error: updateError } = await supabase
                                  .from('profiles')
                                  .update({
                                    subscription_plan: planId,
                                    is_pro_version: true,
                                    subscription_id: `test_${planId}_${Date.now()}`,
                                    purchase_time: new Date().toISOString(),
                                    credits_current: credits_max,
                                    credits_max: credits_max,
                                    last_credit_reset: new Date().toISOString()
                                  })
                                  .eq('id', user.id);

                                if (updateError) throw updateError;

                                setIsBillingModalVisible(false);
                                await loadUserData();
                                Alert.alert('Success (Simulated)', 'Your plan has been upgraded (development mode).');
                              } catch (error) {
                                console.error('Test upgrade error:', error);
                                Alert.alert('Error', 'Failed to upgrade plan.');
                              }
                            }
                          }
                        ]
                      );
                    } else {
                      Alert.alert('Purchases Unavailable', 'In-app purchases are only available on physical devices.');
                    }
                    return;
                  }

                  // Always fetch products fresh to ensure we have the latest
                  console.log('[PROFILE-UPGRADE] Fetching products...');
                  const list = await fetchProducts(true);
                  const productId = PRODUCT_IDS[planId as keyof typeof PRODUCT_IDS];

                  console.log('[PROFILE-UPGRADE] Looking for product:', productId);
                  console.log('[PROFILE-UPGRADE] Available products:', list.length);
                  console.log('[PROFILE-UPGRADE] Product details:', list.map(p => ({
                    productId: (p as any).productId,
                    id: (p as any).id,
                    title: p.title
                  })));

                  const product = list.find(p => (p as any).productId === productId || (p as any).id === productId);

                  if (!product) {
                    console.log('[PROFILE-UPGRADE] ❌ Product not found!');
                    Alert.alert('Plan not available', 'We couldn\'t find that plan. Please try again.');
                    return;
                  }

                  console.log('[PROFILE-UPGRADE] ✅ Product found:', (product as any).productId || (product as any).id);

                  setCurrentPurchaseAttempt(planId as 'monthly' | 'yearly' | 'weekly');
                  await handlePurchase((product as any).productId || (product as any).id);
                }
              }
            ]
          );
        } else if (isDowngrade) {
          // Downgrade - no payment required, just update database
          Alert.alert(
            'Downgrade Plan',
            `Are you sure you want to downgrade to the ${plan.name} plan? Your new plan will take effect on your next billing cycle. No charge will be applied now.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Confirm',
                onPress: async () => {
                  try {
                    await changePlan(planId as SubscriptionPlan);
                    setIsBillingModalVisible(false);
                    await loadUserData();
                    Alert.alert('Plan Changed', `Your plan will be downgraded to ${plan.name} at the end of your current billing cycle.`);
                  } catch (error) {
                    console.error('Error changing plan:', error);
                    Alert.alert('Error', 'Failed to change plan. Please try again.');
                  }
                }
              }
            ]
          );
        }
      } else {
        // New subscription - use IAP
        // If running in Expo Go, simulate the purchase
        if (isExpoGo) {
          await simulateUpgradeInExpoGo(planId);
          return;
        }

        if (!isIAPAvailable) {
          // For development/testing: Allow bypass in development mode
          if (__DEV__) {
            Alert.alert(
              'Development Mode',
              'IAP is not available. Would you like to simulate a successful purchase for testing?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Simulate Purchase',
                  onPress: async () => {
                    try {
                      // Get current user
                      const { data: { user }, error: userError } = await supabase.auth.getUser();
                      if (userError || !user) {
                        throw new Error('User not authenticated');
                      }

                      // Determine credits based on plan
                      let credits_max = 0;
                      switch (planId) {
                        case 'yearly': credits_max = 90; break;
                        case 'monthly': credits_max = 75; break;
                        case 'weekly': credits_max = 10; break;
                      }

                      // Update subscription in Supabase with is_pro_version = true
                      const { error: updateError } = await supabase
                        .from('profiles')
                        .update({
                          subscription_plan: planId,
                          is_pro_version: true,
                          subscription_id: `test_${planId}_${Date.now()}`,
                          purchase_time: new Date().toISOString(),
                          credits_current: credits_max,
                          credits_max: credits_max,
                          last_credit_reset: new Date().toISOString()
                        })
                        .eq('id', user.id);

                      if (updateError) throw updateError;

                      setIsBillingModalVisible(false);
                      await loadUserData();
                      Alert.alert('Success (Simulated)', 'Your subscription has been activated (development mode).');
                    } catch (error) {
                      console.error('Test purchase error:', error);
                      Alert.alert('Error', 'Failed to activate test subscription.');
                    }
                  }
                }
              ]
            );
          } else {
            Alert.alert(
              'Purchases Unavailable',
              'In-app purchases are only available on physical devices with a valid App Store connection.',
              [{ text: 'OK' }]
            );
          }
          return;
        }

        // Always fetch products fresh to ensure we have the latest
        console.log('[PROFILE-NEW-SUB] Fetching products...');
        const list = await fetchProducts(true);
        const productId = PRODUCT_IDS[planId as keyof typeof PRODUCT_IDS];

        console.log('[PROFILE-NEW-SUB] Looking for product:', productId);
        console.log('[PROFILE-NEW-SUB] Available products:', list.length);
        console.log('[PROFILE-NEW-SUB] Product details:', list.map(p => ({
          productId: (p as any).productId,
          id: (p as any).id,
          title: p.title
        })));

        const product = list.find(p => (p as any).productId === productId || (p as any).id === productId);

        if (!product) {
          console.log('[PROFILE-NEW-SUB] ❌ Product not found!');
          Alert.alert(
            'Plan not available',
            'We couldn\'t find that plan. Please check your internet connection and try again.'
          );
          return;
        }

        console.log('[PROFILE-NEW-SUB] ✅ Product found:', (product as any).productId || (product as any).id);

        // Set the current purchase attempt BEFORE starting the purchase
        setCurrentPurchaseAttempt(planId as 'monthly' | 'yearly' | 'weekly');
        await handlePurchase((product as any).productId || (product as any).id);
      }
    } catch (error) {
      setCurrentPurchaseAttempt(null);
      Alert.alert('Error', 'Failed to process subscription. Please try again.');
    }
  };

  const handlePurchase = async (productId: string) => {
    if (!isIAPAvailable) {
      Alert.alert('Purchases unavailable', 'In-app purchases are not available on this device.');
      setCurrentPurchaseAttempt(null);
      return;
    }

    try {
      console.log('[PROFILE] Attempting to purchase:', productId);
      await IAPService.purchaseProduct(productId);

      // On success, close modal and reload data
      setIsBillingModalVisible(false);
      setCurrentPurchaseAttempt(null);
      await loadUserData();

      Alert.alert(
        'Success!',
        'Your subscription has been activated. Thank you for subscribing!',
        [{ text: 'OK' }]
      );
    } catch (e: any) {
      setCurrentPurchaseAttempt(null);
      const msg = String(e?.message || e);

      if (/already.*(owned|subscribed)/i.test(msg)) {
        Alert.alert(
          'Already subscribed',
          'You already have an active subscription. Manage your subscriptions from the App Store.',
          [{ text: 'OK' }]
        );
        return;
      }

      if (/item.*unavailable|product.*not.*available/i.test(msg)) {
        Alert.alert('Not available', 'This plan isn\'t available for purchase right now.');
        return;
      }

      // Handle user cancellation
      if (/user.*(cancel|abort)/i.test(msg) || /cancel/i.test(msg)) {
        console.log('[PROFILE] Purchase was cancelled by user');
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
              // Call the cancel subscription API
              await cancelSubscription();

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
              {user?.isGuest ? 'G' : (user?.email?.charAt(0).toUpperCase() || '?')}
            </Text>
          </View>
          <Text style={styles.email}>{user?.isGuest ? 'Guest' : user?.email}</Text>
          <Text style={styles.plan}>{currentPlan}</Text>
        </View>


        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>Settings</Text>
          {settings.map((setting) => (
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
          ))}
        </View>


        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {!user?.isGuest && (
          <TouchableOpacity style={styles.deleteAccountButton} onPress={handleDeleteAccount}>
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </TouchableOpacity>
        )}
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
              <Text style={styles.billingTitle}>Turn Icons Into Paychecks.</Text>
              <Text style={styles.billingSubtitle}>
                Every click counts. Create and save eye-catching icons that grow your channel, build your audience, and boost your revenue.
              </Text>
            </View>

            {/* Plans */}
            <View style={styles.plansContainer}>
              {subscriptionPlans.map((plan) => {
                // Check if this is the user's active plan
                const isActivePlan = subscriptionDisplay.status === 'active' && (
                  (plan.id === 'yearly' && subscriptionDisplay.plan.includes('Yearly')) ||
                  (plan.id === 'monthly' && subscriptionDisplay.plan.includes('Monthly')) ||
                  (plan.id === 'weekly' && subscriptionDisplay.plan.includes('Weekly'))
                );

                return (
                  <TouchableOpacity
                    key={plan.id}
                    style={[
                      styles.planCard,
                      selectedPlan === plan.id && styles.selectedPlan,
                      isActivePlan && styles.disabledPlan,
                    ]}
                    onPress={() => !isActivePlan && setSelectedPlan(plan.id)}
                    disabled={isActivePlan}
                  >
                    {isActivePlan && (
                      <View style={styles.activeBadge}>
                        <Text style={styles.activeText}>CURRENT PLAN</Text>
                      </View>
                    )}
                    <View style={[styles.planRadio, isActivePlan && styles.disabledRadio]}>
                      {selectedPlan === plan.id && !isActivePlan && <View style={styles.planRadioSelected} />}
                    </View>
                    <View style={styles.planContent}>
                      <Text style={[styles.planName, isActivePlan && styles.disabledText]}>{plan.name}</Text>
                    </View>
                    <View style={styles.planPricing}>
                      <Text style={[styles.planPrice, isActivePlan && styles.disabledText]}>{plan.price}</Text>
                      <Text style={[styles.planSubtext, isActivePlan && styles.disabledText]}>{plan.imageLimit}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
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
                  {!iapReady ? 'Connecting...' : loadingProducts ? 'Loading...' : currentPurchaseAttempt ? 'Processing...' : 'Continue'}
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
              <Text style={styles.billingManagementTitle}>Billing & Subscription</Text>

              <View style={styles.currentPlanSection}>
                <Text style={styles.currentPlanTitle}>Current Plan</Text>
                <View style={styles.planDetailsCard}>
                  <View style={styles.planInfo}>
                    <Text style={styles.planNameText}>{subscriptionDisplay.plan}</Text>
                    <Text style={styles.planPriceText}>{subscriptionDisplay.price}</Text>
                  </View>
                  {subscriptionDisplay.status === 'active' && (
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusText}>Active</Text>
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
                    <Text style={styles.renewalLabel}>Next Billing Date</Text>
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
                      {subscriptionDisplay.status === 'inactive'
                        ? 'Upgrade Plan'
                        : subscriptionDisplay.plan.includes('Yearly') ? 'Downgrade Plan' : 'Upgrade Plan'}
                    </Text>
                  </TouchableOpacity>

                  {subscriptionDisplay.status === 'active' && (
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={handleCancelSubscription}
                    >
                      <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
                    </TouchableOpacity>
                  )}
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