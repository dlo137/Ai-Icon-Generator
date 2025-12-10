import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking } from 'react-native';

const REVIEW_REQUEST_KEY = '@review_request_last_asked';
const COOLDOWN_DAYS = 30;
const STORE_URL = 'https://apps.apple.com/app/id6753228851?action=write-review';

/**
 * Request app review with 30-day cooldown
 * Only shows the review prompt if 30 days have passed since last request
 */
export const requestReview = async () => {
  try {
    // Check if we've asked recently
    const lastAskedStr = await AsyncStorage.getItem(REVIEW_REQUEST_KEY);

    if (lastAskedStr) {
      const lastAsked = new Date(lastAskedStr);
      const now = new Date();
      const daysSinceLastAsk = (now - lastAsked) / (1000 * 60 * 60 * 24);

      // Don't ask again if within cooldown period
      if (daysSinceLastAsk < COOLDOWN_DAYS) {
        return;
      }
    }

    // Show review prompt
    Alert.alert(
      'Enjoying Ai Icon Generator?',
      'If you love creating icons with our app, would you mind taking a moment to rate us? It really helps!',
      [
        {
          text: 'Not Now',
          style: 'cancel',
          onPress: async () => {
            // Record that we asked even if they declined
            await AsyncStorage.setItem(REVIEW_REQUEST_KEY, new Date().toISOString());
          }
        },
        {
          text: 'Rate App ⭐',
          onPress: async () => {
            // Record that we asked
            await AsyncStorage.setItem(REVIEW_REQUEST_KEY, new Date().toISOString());
            // Open App Store review page
            Linking.openURL(STORE_URL);
          }
        }
      ]
    );
  } catch (error) {
    // Silently fail - don't disrupt user experience
  }
};

/**
 * Reset the cooldown (for testing purposes)
 */
export const resetReviewCooldown = async () => {
  try {
    await AsyncStorage.removeItem(REVIEW_REQUEST_KEY);
  } catch (error) {
    // Silently fail
  }
};
