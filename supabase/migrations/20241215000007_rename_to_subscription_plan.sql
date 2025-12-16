-- Rename subscription_tier to subscription_plan
ALTER TABLE profiles
RENAME COLUMN subscription_tier TO subscription_plan;

-- Update comment
COMMENT ON COLUMN profiles.subscription_plan IS 'Current subscription plan: weekly, monthly, or yearly';
