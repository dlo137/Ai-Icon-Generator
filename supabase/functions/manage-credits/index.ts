import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Credit reset logic - resets based on subscription cycle from purchase date
const shouldResetCredits = (profile: any): boolean => {
  if (!profile.is_pro_version || !profile.subscription_plan || !profile.subscription_start_date) {
    console.log('[RESET CHECK] Missing required fields for reset check');
    return false;
  }

  const now = new Date();
  const purchaseDate = new Date(profile.subscription_start_date);
  const lastResetDate = profile.last_credit_reset
    ? new Date(profile.last_credit_reset)
    : purchaseDate;

  // Validate dates
  if (isNaN(purchaseDate.getTime()) || isNaN(lastResetDate.getTime())) {
    console.error('[RESET CHECK] Invalid dates detected');
    return false;
  }

  const millisecondsElapsed = now.getTime() - lastResetDate.getTime();
  const daysElapsed = millisecondsElapsed / (1000 * 60 * 60 * 24);

  console.log(`[RESET CHECK] Plan: ${profile.subscription_plan}, Days elapsed: ${daysElapsed.toFixed(2)}, Last reset: ${lastResetDate.toISOString()}`);

  switch (profile.subscription_plan) {
    case 'weekly':
      // Reset every 7 days from last reset
      const shouldResetWeekly = daysElapsed >= 7;
      console.log(`[RESET CHECK] Weekly - Should reset: ${shouldResetWeekly}`);
      return shouldResetWeekly;

    case 'monthly':
    case 'yearly':
      // Reset every month from last reset
      // Calculate if a full month has passed
      const lastResetMonth = lastResetDate.getMonth();
      const lastResetYear = lastResetDate.getFullYear();
      const lastResetDay = lastResetDate.getDate();

      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const currentDay = now.getDate();

      // Calculate total months between dates
      const monthsDiff = (currentYear - lastResetYear) * 12 + (currentMonth - lastResetMonth);

      console.log(`[RESET CHECK] Monthly - Months diff: ${monthsDiff}, Last reset day: ${lastResetDay}, Current day: ${currentDay}`);

      // Reset if:
      // 1. More than 1 month has passed, OR
      // 2. Exactly 1 month passed AND we're on or past the reset day
      if (monthsDiff > 1) {
        console.log('[RESET CHECK] Monthly - More than 1 month passed, resetting');
        return true;
      } else if (monthsDiff === 1 && currentDay >= lastResetDay) {
        console.log('[RESET CHECK] Monthly - 1 month passed and past reset day, resetting');
        return true;
      } else {
        console.log('[RESET CHECK] Monthly - Not time to reset yet');
        return false;
      }

    default:
      console.log('[RESET CHECK] Unknown plan type');
      return false;
  }
};

const getCreditsForPlan = (plan: string | null): number => {
  switch (plan) {
    case 'yearly':
      return 90;
    case 'monthly':
      return 75;
    case 'weekly':
      return 10;
    default:
      return 0;
  }
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify JWT and get user
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { action, amount } = await req.json()

    // Get user's profile with subscription info
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('credits_current, credits_max, subscription_plan, is_pro_version, subscription_start_date, last_credit_reset')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Error fetching profile:', profileError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch user profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if credits need to be reset based on subscription cycle
    if (shouldResetCredits(profile)) {
      console.log('Auto-resetting credits based on subscription cycle')
      const resetMaxCredits = getCreditsForPlan(profile.subscription_plan);

      // Calculate new subscription end date
      const newEndDate = new Date();
      if (profile.subscription_plan === 'weekly') {
        newEndDate.setDate(newEndDate.getDate() + 7);
      } else if (profile.subscription_plan === 'monthly') {
        newEndDate.setMonth(newEndDate.getMonth() + 1);
      } else if (profile.subscription_plan === 'yearly') {
        // Yearly plans reset credits monthly but billing is yearly
        // So we extend end date by 1 month, not 1 year
        newEndDate.setMonth(newEndDate.getMonth() + 1);
      }

      await supabase
        .from('profiles')
        .update({
          credits_current: resetMaxCredits,
          credits_max: resetMaxCredits,
          last_credit_reset: new Date().toISOString(),
          subscription_end_date: newEndDate.toISOString()
        })
        .eq('id', user.id)

      // Update local profile object
      profile.credits_current = resetMaxCredits;
      profile.credits_max = resetMaxCredits;
      profile.last_credit_reset = new Date().toISOString();
    }

    // If credits columns don't exist yet, initialize them based on subscription
    let currentCredits = profile.credits_current
    let maxCredits = profile.credits_max

    if (currentCredits === null || maxCredits === null) {
      // Initialize based on subscription plan
      if (profile.is_pro_version && profile.subscription_plan) {
        switch (profile.subscription_plan) {
          case 'yearly':
            maxCredits = 90
            break
          case 'monthly':
            maxCredits = 75
            break
          case 'weekly':
            maxCredits = 10
            break
          default:
            maxCredits = 0
        }
      } else {
        maxCredits = 0 // No free plan
      }
      currentCredits = maxCredits

      // Update profile with initialized credits
      await supabase
        .from('profiles')
        .update({
          credits_current: currentCredits,
          credits_max: maxCredits,
        })
        .eq('id', user.id)
    }

    // Handle different actions
    switch (action) {
      case 'get':
        // Just return current credits
        return new Response(
          JSON.stringify({
            current: currentCredits,
            max: maxCredits
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      case 'deduct':
        // Deduct credits
        const deductAmount = amount || 1

        if (currentCredits < deductAmount) {
          return new Response(
            JSON.stringify({
              error: 'Insufficient credits',
              current: currentCredits,
              max: maxCredits
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const newCredits = currentCredits - deductAmount

        // Update credits in database
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ credits_current: newCredits })
          .eq('id', user.id)

        if (updateError) {
          console.error('Error updating credits:', updateError)
          return new Response(
            JSON.stringify({ error: 'Failed to update credits' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        return new Response(
          JSON.stringify({
            success: true,
            current: newCredits,
            max: maxCredits
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      case 'reset':
        // Reset credits to max (useful for testing or manual resets)
        // Recalculate maxCredits based on subscription plan
        const resetMaxCredits = getCreditsForPlan(profile.subscription_plan);

        const { error: resetError } = await supabase
          .from('profiles')
          .update({
            credits_current: resetMaxCredits,
            credits_max: resetMaxCredits,
            last_credit_reset: new Date().toISOString()
          })
          .eq('id', user.id)

        if (resetError) {
          console.error('Error resetting credits:', resetError)
          return new Response(
            JSON.stringify({ error: 'Failed to reset credits', details: resetError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        return new Response(
          JSON.stringify({
            success: true,
            current: resetMaxCredits,
            max: resetMaxCredits
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Error in manage-credits function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
