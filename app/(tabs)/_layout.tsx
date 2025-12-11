import { Tabs, useRouter, useFocusEffect } from 'expo-router';
import { View, Text, TouchableOpacity } from 'react-native';
import { ModalProvider, useModal } from '../../src/contexts/ModalContext';
import { CreditsProvider, useCredits } from '../../src/contexts/CreditsContext';
import HeaderLeft from '../../src/components/HeaderLeft';
import { useState, useEffect, useCallback } from 'react';
import { getSubscriptionInfo, SubscriptionInfo, initializeCredits } from '../../src/utils/subscriptionStorage';

function TabsContent() {
  const router = useRouter();
  const { setIsBillingModalVisible } = useModal();
  const { credits, refreshCredits } = useCredits();
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null);

  useEffect(() => {
    initializeCredits();
    loadSubscriptionInfo();
    refreshCredits();
  }, []);

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
              {credits.current}/{credits.max} images
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
    <CreditsProvider>
      <ModalProvider>
        <TabsContent />
      </ModalProvider>
    </CreditsProvider>
  );
}