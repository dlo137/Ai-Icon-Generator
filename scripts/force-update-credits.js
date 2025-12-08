// Force update credits using service role key
// This bypasses RLS policies
const fetch = require('node-fetch');

const SUPABASE_URL = 'https://eutvdhgxgwrfrrwxuuvp.supabase.co';
// You'll need to get your service role key from Supabase dashboard > Settings > API
const SERVICE_ROLE_KEY = process.argv[2];

if (!SERVICE_ROLE_KEY) {
  console.error('\n❌ Error: Service role key required');
  console.log('\nUsage: node force-update-credits.js <SERVICE_ROLE_KEY>');
  console.log('\nGet your service role key from:');
  console.log('Supabase Dashboard > Settings > API > service_role key (secret)\n');
  process.exit(1);
}

async function forceUpdateCredits() {
  try {
    console.log('Fetching all profiles...\n');

    // Fetch all profiles
    const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*`, {
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const profiles = await response.json();
    console.log(`Found ${profiles.length} profiles\n`);

    for (const profile of profiles) {
      console.log(`User ID: ${profile.id.substring(0, 8)}...`);
      console.log(`  Current: ${profile.credits_current}/${profile.credits_max}`);
      console.log(`  Plan: ${profile.subscription_plan || 'none'}`);
      console.log(`  Pro: ${profile.is_pro_version}`);

      let newCredits = 0;
      if (profile.is_pro_version && profile.subscription_plan) {
        switch (profile.subscription_plan) {
          case 'yearly':
            newCredits = 90;
            break;
          case 'monthly':
            newCredits = 75;
            break;
          case 'weekly':
            newCredits = 30;
            break;
        }
      }

      if (newCredits > 0) {
        console.log(`  → Updating to ${newCredits}/${newCredits}...`);

        const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profile.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            credits_current: newCredits,
            credits_max: newCredits
          })
        });

        if (updateResponse.ok) {
          console.log('  ✓ Updated successfully\n');
        } else {
          const error = await updateResponse.text();
          console.log(`  ❌ Update failed: ${error}\n`);
        }
      } else {
        console.log('  → No subscription, leaving at 0/0\n');
      }
    }

    console.log('✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

forceUpdateCredits();
