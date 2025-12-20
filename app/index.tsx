import { View, Text, StyleSheet, TouchableOpacity, Image, Animated, ActivityIndicator, Dimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import FloatingParticles from '../src/components/FloatingParticles';
import ConfettiCannon from 'react-native-confetti-cannon';
import * as Haptics from 'expo-haptics';
import TimeChart from '../src/components/TimeChart';
import { checkUserSession, setupAuthListener } from '../src/utils/sessionManager';

export default function WelcomeScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [selectedStruggles, setSelectedStruggles] = useState<string[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showConfetti, setShowConfetti] = useState(true);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const confettiRef = useRef(null);
  const confettiLeftRef = useRef(null);
  const confettiFarLeftRef = useRef(null);
  const confettiDelayed1 = useRef(null);
  const confettiDelayed2 = useRef(null);

  // Check for existing session on mount
  useEffect(() => {
    checkSession();

    // Set up auth state listener for persistent session management
    const subscription = setupAuthListener((isAuthenticated) => {
      // Re-check session when auth state changes
      if (!isAuthenticated) {
        checkSession();
      }
    });

    // Start pulsing glow animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // DEBUG: Add manual AsyncStorage inspection after a delay
    setTimeout(async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const allKeys = await AsyncStorage.getAllKeys();
        const relevantKeys = allKeys.filter(key => 
          key.includes('onboarding') || 
          key.includes('auth') || 
          key.includes('session') ||
          key.includes('supabase')
        );
        // Debug: Check relevant AsyncStorage keys
        
        if (relevantKeys.length > 0) {
          const values = await AsyncStorage.multiGet(relevantKeys);
          // Debug: AsyncStorage values
        }
      } catch (debugError) {
        // Debug inspection failed
      }
    }, 2000);

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Trigger haptic feedback when confetti starts on step 1
  useEffect(() => {
    if (step === 1 && !isCheckingAuth) {
      // Create a longer, deeper vibration pattern
      const triggerHaptics = async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 100);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 200);
      };
      triggerHaptics();
    }
  }, [step, isCheckingAuth]);

  const checkSession = async () => {
    try {
      // Starting authentication check
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      
      // PRIORITY 1: Check onboarding completion FIRST - this overrides everything
      let hasCompletedOnboarding = null;
      try {
        hasCompletedOnboarding = await AsyncStorage.getItem('hasCompletedOnboarding');
        // Check onboarding completion status
      } catch (asyncError) {
        // Error reading onboarding status
      }

      // If user has completed onboarding, go to main app immediately (skip session check)
      if (hasCompletedOnboarding === 'true') {
        // ONBOARDING COMPLETED - Going directly to main app
        router.replace('/(tabs)/generate');
        return;
      }

      // PRIORITY 2: Only check session if onboarding is not completed
      // Onboarding not completed - checking session
      
      let sessionInfo = null;
      try {
        // Wrap session check in timeout to prevent hanging
        const sessionPromise = checkUserSession();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Session check timeout')), 8000)
        );
        
        sessionInfo = await Promise.race([sessionPromise, timeoutPromise]);
        // Session check completed
      } catch (sessionError) {
        // Session check failed or timed out
        
        // If session check fails but onboarding was completed, still go to main app
        if (hasCompletedOnboarding === 'true') {
          // Session failed but onboarding completed - going to main app
          router.replace('/(tabs)/generate');
          return;
        }
        
        // Otherwise continue to onboarding
        // Session failed and no onboarding - showing onboarding
        setIsCheckingAuth(false);
        return;
      }

      // If user is authenticated, they can skip onboarding
      if (sessionInfo && sessionInfo.isAuthenticated) {
        // User authenticated - going to main app
        router.replace('/(tabs)/generate');
        return;
      }

      // Default: Show onboarding for new users
      // New user - showing onboarding flow
      setIsCheckingAuth(false);
      
    } catch (error: any) {
      // Critical error in checkSession
      
      // EMERGENCY FALLBACK: Always check onboarding completion
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const hasCompletedOnboarding = await AsyncStorage.getItem('hasCompletedOnboarding');
        // Emergency fallback - check onboarding status
        
        if (hasCompletedOnboarding === 'true') {
          // EMERGENCY: Onboarding completed - redirecting to main app
          router.replace('/(tabs)/generate');
          return;
        }
      } catch (fallbackError) {
        // Emergency fallback failed
      }
      
      // Final fallback: show onboarding
      // All checks failed - showing onboarding
      setIsCheckingAuth(false);
    }
  };

  const toggleStruggle = (struggle: string) => {
    if (selectedStruggles.includes(struggle)) {
      setSelectedStruggles(selectedStruggles.filter(s => s !== struggle));
    } else {
      setSelectedStruggles([...selectedStruggles, struggle]);
    }
  };

  const handleGetStarted = () => {
    // Prevent rapid clicking during animation
    if (isAnimating) return;

    setIsAnimating(true);

    // Hide confetti immediately to prevent render blocking
    if (step === 1) {
      setShowConfetti(false);
    }

    try {
      // Slide out current content
      Animated.timing(slideAnim, {
        toValue: -1,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        try {
          // Set position for new content (off-screen right) BEFORE updating step
          slideAnim.setValue(1);

          // Now update the step - new content will render at position 1 (off-screen right)
          if (step === 1) {
            setStep(2);
          } else if (step === 2) {
            setStep(3);
          } else if (step === 3) {
            setStep(5);
          } else {
            setIsAnimating(false);
            router.push('/signup');
            return;
          }

          // Wait for next frame to ensure React has rendered the new content
          requestAnimationFrame(() => {
            // Slide in new content from right
            Animated.timing(slideAnim, {
              toValue: 0,
              duration: 250,
              useNativeDriver: true,
            }).start(() => {
              setIsAnimating(false);
            });
          });
        } catch (error) {
          setIsAnimating(false);
        }
      });
    } catch (error) {
      setIsAnimating(false);
      // Fallback navigation
      router.push('/signup');
    }
  };

  const translateX = slideAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-500, 0, 500],
  });

  // Show loading spinner while checking auth
  if (isCheckingAuth) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={[styles.content, { justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color="#22d3ee" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Floating Particles Background */}
      <FloatingParticles />

      <View style={styles.content}>
        {step === 3 ? (
          <Animated.View style={{ transform: [{ translateX }], width: '100%', gap: 24, alignItems: 'center' }}>
            <View style={{ width: '100%' }}>
              <Text style={styles.title}>
                What's slowing down your content growth?
              </Text>
              <Text style={styles.subtitle}>
                Select all that apply
              </Text>
            </View>

            <View style={{ width: '100%', gap: 12, marginTop: 20 }}>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  selectedStruggles.includes('Pricing') && styles.optionButtonSelected
                ]}
                onPress={() => toggleStruggle('Pricing')}
              >
                <View style={[
                  styles.checkbox,
                  selectedStruggles.includes('Pricing') && styles.checkboxSelected
                ]}>
                  {selectedStruggles.includes('Pricing') && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.optionText}>Pricing</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionButton,
                  selectedStruggles.includes('Time') && styles.optionButtonSelected
                ]}
                onPress={() => toggleStruggle('Time')}
              >
                <View style={[
                  styles.checkbox,
                  selectedStruggles.includes('Time') && styles.checkboxSelected
                ]}>
                  {selectedStruggles.includes('Time') && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.optionText}>Time</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionButton,
                  selectedStruggles.includes('Quality Designs') && styles.optionButtonSelected
                ]}
                onPress={() => toggleStruggle('Quality Designs')}
              >
                <View style={[
                  styles.checkbox,
                  selectedStruggles.includes('Quality Designs') && styles.checkboxSelected
                ]}>
                  {selectedStruggles.includes('Quality Designs') && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.optionText}>Quality Designs</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionButton,
                  selectedStruggles.includes('Other') && styles.optionButtonSelected
                ]}
                onPress={() => toggleStruggle('Other')}
              >
                <View style={[
                  styles.checkbox,
                  selectedStruggles.includes('Other') && styles.checkboxSelected
                ]}>
                  {selectedStruggles.includes('Other') && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.optionText}>Other</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        ) : step === 5 ? (
          <Animated.View style={{ transform: [{ translateX }], width: '100%', gap: 16 }}>
            <View>
              <Text style={styles.title}>
                Save instantly.{'\n'}Save 85% of your time & cost.
              </Text>
              <Text style={styles.subtitle}>
                Grow your channel faster
              </Text>
            </View>
            <TimeChart />
          </Animated.View>
        ) : (step === 1 || step === 2) ? (
          <View style={styles.imageContainer}>
            {step === 1 && showConfetti && (
              <View style={styles.confettiWrapper}>
                <ConfettiCannon
                  ref={confettiRef}
                  count={150}
                  origin={{ x: Dimensions.get('window').width / 2, y: -300 }}
                  autoStart={true}
                  fadeOut={true}
                  explosionSpeed={700}
                  fallSpeed={4000}
                  colors={['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe', '#ffffff']}
                />
                <ConfettiCannon
                  ref={confettiLeftRef}
                  count={100}
                  origin={{ x: Dimensions.get('window').width * 0.25, y: -300 }}
                  autoStart={true}
                  fadeOut={true}
                  explosionSpeed={700}
                  fallSpeed={4000}
                  colors={['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe', '#ffffff']}
                />
                <ConfettiCannon
                  ref={confettiFarLeftRef}
                  count={80}
                  origin={{ x: 0, y: -300 }}
                  autoStart={true}
                  fadeOut={true}
                  explosionSpeed={600}
                  fallSpeed={4000}
                  colors={['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe', '#ffffff']}
                />
                <ConfettiCannon
                  ref={confettiDelayed1}
                  count={150}
                  origin={{ x: Dimensions.get('window').width / 2, y: -300 }}
                  autoStart={true}
                  autoStartDelay={1000}
                  fadeOut={true}
                  explosionSpeed={700}
                  fallSpeed={4000}
                  colors={['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe', '#ffffff']}
                />
                <ConfettiCannon
                  ref={confettiDelayed2}
                  count={140}
                  origin={{ x: Dimensions.get('window').width * 0.65, y: -300 }}
                  autoStart={true}
                  autoStartDelay={2000}
                  fadeOut={true}
                  explosionSpeed={680}
                  fallSpeed={4000}
                  colors={['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe', '#ffffff']}
                />
              </View>
            )}
            <Animated.Image
              key={`onboarding-image-${step}`}
              source={step === 1 ? require('../assets/onboarding3.png') : step === 2 ? require('../assets/onboarding2.png') : require('../assets/onboarding3.png')}
              style={[
                styles.heroImage,
                {
                  transform: [{ translateX }],
                },
              ]}
              resizeMode="contain"
            />
          </View>
        ) : null}

{(step === 1 || step === 2) && (
          <Animated.Text
            style={[
              styles.screenTitle,
              {
                transform: [{ translateX }],
              },
            ]}
          >
            {step === 1 ? (
              <>
                Icon Designs{'\n'}Made Easy
              </>
            ) : step === 2 ? (
              <>
                Unlock the Secret Behind Every Viral Icon
              </>
            ) : null}
          </Animated.Text>
        )}

        <TouchableOpacity
          style={[styles.getStartedButton, step === 3 && { marginTop: 40 }]}
          onPress={handleGetStarted}
        >
          <Text style={styles.getStartedButtonText}>
            {step === 1 ? "Get Started" : step === 5 ? "Let's Get Started" : "Continue"}
          </Text>
        </TouchableOpacity>

        <View style={styles.loginContainer}>
          <Text style={styles.loginText}>Already got an account? </Text>
          <TouchableOpacity onPress={() => router.push('/login')}>
            <Text style={styles.loginLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const BG = '#0b0f14';
const TEXT = '#e7ebf0';
const MUTED = '#8a9099';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    gap: 20,
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confettiWrapper: {
    position: 'absolute',
    top: -200,
    left: -25,
    right: -25,
    bottom: 0,
    zIndex: 9999,
  },
  glow: {
    position: 'absolute',
    width: '55%',
    height: 400,
    backgroundColor: '#1e3a8a',
    borderRadius: 200,
    shadowColor: '#1e3a8a',
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowOpacity: 1,
    shadowRadius: 200,
    elevation: 40,
  },
  heroImage: {
    width: '100%',
    height: 500,
    marginTop: -30,
    marginBottom: -30,
    paddingBottom: 40,
    zIndex: 10,
  },
  iconImage: {
    width: 180,
    height: 180,
    marginTop: 0,
    marginBottom: 0,
    alignSelf: 'center',
  },
  screenTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: TEXT,
    marginBottom: 6,
    textAlign: 'center',
  },
  Title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: TEXT,
    marginBottom: 6,
    textAlign: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: TEXT,
    textAlign: 'left',
  },
  subtitle: {
    fontSize: 14,
    color: MUTED,
    textAlign: 'left',
    marginTop: 8,
  },
  getStartedButton: {
    backgroundColor: '#1e40af',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 0,
    shadowColor: '#1e40af',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    width: '90%',
  },
  getStartedButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginText: {
    fontSize: 14,
    color: MUTED,
  },
  loginLink: {
    fontSize: 14,
    color: '#93c5fd',
    fontWeight: '600',
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1f26',
    padding: 18,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2a3340',
    gap: 12,
  },
  optionButtonSelected: {
    borderColor: '#3b82f6',
    backgroundColor: '#1e2a3a',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4b5563',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxSelected: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  optionText: {
    fontSize: 16,
    color: TEXT,
    fontWeight: '500',
  },
  chartCard: {
    backgroundColor: '#1a1f26',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    opacity: 0.75,
  },
  barChartContainer: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 20,
    paddingHorizontal: 0,
  },
  barWrapper: {
    flex: 1,
    alignItems: 'center',
    gap: 12,
    maxWidth: '48%',
  },
  barLabel: {
    fontSize: 14,
    color: TEXT,
    fontWeight: '600',
    textAlign: 'center',
  },
  barSubtext: {
    fontSize: 13,
    color: '#e5e7eb',
    textAlign: 'center',
    marginTop: 16,
  },
  barBackground: {
    width: '100%',
    height: 250,
    backgroundColor: '#0f1419',
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  barFillRed: {
    backgroundColor: '#ef4444',
  },
  barFillBlue: {
    backgroundColor: '#3b82f6',
  },
  barValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
});