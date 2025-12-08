// Script to check all users and fix their credits
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://eutvdhgxgwrfrrwxuuvp.supabase.co';
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('Error: EXPO_PUBLIC_SUPABASE_ANON_KEY not found in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAndFixAll() {
  try {
    console.log('Fetching all users...');

    // Get all users
    const { data: users, error } = await supabase
      .from('profiles')
      .select('*');

    if (error) {
      console.error('Error fetching users:', error);
      return;
    }

    console.log(`\nFound ${users.length} total users\n`);

    for (const user of users) {
      console.log(`\n--- User ID: ${user.id.substring(0, 8)}... ---`);
      console.log(`Email: (check your profile)`);
      console.log(`Pro: ${user.is_pro_version}`);
      console.log(`Plan: ${user.subscription_plan || 'none'}`);
      console.log(`Trial: ${user.is_trial_version}`);
      console.log(`Current credits: ${user.credits_current}/${user.credits_max}`);

      // Determine correct credits
      let correctMax = 0;
      if (user.is_pro_version && user.subscription_plan) {
        switch (user.subscription_plan) {
          case 'yearly':
            correctMax = 90;
            break;
          case 'monthly':
            correctMax = 75;
            break;
          case 'weekly':
            correctMax = 30;
            break;
        }
      }

      console.log(`Should be: ${correctMax}/${correctMax}`);

      // Update if needed
      if (user.credits_max !== correctMax || user.credits_current === null || user.credits_current === 0) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            credits_current: correctMax,
            credits_max: correctMax
          })
          .eq('id', user.id);

        if (updateError) {
          console.error(`❌ Error updating:`, updateError);
        } else {
          console.log(`✓ Updated to ${correctMax}/${correctMax}`);
        }
      } else {
        console.log(`✓ Already correct`);
      }
    }

    console.log('\n\n✅ Done! All users checked and updated.');
  } catch (error) {
    console.error('Error:', error);
  }
}

checkAndFixAll();
