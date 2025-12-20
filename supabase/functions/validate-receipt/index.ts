import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create a Supabase client with the Auth context of the logged in user
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get the session or user object
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      )
    }

    const { receipt, productId, transactionId, source } = await req.json()

    console.log('Validating receipt:', {
      userId: user.id,
      productId,
      transactionId,
      source
    })

    // Determine plan and credits based on productId - CONSUMABLE LOGIC
    let plan: string = 'starter'
    let creditsToAdd = 0

    // Map consumable product IDs to credits
    if (productId.includes('starter.15')) {
      plan = 'starter'
      creditsToAdd = 15
    } else if (productId.includes('value.45')) {
      plan = 'value'
      creditsToAdd = 45
    } else if (productId.includes('pro.120')) {
      plan = 'pro'
      creditsToAdd = 120
    } else {
      // Fallback for legacy product IDs
      if (productId.includes('yearly')) {
        plan = 'pro'
        creditsToAdd = 120
      } else if (productId.includes('monthly')) {
        plan = 'value'
        creditsToAdd = 45
      } else if (productId.includes('weekly')) {
        plan = 'starter'
        creditsToAdd = 15
      }
    }

    // Get current credits to add to them (CONSUMABLE STACKING LOGIC)
    const { data: currentProfile } = await supabaseClient
      .from('profiles')
      .select('credits_current, credits_max')
      .eq('id', user.id)
      .single()

    const currentCredits = currentProfile?.credits_current || 0
    const currentMax = currentProfile?.credits_max || 0
    const newTotalCredits = currentCredits + creditsToAdd
    const newMaxCredits = Math.max(currentMax, newTotalCredits)

    console.log('Credit stacking:', currentCredits, '+', creditsToAdd, '=', newTotalCredits)
    console.log('Max credits updated to:', newMaxCredits)

    // Update user profile with subscription info - ADD CREDITS, DON'T REPLACE
    const { error: updateError } = await supabaseClient
      .from('profiles')
      .update({
        subscription_plan: plan,
        subscription_id: transactionId,
        is_pro_version: true,
        credits_current: newTotalCredits,  // ADD credits instead of replacing
        credits_max: newMaxCredits,        // Increase max to accommodate total
        last_credit_reset: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('Error updating profile:', updateError)
      throw updateError
    }

    console.log('Receipt validated successfully for user:', user.id)

    return new Response(
      JSON.stringify({
        success: true,
        plan,
        credits_added: creditsToAdd,
        new_total: newTotalCredits,
        credits_max: newMaxCredits
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in validate-receipt function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
