-- Add onboarding_completed column to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT NULL;

-- Set existing users as having completed onboarding (backwards compatibility)
UPDATE profiles
SET onboarding_completed = TRUE
WHERE onboarding_completed IS NULL;

-- Add comment explaining the column
COMMENT ON COLUMN profiles.onboarding_completed IS 'Tracks whether user has completed the initial onboarding flow. NULL or TRUE = completed, FALSE = not completed.';
