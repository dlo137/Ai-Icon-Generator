-- Add missing columns to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_tier TEXT,
ADD COLUMN IF NOT EXISTS subscription_status TEXT,
ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS purchase_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS is_pro_version BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_credit_reset TIMESTAMPTZ;

-- Update is_pro_version based on subscription_status for existing records (only if column exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='profiles' AND column_name='subscription_status') THEN
    UPDATE profiles
    SET is_pro_version = (subscription_status = 'active')
    WHERE subscription_status IS NOT NULL;
  END IF;
END $$;

-- Update purchase_time from subscription_start_date for existing records (only if column exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='profiles' AND column_name='subscription_start_date') THEN
    UPDATE profiles
    SET purchase_time = subscription_start_date
    WHERE subscription_start_date IS NOT NULL AND purchase_time IS NULL;
  END IF;
END $$;

-- Update last_credit_reset from subscription_end_date for existing records (only if column exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='profiles' AND column_name='subscription_end_date') THEN
    UPDATE profiles
    SET last_credit_reset = subscription_end_date
    WHERE subscription_end_date IS NOT NULL AND last_credit_reset IS NULL;
  END IF;
END $$;

-- Add comments
COMMENT ON COLUMN profiles.purchase_time IS 'When the subscription was purchased';
COMMENT ON COLUMN profiles.price IS 'Price paid for current subscription';
COMMENT ON COLUMN profiles.is_pro_version IS 'Whether user has an active pro subscription';
COMMENT ON COLUMN profiles.last_credit_reset IS 'When credits were last reset';

-- Create a view with columns in your preferred order (only include columns that exist)
CREATE OR REPLACE VIEW profiles_ordered AS
SELECT
  id,
  name,
  email,
  subscription_tier,
  credits_current,
  credits_max,
  purchase_time,
  price,
  is_pro_version,
  last_credit_reset,
  created_at,
  updated_at,
  onboarding_completed,
  subscription_status,
  subscription_start_date,
  subscription_end_date,
  product_id
FROM profiles;

COMMENT ON VIEW profiles_ordered IS 'Profiles table with columns in preferred display order. Use this view in Supabase UI for better column ordering.';
