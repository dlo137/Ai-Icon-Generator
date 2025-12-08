// Script to manually fix credits for a user
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://eutvdhgxgwrfrrwxuuvp.supabase.co';
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('Error: EXPO_PUBLIC_SUPABASE_ANON_KEY not found in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixCredits() {
  try {
    console.log('Fetching all users with yearly plan...');

    // Get all users with yearly subscription
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, subscription_plan, is_pro_version, credits_current, credits_max')
      .eq('subscription_plan', 'yearly')
      .eq('is_pro_version', true);

    if (error) {
      console.error('Error fetching users:', error);
      return;
    }

    console.log(`Found ${users.length} users with yearly plan`);

    for (const user of users) {
      console.log(`\nUser ID: ${user.id}`);
      console.log(`Current credits: ${user.credits_current}/${user.credits_max}`);

      // Update to 90/90
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          credits_current: 90,
          credits_max: 90
        })
        .eq('id', user.id);

      if (updateError) {
        console.error(`Error updating user ${user.id}:`, updateError);
      } else {
        console.log(`✓ Updated to 90/90 images`);
      }
    }

    console.log('\n✅ Done!');
  } catch (error) {
    console.error('Error:', error);
  }
}

fixCredits();
