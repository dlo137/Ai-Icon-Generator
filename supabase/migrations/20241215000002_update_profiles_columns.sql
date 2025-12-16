-- Add new columns to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS product_id TEXT;

-- Remove columns from profiles table
ALTER TABLE profiles
DROP COLUMN IF EXISTS avatar_url,
DROP COLUMN IF EXISTS website;

-- Add index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- Add index on product_id for subscription queries
CREATE INDEX IF NOT EXISTS idx_profiles_product_id ON profiles(product_id);

-- Add comments
COMMENT ON COLUMN profiles.email IS 'User email address';
COMMENT ON COLUMN profiles.product_id IS 'IAP product ID for current subscription (e.g., icon.yearly, icon.monthly)';
