-- Add missing subscription columns
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_id TEXT,
ADD COLUMN IF NOT EXISTS is_trial_version BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMPTZ;

-- Add comments
COMMENT ON COLUMN profiles.subscription_id IS 'Unique subscription/purchase ID from IAP';
COMMENT ON COLUMN profiles.is_trial_version IS 'Whether this is a trial subscription';
COMMENT ON COLUMN profiles.trial_end_date IS 'When the trial period ends';
