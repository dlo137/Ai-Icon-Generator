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
  console.log('[PLAN DETECTION] ========================================');
  console.log('[PLAN DETECTION] Input productId:', productId);
  console.log('[PLAN DETECTION] Input type:', typeof productId);

  // Ensure we have a string and make it lowercase for case-insensitive matching
  const normalizedId = String(productId || '').toLowerCase();
  console.log('[PLAN DETECTION] Normalized ID:', normalizedId);

  let plan: SubscriptionPlan;

  // Check for plan type in order (most specific first)
  if (normalizedId.includes('yearly') || normalizedId.includes('year')) {
    plan = 'yearly';
    console.log('[PLAN DETECTION] ✓ Matched: yearly');
  } else if (normalizedId.includes('monthly') || normalizedId.includes('month')) {
    plan = 'monthly';
    console.log('[PLAN DETECTION] ✓ Matched: monthly');
  } else if (normalizedId.includes('weekly') || normalizedId.includes('week')) {
    plan = 'weekly';
    console.log('[PLAN DETECTION] ✓ Matched: weekly');
  } else {
    // Default to weekly if no match
    plan = 'weekly';
    console.log('[PLAN DETECTION] ⚠️ No match found, defaulting to: weekly');
  }

  console.log('[PLAN DETECTION] Final detected plan:', plan);
  console.log('[PLAN DETECTION] ========================================');
  return plan;
}

/**
 * Update user's subscription information in Supabase profile table
 */
export async function updateSubscriptionInProfile(
  productId: string,
  purchaseId: string,
  purchaseTime?: string
): Promise<void> {
  console.log('[SUBSCRIPTION API] ========== START UPDATE ==========');
  console.log('[SUBSCRIPTION API] Product ID:', productId);
  console.log('[SUBSCRIPTION API] Purchase ID:', purchaseId);
  console.log('[SUBSCRIPTION API] Purchase Time:', purchaseTime);

  try {
    // Get current user
    console.log('[SUBSCRIPTION API] Getting current user...');
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError) {
      console.error('[SUBSCRIPTION API] ❌ User error:', userError);
      throw new Error(`User authentication error: ${userError.message}`);
    }

    if (!user) {
      console.error('[SUBSCRIPTION API] ❌ No user found');
      throw new Error('User not authenticated - no user object');
    }

    console.log('[SUBSCRIPTION API] ✅ User authenticated:', user.id);
    console.log('[SUBSCRIPTION API] User email:', user.email);

    // Ensure subscription_id is never null/undefined
    let subscriptionId = purchaseId;
    if (!subscriptionId) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 15);
      subscriptionId = `${productId}_${timestamp}_${random}`;
      console.log('[SUBSCRIPTION API] ⚠️ Purchase ID was null, generated unique ID:', subscriptionId);
    }

    // Determine plan type from product ID
    const plan = getPlanFromProductId(productId);
    console.log('[SUBSCRIPTION API] Detected plan:', plan);

    // Get price for the plan
    const price = getPriceForPlan(plan);
    console.log('[SUBSCRIPTION API] Plan price:', price);

    // Check if it's a trial (only yearly has trial)
    const isTrial = plan === 'yearly';

    // Determine credits based on plan
    let credits_max = 0;
    switch (plan) {
      case 'yearly': credits_max = 90; break;
      case 'monthly': credits_max = 75; break;
      case 'weekly': credits_max = 10; break;
    }
    console.log('[SUBSCRIPTION API] Credits:', credits_max);

    // Calculate subscription end date based on plan
    const now = new Date();
    const startDate = purchaseTime || now.toISOString();
    const endDate = new Date(startDate);
    if (plan === 'weekly') {
      endDate.setDate(endDate.getDate() + 7);
    } else if (plan === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (plan === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // Get user's name/email for the name field
    // Try multiple sources for Google OAuth and other providers
    const userName = user?.user_metadata?.full_name ||
                    user?.user_metadata?.name ||
                    user?.user_metadata?.display_name ||
                    user?.identities?.[0]?.identity_data?.full_name ||
                    user?.identities?.[0]?.identity_data?.name ||
                    user?.email?.split('@')[0] ||
                    'User';

    console.log('[SUBSCRIPTION API] Extracted user name:', userName);
    console.log('[SUBSCRIPTION API] User metadata:', JSON.stringify(user?.user_metadata, null, 2));
    console.log('[SUBSCRIPTION API] User identities:', JSON.stringify(user?.identities, null, 2));

    // Prepare subscription data with all necessary fields
    const subscriptionData = {
      subscription_plan: plan,
      subscription_id: subscriptionId,
      price: price,
      purchase_time: startDate,
      is_pro_version: true, // Always true for any paid plan
      is_trial_version: isTrial,
      trial_end_date: isTrial ? calculateTrialEndDate() : null,
      credits_current: credits_max,
      credits_max: credits_max,
      last_credit_reset: startDate,
      subscription_start_date: startDate,
      subscription_end_date: endDate.toISOString(),
      product_id: productId,
      name: userName,
      email: user?.email || null,
    };

    console.log('[SUBSCRIPTION API] Prepared subscription data:', JSON.stringify(subscriptionData, null, 2));

    // Check if profile exists
    console.log('[SUBSCRIPTION API] Checking if profile exists...');
    const { data: existingProfile, error: checkError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('[SUBSCRIPTION API] ❌ Error checking profile:', JSON.stringify(checkError, null, 2));
      throw checkError;
    }

    console.log('[SUBSCRIPTION API] Profile exists:', !!existingProfile);

    if (!existingProfile) {
      // Profile doesn't exist, create it first
      console.log('[SUBSCRIPTION API] Creating new profile for user:', user.id);
      const insertData = {
        id: user.id,
        email: user.email,
        name: userName,
        ...subscriptionData
      };
      console.log('[SUBSCRIPTION API] Insert data:', JSON.stringify(insertData, null, 2));

      const { data: insertResult, error: insertError } = await supabase
        .from('profiles')
        .insert(insertData)
        .select();

      if (insertError) {
        console.error('[SUBSCRIPTION API] ❌ Insert error:', JSON.stringify(insertError, null, 2));
        console.error('[SUBSCRIPTION API] ❌ Error code:', insertError.code);
        console.error('[SUBSCRIPTION API] ❌ Error message:', insertError.message);
        console.error('[SUBSCRIPTION API] ❌ Error details:', insertError.details);
        console.error('[SUBSCRIPTION API] ❌ Error hint:', insertError.hint);
        throw new Error(`Failed to create profile: ${insertError.message} (${insertError.code})`);
      }
      console.log('[SUBSCRIPTION API] ✅ Profile created successfully:', insertResult);
    } else {
      // Profile exists, update it
      console.log('[SUBSCRIPTION API] Updating existing profile...');
      console.log('[SUBSCRIPTION API] Update data:', JSON.stringify(subscriptionData, null, 2));

      const { data: updateResult, error: updateError } = await supabase
        .from('profiles')
        .update(subscriptionData)
        .eq('id', user.id)
        .select();

      if (updateError) {
        console.error('[SUBSCRIPTION API] ❌ Update error:', JSON.stringify(updateError, null, 2));
        console.error('[SUBSCRIPTION API] ❌ Error code:', updateError.code);
        console.error('[SUBSCRIPTION API] ❌ Error message:', updateError.message);
        console.error('[SUBSCRIPTION API] ❌ Error details:', updateError.details);
        console.error('[SUBSCRIPTION API] ❌ Error hint:', updateError.hint);
        throw new Error(`Failed to update profile: ${updateError.message} (${updateError.code})`);
      }
      console.log('[SUBSCRIPTION API] ✅ Profile updated successfully:', updateResult);
    }

    console.log('[SUBSCRIPTION API] ========== UPDATE COMPLETE ==========');
  } catch (error: any) {
    console.error('[SUBSCRIPTION API] ❌❌❌ FATAL ERROR ❌❌❌');
    console.error('[SUBSCRIPTION API] Error type:', typeof error);
    console.error('[SUBSCRIPTION API] Error message:', error?.message || 'Unknown error');
    console.error('[SUBSCRIPTION API] Error stack:', error?.stack);
    console.error('[SUBSCRIPTION API] Full error:', JSON.stringify(error, null, 2));
    console.error('[SUBSCRIPTION API] ========================================');
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

    // Determine credits based on new plan
    let credits_max = 0;
    switch (newPlan) {
      case 'yearly': credits_max = 90; break;
      case 'monthly': credits_max = 75; break;
      case 'weekly': credits_max = 10; break;
    }

    // Calculate new subscription end date based on plan
    const now = new Date();
    const endDate = new Date();
    if (newPlan === 'weekly') {
      endDate.setDate(endDate.getDate() + 7);
    } else if (newPlan === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (newPlan === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // Determine product_id based on platform and plan
    const Platform = require('react-native').Platform;
    const productId = Platform.OS === 'ios'
      ? `icon.${newPlan}`
      : `ai.icon.pro:${newPlan}`;

    // Update the subscription plan with all necessary fields
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        subscription_plan: newPlan,
        price: newPrice,
        is_trial_version: false,
        trial_end_date: null,
        credits_current: credits_max,
        credits_max: credits_max,
        last_credit_reset: now.toISOString(),
        subscription_end_date: endDate.toISOString(),
        product_id: productId,
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error changing plan:', updateError);
      throw updateError;
    }

    console.log(`Successfully changed plan to ${newPlan} with ${credits_max} credits`);
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
