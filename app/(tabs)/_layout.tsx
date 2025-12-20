import { Tabs, useRouter, useFocusEffect } from 'expo-router';
import { View, Text, TouchableOpacity } from 'react-native';
import { ModalProvider, useModal } from '../../src/contexts/ModalContext';
import { useCredits } from '../../src/contexts/CreditsContext';
import HeaderLeft from '../../src/components/HeaderLeft';
import { useState, useEffect, useCallback } from 'react';
import { getSubscriptionInfo, SubscriptionInfo, initializeCredits } from '../../src/utils/subscriptionStorage';
import { checkUserSession } from '../../src/utils/sessionManager';

function TabsContent() {
  const router = useRouter();
  const { setIsBillingModalVisible } = useModal();
  const { credits, refreshCredits } = useCredits();
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    checkAuthAndInitialize();
  }, []);

  const checkAuthAndInitialize = async () => {
    try {
      // Check authentication status first
      const sessionInfo = await checkUserSession();
      
      // Also check onboarding completion to avoid redirecting completed users
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const hasCompletedOnboarding = await AsyncStorage.getItem('hasCompletedOnboarding');
      
      console.log('[TABS] Auth check:', {
        authenticated: sessionInfo.isAuthenticated,
        isGuest: sessionInfo.isGuest,
        hasCompletedOnboarding: hasCompletedOnboarding === 'true'
      });
      
      // If not authenticated AND hasn't completed onboarding, redirect to welcome
      if (!sessionInfo.isAuthenticated && hasCompletedOnboarding !== 'true') {
        console.log('[TABS] No valid session and no onboarding completion - redirecting to welcome');
        router.replace('/');
        return;
      }
      
      // If completed onboarding but no current session, allow access (session might have expired)
      if (!sessionInfo.isAuthenticated && hasCompletedOnboarding === 'true') {
        console.log('[TABS] Onboarding completed but no active session - allowing access');
        // Don't redirect - let user access the app
      }
      
      console.log('[TABS] User has access - initializing app');
      
      // Initialize credits and subscription info
      await initializeCredits();
      await loadSubscriptionInfo();
      await refreshCredits();
      
      setIsCheckingAuth(false);
    } catch (error) {
      console.error('[TABS] Error during auth check:', error);
      
      // Even on error, check if onboarding was completed
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const hasCompletedOnboarding = await AsyncStorage.getItem('hasCompletedOnboarding');
        if (hasCompletedOnboarding === 'true') {
          console.log('[TABS] Error occurred but onboarding completed - allowing access');
          setIsCheckingAuth(false);
          return;
        }
      } catch (fallbackError) {
        console.error('[TABS] Fallback onboarding check failed:', fallbackError);
      }
      
      router.replace('/');
    }
  };

  // Refresh credits when any tab gains focus
  useFocusEffect(
    useCallback(() => {
      refreshCredits();
    }, [])
  );

  const loadSubscriptionInfo = async () => {
    const subInfo = await getSubscriptionInfo();
    setSubscriptionInfo(subInfo);
  };


  const handleGetPro = () => {
    router.push('/(tabs)/profile');
    setTimeout(() => setIsBillingModalVisible(true), 100);
  };

  // Show loading while checking authentication
  if (isCheckingAuth) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000' }}>
        <Text style={{ color: '#ffffff', fontSize: 16 }}>Loading...</Text>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#9ca3af',
        tabBarInactiveTintColor: '#6b7280',
        tabBarStyle: {
          backgroundColor: '#000000',
          borderTopColor: '#000000',
          paddingBottom: 15,
          paddingTop: 5,
          height: 75,
        },
        headerStyle: {
          backgroundColor: '#000000',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        headerLeft: () => <HeaderLeft />,
        headerRight: () => (
          <View
            style={{
              marginRight: 15,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: 'rgba(0, 122, 255, 0.5)',
              backgroundColor: 'transparent',
            }}
          >
            <Text style={{
              color: '#ffffff',
              fontSize: 11,
              fontWeight: '600',
              textAlign: 'center',
              letterSpacing: 0.2,
            }}>
              {credits.current}/{credits.max} icons
            </Text>
          </View>
        ),
      }}
    >
      <Tabs.Screen
        name="generate"
        options={{
          title: 'Generator',
          tabBarIcon: ({ color }) => (
            <View style={{
              width: 22,
              height: 18,
              borderWidth: 2,
              borderColor: color,
              borderRadius: 2,
              position: 'relative'
            }}>
              <View style={{
                position: 'absolute',
                top: 2,
                left: 2,
                width: 6,
                height: 6,
                backgroundColor: color,
                borderRadius: 3
              }} />
              <View style={{
                position: 'absolute',
                bottom: 2,
                left: 2,
                right: 2,
                height: 2,
                backgroundColor: color
              }} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Icons',
          tabBarIcon: ({ color }) => (
            <View style={{ flexDirection: 'row', gap: 2 }}>
              <View style={{
                width: 10,
                height: 14,
                borderWidth: 1.5,
                borderColor: color,
                borderRadius: 1,
                backgroundColor: 'transparent'
              }} />
              <View style={{
                width: 10,
                height: 14,
                borderWidth: 1.5,
                borderColor: color,
                borderRadius: 1,
                backgroundColor: 'transparent'
              }} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <View style={{ alignItems: 'center' }}>
              <View style={{
                width: 8,
                height: 8,
                backgroundColor: color,
                borderRadius: 4,
                marginBottom: 1
              }} />
              <View style={{
                width: 14,
                height: 12,
                backgroundColor: color,
                borderTopLeftRadius: 7,
                borderTopRightRadius: 7
              }} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabsLayout() {
  return (
    <ModalProvider>
      <TabsContent />
    </ModalProvider>
  );
}