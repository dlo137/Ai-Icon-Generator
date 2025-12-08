-- =====================================================
-- Icon Generator - Complete Database Setup
-- =====================================================
-- This migration sets up all tables, storage, and security policies
-- Paste this entire file into the Supabase SQL Editor and run it
-- =====================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PROFILES TABLE
-- =====================================================
-- Create profiles table for user data and subscriptions
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  avatar_url TEXT,
  website TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Subscription fields
  subscription_plan TEXT CHECK (subscription_plan IN ('weekly', 'monthly', 'yearly')),
  subscription_id TEXT,
  price NUMERIC(10, 2),
  purchase_time TIMESTAMP WITH TIME ZONE,
  is_pro_version BOOLEAN DEFAULT FALSE,
  is_trial_version BOOLEAN DEFAULT FALSE,
  trial_end_date TIMESTAMP WITH TIME ZONE,
  subscription_start_date TIMESTAMP WITH TIME ZONE,

  -- Credits tracking
  credits_current INTEGER DEFAULT 0,
  credits_max INTEGER DEFAULT 0,
  last_credit_reset TIMESTAMP WITH TIME ZONE
);

-- Add comments to document the schema
COMMENT ON TABLE public.profiles IS 'User profile data including subscription and credits information';
COMMENT ON COLUMN public.profiles.id IS 'User ID (references auth.users)';
COMMENT ON COLUMN public.profiles.name IS 'User display name';
COMMENT ON COLUMN public.profiles.subscription_plan IS 'Current subscription tier: weekly, monthly, or yearly';
COMMENT ON COLUMN public.profiles.subscription_id IS 'Unique subscription/purchase ID from app store';
COMMENT ON COLUMN public.profiles.is_pro_version IS 'Whether user has active pro subscription';
COMMENT ON COLUMN public.profiles.is_trial_version IS 'Whether user is in trial period';
COMMENT ON COLUMN public.profiles.trial_end_date IS 'When the trial period ends';
COMMENT ON COLUMN public.profiles.subscription_start_date IS 'Start date of current subscription period, used to calculate when credits should reset';
COMMENT ON COLUMN public.profiles.credits_current IS 'Current number of images/credits the user has available';
COMMENT ON COLUMN public.profiles.credits_max IS 'Maximum number of images/credits based on subscription plan';
COMMENT ON COLUMN public.profiles.last_credit_reset IS 'Last time credits were reset (for monthly/weekly plans)';

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_plan ON public.profiles(subscription_plan);
CREATE INDEX IF NOT EXISTS idx_profiles_is_pro_version ON public.profiles(is_pro_version);
CREATE INDEX IF NOT EXISTS idx_profiles_credits ON public.profiles(credits_current);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON public.profiles(created_at);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================
-- Enable RLS on profiles table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running the migration)
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policy: Users can insert their own profile
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- =====================================================
-- AUTO-CREATE PROFILE TRIGGER
-- =====================================================
-- Function to automatically create a profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger to auto-create profile on user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- STORAGE BUCKET FOR ICONS
-- =====================================================
-- Create storage bucket for generated images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'thumbnails',
  'thumbnails',
  false, -- Not public (requires signed URLs)
  10485760, -- 10MB file size limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[];

-- =====================================================
-- STORAGE POLICIES
-- =====================================================
-- Note: Storage bucket policies are managed through the Supabase Dashboard
-- Go to Storage > Policies to set up access rules for the icons bucket
--
-- Recommended policies:
-- 1. Allow authenticated users to INSERT into their own folder (user_id/*)
-- 2. Allow authenticated users to SELECT from their own folder (user_id/*)
-- 3. Allow authenticated users to UPDATE their own folder (user_id/*)
-- 4. Allow authenticated users to DELETE from their own folder (user_id/*)
--
-- These need to be set up in the Supabase Dashboard under Storage > thumbnails > Policies

-- =====================================================
-- INITIAL DATA & BACKFILL
-- =====================================================
-- Backfill existing users without profiles (if any)
INSERT INTO public.profiles (id, name, created_at, updated_at)
SELECT
  id,
  COALESCE(raw_user_meta_data->>'full_name', email),
  created_at,
  updated_at
FROM auth.users
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles WHERE profiles.id = users.id
)
ON CONFLICT (id) DO NOTHING;

-- Update existing users to have correct credits based on their subscription
UPDATE public.profiles
SET
  credits_max = CASE
    WHEN subscription_plan = 'yearly' THEN 90
    WHEN subscription_plan = 'monthly' THEN 75
    WHEN subscription_plan = 'weekly' THEN 10
    ELSE 0
  END,
  credits_current = CASE
    WHEN subscription_plan = 'yearly' THEN 90
    WHEN subscription_plan = 'monthly' THEN 75
    WHEN subscription_plan = 'weekly' THEN 10
    ELSE 0
  END
WHERE (credits_current IS NULL OR credits_max IS NULL)
  AND subscription_plan IS NOT NULL;

-- =====================================================
-- HELPFUL QUERIES FOR DEBUGGING
-- =====================================================
-- Uncomment these to run after migration to verify setup:

-- View all profiles:
-- SELECT * FROM public.profiles;

-- View storage bucket configuration:
-- SELECT * FROM storage.buckets WHERE id = 'thumbnails';

-- View storage policies:
-- SELECT * FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';

-- View table policies:
-- SELECT * FROM pg_policies WHERE tablename = 'profiles' AND schemaname = 'public';

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Your database is now ready for the Icon Generator app!
--
-- Next steps:
-- 1. Deploy edge functions using: npx supabase functions deploy
-- 2. Set environment variables for edge functions:
--    - GEMINI_API_KEY
--    - SUPABASE_URL
--    - SUPABASE_ANON_KEY
-- =====================================================
