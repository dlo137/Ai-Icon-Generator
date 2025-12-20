import { View, Text, StyleSheet, Animated } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { isGuestSession } from '../src/utils/guestSession';

export default function LoadingAccountScreen() {
  const router = useRouter();
  const [percent, setPercent] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Animate progress bar
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 5000,
      useNativeDriver: false,
    }).start();

    // Update percent numberJ
    const interval = setInterval(() => {
      setPercent((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          // Navigate to subscription screen for both guests and regular users
          setTimeout(async () => {
            router.push('subscriptionScreen' as any);
          }, 500);
          return 100;
        }
        return prev + 2;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.content}>
        <Text style={styles.percent}>{percent}%</Text>
        <Text style={styles.subtitle}>Setting up your generator</Text>

        <View style={styles.progressBarContainer}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                width: progressWidth,
              },
            ]}
          />
        </View>

        <Text style={styles.statusText}>Customizing your profile</Text>
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
  },
  percent: {
    fontSize: 64,
    fontWeight: 'bold',
    color: TEXT,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 18,
    color: MUTED,
    marginBottom: 48,
    textAlign: 'center',
  },
  progressBarContainer: {
    width: '80%',
    height: 8,
    backgroundColor: '#232932',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#1e40af',
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    color: MUTED,
    marginTop: 12,
    textAlign: 'center',
  },
});