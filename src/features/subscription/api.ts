import { supabase } from "../../../lib/supabase";

export type SubscriptionPlan = 'weekly' | 'monthly' | 'yearly';

export interface SubscriptionData {
  subscription_plan: SubscriptionPlan;
  subscription_id: string;
  price: number;
  purchase_time: string;
  is_pro_version: boolean;
  is_trial_version: boolean;
  trial_end_date: string | null;
}

// Get price based on plan
function getPriceForPlan(plan: SubscriptionPlan): number {
  switch (plan) {
    case 'weekly':
      return 2.99;
    case 'monthly':
      return 5.99;
    case 'yearly':
      return 59.99;
    default:
      return 0;
  }
}

// Calculate trial end date (3 days from now)
function calculateTrialEndDate(): string {
  const trialDate = new Date();
  trialDate.setDate(trialDate.getDate() + 3);
  return trialDate.toISOString();
}

// Determine plan from product ID
function getPlanFromProductId(productId: string): SubscriptionPlan {
  if (productId.includes('yearly')) return 'yearly';
  if (productId.includes('monthly')) return 'monthly';
  if (productId.includes('weekly')) return 'weekly';
  return 'weekly'; // default
}

/**
 * Update user's subscription information in Supabase profile table
 */
export async function updateSubscriptionInProfile(
  productId: string,
  purchaseId: string,
  purchaseTime?: string
): Promise<void> {
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    // Determine plan type from product ID
    const plan = getPlanFromProductId(productId);

    // Get price for the plan
    const price = getPriceForPlan(plan);

    // Check if it's a trial (only yearly has trial)
    const isTrial = plan === 'yearly';

    // Prepare subscription data
    const subscriptionData: Partial<SubscriptionData> = {
      subscription_plan: plan,
      subscription_id: purchaseId,
      price: price,
      purchase_time: purchaseTime || new Date().toISOString(),
      is_pro_version: true, // Always true for any paid plan
      is_trial_version: isTrial,
      trial_end_date: isTrial ? calculateTrialEndDate() : null,
    };

    // Update the profile in Supabase
    const { error: updateError } = await supabase
      .from('profiles')
      .update(subscriptionData)
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating subscription in profile:', updateError);
      throw updateError;
    }

    console.log('Successfully updated subscription in profile:', subscriptionData);
  } catch (error) {
    console.error('Failed to update subscription:', error);
    throw error;
  }
}

/**
 * Get user's subscription information from profile
 */
export async function getSubscriptionInfo(): Promise<SubscriptionData | null> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return null;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_plan, subscription_id, price, purchase_time, is_pro_version, is_trial_version, trial_end_date')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching subscription info:', error);
      return null;
    }

    // If no profile exists, return null (no error)
    if (!data) {
      return null;
    }

    return data as SubscriptionData;
  } catch (error) {
    console.error('Failed to get subscription info:', error);
    return null;
  }
}

/**
 * Check if user has an active pro subscription
 */
export async function hasActiveSubscription(): Promise<boolean> {
  const subscriptionInfo = await getSubscriptionInfo();

  if (!subscriptionInfo) {
    return false;
  }

  // If user has pro version enabled
  if (subscriptionInfo.is_pro_version) {
    // If it's a trial, check if trial is still valid
    if (subscriptionInfo.is_trial_version && subscriptionInfo.trial_end_date) {
      const trialEndDate = new Date(subscriptionInfo.trial_end_date);
      const now = new Date();
      return now < trialEndDate; // Trial is still active
    }

    // Not a trial, so subscription is active
    return true;
  }

  return false;
}

/**
 * Change user's subscription plan (for upgrades/downgrades)
 * Does not charge immediately - just updates the plan for next billing cycle
 */
export async function changePlan(newPlan: SubscriptionPlan): Promise<void> {
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    // Get current subscription info
    const currentSub = await getSubscriptionInfo();
    if (!currentSub) {
      throw new Error('No active subscription found');
    }

    // Get price for the new plan
    const newPrice = getPriceForPlan(newPlan);

    // Update the subscription plan
    // Keep existing subscription_id and purchase_time
    // Update is_trial_version to false since plan changes don't include trials
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        subscription_plan: newPlan,
        price: newPrice,
        is_trial_version: false,
        trial_end_date: null,
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error changing plan:', updateError);
      throw updateError;
    }

    console.log(`Successfully changed plan to ${newPlan}`);
  } catch (error) {
    console.error('Failed to change plan:', error);
    throw error;
  }
}

/**
 * Cancel user's subscription
 * Marks the subscription as cancelled but keeps access until end of billing period
 */
export async function cancelSubscription(): Promise<void> {
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    // Get current subscription info
    const currentSub = await getSubscriptionInfo();
    if (!currentSub) {
      throw new Error('No active subscription found');
    }

    // Update the subscription to cancelled state
    // Set is_pro_version to false to indicate cancelled subscription
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        is_pro_version: false,
        is_trial_version: false,
        trial_end_date: null,
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error cancelling subscription:', updateError);
      throw updateError;
    }

    console.log('Successfully cancelled subscription');
  } catch (error) {
    console.error('Failed to cancel subscription:', error);
    throw error;
  }
}
