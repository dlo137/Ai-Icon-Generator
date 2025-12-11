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

    // Determine plan and credits based on productId
    let plan: 'yearly' | 'monthly' | 'weekly' = 'yearly'
    let credits_max = 0

    if (productId.includes('yearly')) {
      plan = 'yearly'
      credits_max = 90
    } else if (productId.includes('monthly')) {
      plan = 'monthly'
      credits_max = 75
    } else if (productId.includes('weekly')) {
      plan = 'weekly'
      credits_max = 10
    }

    // Update user profile with subscription info
    const { error: updateError } = await supabaseClient
      .from('profiles')
      .update({
        subscription_plan: plan,
        subscription_id: transactionId,
        is_pro_version: true,
        credits_current: credits_max,
        credits_max: credits_max,
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
        credits_max
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
