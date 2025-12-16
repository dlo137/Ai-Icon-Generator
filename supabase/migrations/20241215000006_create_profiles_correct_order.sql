-- Create profiles table with columns in exact preferred order
CREATE TABLE profiles (
  -- Columns in your exact preferred order
  name TEXT,
  email TEXT,
  subscription_tier TEXT,
  credits_current INTEGER DEFAULT 0,
  credits_max INTEGER DEFAULT 0,
  purchase_time TIMESTAMPTZ,
  price NUMERIC(10, 2),
  is_pro_version BOOLEAN DEFAULT false,
  last_credit_reset TIMESTAMPTZ,

  -- Rest of columns
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  onboarding_completed BOOLEAN DEFAULT NULL,
  subscription_status TEXT,
  subscription_start_date TIMESTAMPTZ,
  subscription_end_date TIMESTAMPTZ,
  product_id TEXT
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Create indexes for better performance
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_product_id ON profiles(product_id);
CREATE INDEX idx_profiles_subscription_status ON profiles(subscription_status);
CREATE INDEX idx_profiles_subscription_end_date ON profiles(subscription_end_date);

-- Add column comments
COMMENT ON TABLE profiles IS 'User profile data including subscription and credit information';
COMMENT ON COLUMN profiles.name IS 'User full name';
COMMENT ON COLUMN profiles.email IS 'User email address';
COMMENT ON COLUMN profiles.subscription_tier IS 'Current subscription plan: weekly, monthly, or yearly';
COMMENT ON COLUMN profiles.credits_current IS 'Number of image generation credits currently available';
COMMENT ON COLUMN profiles.credits_max IS 'Maximum number of credits for current subscription';
COMMENT ON COLUMN profiles.purchase_time IS 'When the subscription was purchased';
COMMENT ON COLUMN profiles.price IS 'Price paid for current subscription';
COMMENT ON COLUMN profiles.is_pro_version IS 'Whether user has an active pro subscription';
COMMENT ON COLUMN profiles.last_credit_reset IS 'When credits were last reset';
COMMENT ON COLUMN profiles.id IS 'User ID (references auth.users)';
COMMENT ON COLUMN profiles.onboarding_completed IS 'Tracks whether user has completed the initial onboarding flow';
COMMENT ON COLUMN profiles.subscription_status IS 'Subscription status: active, canceled, expired';
COMMENT ON COLUMN profiles.subscription_start_date IS 'When the current subscription started';
COMMENT ON COLUMN profiles.subscription_end_date IS 'When the current subscription ends';
COMMENT ON COLUMN profiles.product_id IS 'IAP product ID for current subscription';

-- Create trigger function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    NOW(),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger (drop if exists first)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
