# Dual Apple Account Issue - Solution

## Problem
- Expo Go creates account: dlosolo14@gmail.com
- Production creates account: h9xs7bj78q@privaterelay.appleid.com
- These are TWO DIFFERENT ACCOUNTS in Supabase

## Why This Happens
Apple Sign In treats Expo Go and your production app as different apps because they have different bundle IDs. This is normal and expected.

## Solutions

### Option 1: Only Test with Production Builds (Recommended for Release)
1. Stop using Expo Go for testing Apple Sign In
2. Use `eas build --profile preview` for development builds
3. Install via TestFlight for testing
4. This ensures you only have ONE production account

### Option 2: Merge Accounts in Supabase (Manual Fix)
Run this SQL in Supabase to merge your test data:

```sql
-- Find both accounts
SELECT id, email, credits_current, credits_max FROM profiles 
WHERE email IN ('dlosolo14@gmail.com', 'h9xs7bj78q@privaterelay.appleid.com');

-- Copy credits from Expo Go account to Production account
UPDATE profiles 
SET 
  credits_current = (SELECT credits_current FROM profiles WHERE email = 'dlosolo14@gmail.com'),
  credits_max = (SELECT credits_max FROM profiles WHERE email = 'dlosolo14@gmail.com')
WHERE email = 'h9xs7bj78q@privaterelay.appleid.com';

-- Verify
SELECT id, email, credits_current, credits_max FROM profiles 
WHERE email IN ('dlosolo14@gmail.com', 'h9xs7bj78q@privaterelay.appleid.com');
```

### Option 3: Accept Both Accounts (Not Recommended)
- Keep using Expo Go account for development
- Use production account for production
- Manually sync data when needed

## Best Practice Going Forward

**For Testing IAP in Development:**
1. Use preview builds: `eas build --profile preview --platform ios`
2. Install via TestFlight
3. This uses your production bundle ID
4. Apple Sign In will use the same account as production

**Never use Expo Go for testing:**
- IAP (purchases won't work properly)
- Apple Sign In (creates duplicate accounts)
- Push notifications (different tokens)

## Current Status
- Your production account: h9xs7bj78q@privaterelay.appleid.com (this is the REAL account)
- Your test account: dlosolo14@gmail.com (this is Expo Go only)
- You should focus on the production account going forward
