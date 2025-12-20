# Consumable IAP Migration Summary

## Overview
Successfully migrated from auto-renewable subscriptions to consumable IAP purchases.

## Product IDs Changed
**Old (Subscriptions):**
- `ai.icons.weekly` - 10 credits, $2.99/week
- `ai.icons.monthly` - 75 credits, $5.99/month
- `ai.icons.yearly` - 90 credits, $59.99/year

**New (Consumables):**
- `starter.25` - 25 credits, $2.99 (one-time purchase)
- `value.75` - 75 credits, $6.99 (one-time purchase)
- `pro.200` - 200 credits, $14.99 (one-time purchase)

## Code Changes Made

### 1. Updated Files:
1. **app/subscriptionScreen.tsx**
   - Updated PRODUCT_IDS to use new consumable IDs
   - Changed plan types from weekly/monthly/yearly to starter/value/pro
   - Updated simulatePurchaseInExpoGo to ADD credits instead of setting subscription dates
   - Removed subscription expiration logic

2. **services/IAPService.ts**
   - Changed SUBSCRIPTION_SKUS to CONSUMABLE_SKUS
   - Updated getProducts() to fetch type 'iap' instead of 'subs'
   - Updated purchaseProduct() to use type 'iap' for both iOS and Android
   - Updated detectPlanFromPurchase() to detect new plan names

3. **src/features/subscription/plans.ts**
   - Changed SubscriptionPlan type to 'starter' | 'value' | 'pro'
   - Updated PLAN_CONFIG with new credits and product IDs
   - Removed duration fields and calculateEndDate function

4. **src/features/subscription/api.ts**
   - Renamed updateSubscriptionInProfile to handle consumables
   - Changed logic to ADD credits to existing balance instead of replacing
   - Removed subscription date calculations
   - Removed trial logic
   - Updated getPriceForPlan() and getPlanFromProductId() for new plans

## Supabase Database Changes Needed

### Profiles Table Updates:

**Columns that can be kept (still useful):**
- `id` - User ID
- `email` - User email
- `name` - User name
- `credits_current` - Current credit balance (INT)
- `product_id` - Last purchased product ID
- `purchase_time` - Last purchase timestamp
- `price` - Last purchase price
- `is_pro_version` - TRUE if user has credits
- `subscription_id` - Can be renamed to `purchase_id` or kept as-is
- `subscription_plan` - Last purchased pack type (starter/value/pro)

**Columns that are NO LONGER NEEDED (optional to remove):**
- `subscription_start_date` - No longer relevant for consumables
- `subscription_end_date` - No longer relevant for consumables
- `subscription_status` - No longer relevant
- `last_credit_reset` - Credits don't auto-reset anymore
- `credits_max` - Not needed, credits just accumulate
- `is_trial_version` - No trials for consumables
- `trial_end_date` - No trials for consumables

### Recommended Migration SQL:

```sql
-- Option 1: Keep existing columns (safest - works without schema changes)
-- No changes needed! Existing columns will work fine.
-- Old subscription columns will just not be used.

-- Option 2: Clean up unnecessary columns (optional)
ALTER TABLE profiles
DROP COLUMN IF EXISTS subscription_start_date,
DROP COLUMN IF EXISTS subscription_end_date,
DROP COLUMN IF EXISTS subscription_status,
DROP COLUMN IF EXISTS last_credit_reset,
DROP COLUMN IF EXISTS credits_max,
DROP COLUMN IF EXISTS is_trial_version,
DROP COLUMN IF EXISTS trial_end_date;

-- Rename subscription_id to purchase_id (optional)
ALTER TABLE profiles
RENAME COLUMN subscription_id TO purchase_id;

-- Rename subscription_plan to pack_type (optional)
ALTER TABLE profiles
RENAME COLUMN subscription_plan TO pack_type;
```

## How Consumables Work Now

### Purchase Flow:
1. User selects a pack (Starter/Value/Pro)
2. Purchase goes through App Store/Google Play
3. Credits are **ADDED** to user's current balance
4. No expiration - credits never reset or expire
5. User can purchase multiple packs - credits accumulate

### When Credits Run Out:
- User needs to purchase more credits
- No auto-renewal
- App shows subscription screen when credits = 0

### Guest Mode:
- Still works with consumable packs
- Guest purchases are device-local
- Credits stored in AsyncStorage
- Can upgrade to account later (migrates credits)

## Testing Checklist

### In Expo Go (Simulated):
- [x] Product IDs updated
- [x] Plan names changed (starter/value/pro)
- [x] Credits ADD to existing balance
- [ ] Guest mode consumable purchase
- [ ] Account consumable purchase

### In Production (Real IAP):
- [ ] Create consumable products in App Store Connect
  - Product ID: `starter.25`
  - Product ID: `value.75`
  - Product ID: `pro.200`
- [ ] Create consumable products in Google Play Console (if Android)
- [ ] Test purchase flow
- [ ] Verify credits add correctly
- [ ] Test multiple purchases accumulating credits
- [ ] Verify Supabase database updates correctly

## Edge Function Updates Needed

If you're using Supabase Edge Functions for credit management:

**`manage-credits` function needs update:**
- Remove auto-reset logic (credits don't reset anymore)
- Remove subscription cycle checking
- Just deduct credits when used
- Don't reset to max - credits are consumable

## Next Steps

1. **Update App Store Connect:**
   - Delete/archive old subscription products
   - Create new consumable IAP products with IDs: `starter.25`, `value.75`, `pro.200`
   - Set correct pricing and titles

2. **Update Google Play Console** (if supporting Android):
   - Same as above for Android

3. **Optional: Clean up Supabase:**
   - Run the migration SQL to remove unused columns
   - Or keep them for backwards compatibility

4. **Update Edge Functions:**
   - Remove auto-reset logic from `manage-credits` function
   - Simplify to just deduct credits

5. **Test thoroughly:**
   - Test in sandbox environment first
   - Verify credits accumulate correctly
   - Test with guest mode and authenticated users

## Important Notes

- **Credits never expire** - This is a consumable model
- **No auto-renewal** - Users must manually purchase more credits
- **Credits accumulate** - Buying Value Pack ($6.99) twice = 150 credits total
- **Backwards compatibility** - Old subscription columns in database don't break anything
- **Guest mode works** - Guests can buy consumable packs too (stored locally)
