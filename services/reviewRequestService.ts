// reviewRequestService.ts - Request app store reviews from users
import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REVIEW_REQUEST_KEY = 'review_request_data';
const MIN_ACTIONS_BEFORE_REVIEW = 3; // Request review after 3 successful actions
const DAYS_BETWEEN_PROMPTS = 30; // Wait 30 days between review prompts

interface ReviewRequestData {
  actionCount: number;
  lastPromptDate: string | null;
  hasReviewed: boolean;
}

/**
 * Request app review from user based on usage patterns
 * Should be called after positive user interactions (successful downloads, generations, etc.)
 */
export async function requestReview(): Promise<void> {
  try {
    // Check if StoreReview is available on this platform
    const isAvailable = await StoreReview.hasAction();
    if (!isAvailable) {
      console.log('[Review] StoreReview not available on this platform');
      return;
    }

    // Get current review request data
    const dataString = await AsyncStorage.getItem(REVIEW_REQUEST_KEY);
    const data: ReviewRequestData = dataString
      ? JSON.parse(dataString)
      : { actionCount: 0, lastPromptDate: null, hasReviewed: false };

    // Don't prompt if user has already reviewed
    if (data.hasReviewed) {
      return;
    }

    // Increment action count
    data.actionCount += 1;

    // Check if we should show the review prompt
    const shouldPrompt = shouldShowReviewPrompt(data);

    if (shouldPrompt) {
      // Request review
      await StoreReview.requestReview();

      // Update last prompt date
      data.lastPromptDate = new Date().toISOString();

      console.log('[Review] Review prompt shown');
    }

    // Save updated data
    await AsyncStorage.setItem(REVIEW_REQUEST_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('[Review] Error requesting review:', error);
    // Silently fail - don't interrupt user experience
  }
}

/**
 * Mark that the user has reviewed the app
 * Call this if you detect the user has left a review
 */
export async function markAsReviewed(): Promise<void> {
  try {
    const dataString = await AsyncStorage.getItem(REVIEW_REQUEST_KEY);
    const data: ReviewRequestData = dataString
      ? JSON.parse(dataString)
      : { actionCount: 0, lastPromptDate: null, hasReviewed: false };

    data.hasReviewed = true;
    await AsyncStorage.setItem(REVIEW_REQUEST_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('[Review] Error marking as reviewed:', error);
  }
}

/**
 * Reset review request data (useful for testing)
 */
export async function resetReviewData(): Promise<void> {
  try {
    await AsyncStorage.removeItem(REVIEW_REQUEST_KEY);
    console.log('[Review] Review data reset');
  } catch (error) {
    console.error('[Review] Error resetting review data:', error);
  }
}

/**
 * Determine if we should show the review prompt
 */
function shouldShowReviewPrompt(data: ReviewRequestData): boolean {
  // Must have completed minimum number of actions
  if (data.actionCount < MIN_ACTIONS_BEFORE_REVIEW) {
    return false;
  }

  // If never prompted before, show it
  if (!data.lastPromptDate) {
    return true;
  }

  // Check if enough time has passed since last prompt
  const lastPrompt = new Date(data.lastPromptDate);
  const daysSinceLastPrompt = (Date.now() - lastPrompt.getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceLastPrompt >= DAYS_BETWEEN_PROMPTS;
}
