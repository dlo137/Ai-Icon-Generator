import { supabase } from "../../../lib/supabase";
import { PLAN_CONFIG, type SubscriptionPlan } from './plans';

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
  return PLAN_CONFIG[plan].price;
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

  // Check for consumable pack type
  if (normalizedId.includes('pro') || normalizedId.includes('200')) {
    plan = 'pro';
    console.log('[PLAN DETECTION] ✓ Matched: pro');
  } else if (normalizedId.includes('value') || normalizedId.includes('75')) {
    plan = 'value';
    console.log('[PLAN DETECTION] ✓ Matched: value');
  } else if (normalizedId.includes('starter') || normalizedId.includes('25')) {
    plan = 'starter';
    console.log('[PLAN DETECTION] ✓ Matched: starter');
  } else {
    // Default to starter if no match
    plan = 'starter';
    console.log('[PLAN DETECTION] ⚠️ No match found, defaulting to: starter');
  }

  console.log('[PLAN DETECTION] Final detected plan:', plan);
  console.log('[PLAN DETECTION] ========================================');
  return plan;
}

/**
 * Update user's credits after consumable purchase
 *
 * IMPORTANT: Use the plan the user SELECTED, not what's in the purchase object.
 * Apple's purchase object is unreliable for determining which specific plan was purchased.
 *
 * For consumables: ADD credits to existing balance, don't replace
 */
export async function updateSubscriptionInProfile(
  plan: SubscriptionPlan,
  purchaseId: string,
  purchaseTime?: string
): Promise<void> {
  console.log('[CONSUMABLE API] ========== START PURCHASE ==========');
  console.log('[CONSUMABLE API] Plan (USER SELECTED):', plan);
  console.log('[CONSUMABLE API] Purchase ID:', purchaseId);
  console.log('[CONSUMABLE API] Purchase Time:', purchaseTime);

  try {
    // Get current user (works for both authenticated and anonymous users)
    console.log('[CONSUMABLE API] Getting current user from Supabase auth...');
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    console.log('[CONSUMABLE API] Auth response - user:', user ? 'exists' : 'null');
    console.log('[CONSUMABLE API] Auth response - error:', userError ? userError.message : 'none');

    if (userError) {
      console.error('[CONSUMABLE API] ❌ User error:', userError);
      throw new Error(`User authentication error: ${userError.message}`);
    }

    if (!user) {
      console.error('[CONSUMABLE API] ❌ No user found');
      throw new Error('User not authenticated - no user object');
    }

    console.log('[CONSUMABLE API] ✅ User authenticated:', user.id);
    console.log('[CONSUMABLE API] User email:', user.email);

    // Get plan configuration (single source of truth)
    const config = PLAN_CONFIG[plan];
    const productId = config.productId;
    const price = config.price;
    const creditsToAdd = config.credits;

    console.log('[CONSUMABLE API] Plan config:', {
      productId,
      price,
      creditsToAdd,
    });

    // Ensure purchase_id is never null/undefined
    let purchaseIdFinal = purchaseId;
    if (!purchaseIdFinal) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 15);
      purchaseIdFinal = `${productId}_${timestamp}_${random}`;
      console.log('[CONSUMABLE API] ⚠️ Purchase ID was null, generated unique ID:', purchaseIdFinal);
    }

    const now = new Date();
    const purchaseTimeFinal = purchaseTime || now.toISOString();

    // Check if profile exists and get current credits
    console.log('[CONSUMABLE API] Checking profile and current credits...');
    const { data: existingProfile, error: checkError } = await supabase
      .from('profiles')
      .select('id, credits_current, name')
      .eq('id', user.id)
      .maybeSingle();

    // Get user's name/email for the name field
    // For existing profiles (including guests), use the existing name
    const userName = existingProfile?.name ||
                    user?.user_metadata?.full_name ||
                    user?.user_metadata?.name ||
                    user?.user_metadata?.display_name ||
                    user?.identities?.[0]?.identity_data?.full_name ||
                    user?.identities?.[0]?.identity_data?.name ||
                    user?.email?.split('@')[0] ||
                    'User';

    console.log('[CONSUMABLE API] Extracted user name:', userName);

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('[CONSUMABLE API] ❌ Error checking profile:', JSON.stringify(checkError, null, 2));
      throw checkError;
    }

    const currentCredits = existingProfile?.credits_current || 0;
    const newTotalCredits = currentCredits + creditsToAdd;

    // Denominator logic: Set to pack size, unless current > pack size, then match current
    const newMaxCredits = newTotalCredits > creditsToAdd ? newTotalCredits : creditsToAdd;

    console.log('[CONSUMABLE API] Credits: current =', currentCredits, '+ adding =', creditsToAdd, '= new total =', newTotalCredits);
    console.log('[CONSUMABLE API] Max credits set to:', newMaxCredits, '(pack size:', creditsToAdd, ')');

    // Prepare consumable purchase data
    const purchaseData = {
      subscription_plan: plan,
      subscription_id: purchaseIdFinal,
      price: price,
      purchase_time: purchaseTimeFinal,
      is_pro_version: true, // Set to true when they have credits
      credits_current: newTotalCredits,
      credits_max: newMaxCredits, // Pack size, or current if current > pack size
      product_id: productId,
      name: userName,
      email: user?.email || null,
    };

    console.log('[CONSUMABLE API] ✅ Purchase data prepared from PLAN_CONFIG');
    console.log('[CONSUMABLE API] Data:', JSON.stringify(purchaseData, null, 2));

    console.log('[CONSUMABLE API] Profile exists:', !!existingProfile);
    console.log('[CONSUMABLE API] Profile ID:', existingProfile?.id);

    if (!existingProfile) {
      // Profile doesn't exist, create it
      console.log('[CONSUMABLE API] ⚠️ Creating new profile for user:', user.id);
      const insertData = {
        id: user.id,
        ...purchaseData
      };
      console.log('[CONSUMABLE API] Insert data:', JSON.stringify(insertData, null, 2));

      const { data: insertResult, error: insertError } = await supabase
        .from('profiles')
        .insert(insertData)
        .select();

      if (insertError) {
        console.error('[CONSUMABLE API] ❌ Insert error:', JSON.stringify(insertError, null, 2));
        throw new Error(`Failed to create profile: ${insertError.message} (${insertError.code})`);
      }
      console.log('[CONSUMABLE API] ✅ Profile created successfully:', insertResult);
    } else {
      // Profile exists, update credits (ADD to existing)
      console.log('[CONSUMABLE API] 📝 Updating existing profile with new credits...');
      console.log('[CONSUMABLE API] Profile user ID:', user.id);
      console.log('[CONSUMABLE API] Update data:', JSON.stringify(purchaseData, null, 2));

      const { data: updateResult, error: updateError } = await supabase
        .from('profiles')
        .update(purchaseData)
        .eq('id', user.id)
        .select();

      if (updateError) {
        console.error('[CONSUMABLE API] ❌ Update error:', JSON.stringify(updateError, null, 2));
        console.error('[CONSUMABLE API] Error code:', updateError.code);
        console.error('[CONSUMABLE API] Error message:', updateError.message);
        console.error('[CONSUMABLE API] Error details:', updateError.details);
        throw new Error(`Failed to update profile: ${updateError.message} (${updateError.code})`);
      }
      console.log('[CONSUMABLE API] ✅ Profile updated successfully!');
      console.log('[CONSUMABLE API] Update result:', JSON.stringify(updateResult, null, 2));
    }

    console.log('[CONSUMABLE API] ========== PURCHASE COMPLETE ==========');
  } catch (error: any) {
    console.error('[CONSUMABLE API] ❌❌❌ FATAL ERROR ❌❌❌');
    console.error('[CONSUMABLE API] Error type:', typeof error);
    console.error('[CONSUMABLE API] Error message:', error?.message || 'Unknown error');
    console.error('[CONSUMABLE API] Error stack:', error?.stack);
    console.error('[CONSUMABLE API] Full error:', JSON.stringify(error, null, 2));
    console.error('[CONSUMABLE API] ========================================');
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
