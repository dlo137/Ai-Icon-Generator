# IAP Verification Checklist

## ✅ Code Configuration (All Fixed!)

### Product IDs - All Consistent ✓
- [x] IAPService.ts uses correct product IDs
- [x] subscriptionScreen.tsx matches IAPService
- [x] profile.tsx uses correct IDs
- [x] subscriptionStorage.ts uses correct IDs
- [x] validate-receipt function uses correct credits (weekly: 10)
- [x] manage-credits function uses correct credits

**iOS Product IDs:**
- `icon.yearly` → 90 credits/month
- `icon.monthly` → 75 credits/month
- `icon.weekly` → 10 credits/week

**Android Product IDs:**
- `ai.icon.pro:yearly` → 90 credits/month
- `ai.icon.pro:monthly` → 75 credits/month
- `ai.icon.pro:weekly` → 10 credits/week

### App Configuration ✓
- [x] Bundle ID: `com.watson.AI-Icon-Generator` (iOS)
- [x] Package: `com.watsonsweb.icongenerator` (Android)
- [x] react-native-iap: v14.5.0 installed
- [x] Android billing permission: `com.android.vending.BILLING`
- [x] Debug panel enabled for troubleshooting

---

## 🔧 App Store Connect Setup (You Need to Verify)

### 1. Create Subscription Products in App Store Connect

Go to: https://appstoreconnect.apple.com

Navigate to: **My Apps** > **Ai Icon Generator** > **Subscriptions**

#### Create These Three Products:

**Weekly Plan:**
- Product ID: `icon.weekly`
- Reference Name: Icon Generator Weekly
- Subscription Group: Icon Pro (create if doesn't exist)
- Duration: 1 Week
- Price: $2.99/week
- Status: Must be "Ready to Submit" or "Approved"

**Monthly Plan:**
- Product ID: `icon.monthly`
- Reference Name: Icon Generator Monthly
- Subscription Group: Icon Pro (same as above)
- Duration: 1 Month
- Price: $5.99/month
- Status: Must be "Ready to Submit" or "Approved"

**Yearly Plan:**
- Product ID: `icon.yearly`
- Reference Name: Icon Generator Yearly
- Subscription Group: Icon Pro (same as above)
- Duration: 1 Year
- Price: $59.99/year
- Status: Must be "Ready to Submit" or "Approved"

#### For Each Product, Add:
- [ ] Display Name (localized)
- [ ] Description (localized)
- [ ] Subscription Benefits
- [ ] Review Screenshot (for first submission)

### 2. Subscription Group Configuration

- [ ] Subscription group name: "Icon Pro" or similar
- [ ] Add subscription group display name (localized)
- [ ] Add subscription group description (if required)

### 3. Legal Requirements

- [ ] Add Terms and Conditions URL to subscription group
- [ ] Add Privacy Policy URL to subscription group

---

## 🧪 Testing Setup

### 1. Create Sandbox Test Account

Go to: **Users and Access** > **Sandbox Testers**

- [ ] Create a new sandbox tester
- [ ] Use a unique email (not your main Apple ID)
- [ ] Save the credentials securely

### 2. Device Setup for Testing

**CRITICAL STEPS:**
1. [ ] Sign OUT of your main Apple ID on the test device
   - Settings > [Your Name] > Sign Out
2. [ ] Do NOT sign in with sandbox account yet
3. [ ] Install the TestFlight build
4. [ ] Only sign in when prompted during purchase

### 3. Build and Deploy

```bash
# Build for iOS TestFlight
eas build --platform ios --profile production

# After build completes, submit to TestFlight
eas submit --platform ios --latest
```

**Wait for:**
- [ ] Build to complete (~20-30 minutes)
- [ ] TestFlight processing to complete (~5-15 minutes)
- [ ] TestFlight build to be available for testing

---

## 🔍 Testing the IAP Flow

### Test Purchase Flow

1. [ ] Open TestFlight app and install the build
2. [ ] Open your app
3. [ ] Navigate to subscription screen
4. [ ] Open debug panel (should be visible at bottom)
5. [ ] Check debug info shows:
   - IAP Available: ✅
   - Connected: ✅
   - Listener Active: ✅
   - IAP Ready: ✅
   - Products Loaded: 3
6. [ ] Select a plan (start with weekly for testing)
7. [ ] Tap "Get Started"
8. [ ] Sign in with sandbox account when prompted
9. [ ] Complete the purchase
10. [ ] Verify credits are granted
11. [ ] Check navigation to generate screen

### Test Restore Purchases

1. [ ] Delete and reinstall the app (or use different device)
2. [ ] Sign in to your account
3. [ ] Tap "Restore Purchases"
4. [ ] Verify subscription is restored
5. [ ] Check credits are correct

---

## 🐛 Common Issues and Solutions

### "Products Unavailable" or "0 Products Loaded"

**Causes:**
- Products not in "Ready to Submit" or "Approved" state
- Product IDs don't match (FIXED in code)
- Wait 2-4 hours after creating products
- App bundle ID doesn't match App Store Connect

**Solutions:**
1. [ ] Check App Store Connect product status
2. [ ] Verify bundle ID matches: `com.watson.AI-Icon-Generator`
3. [ ] Wait 2-4 hours after creating products
4. [ ] Use debug panel to see what products are loading
5. [ ] Try "Retry Load Products" button in debug panel

### "Cannot Connect to iTunes Store"

**Causes:**
- Signed in with regular Apple ID instead of sandbox account
- Sandbox account issues

**Solutions:**
1. [ ] Sign OUT of regular Apple ID completely
2. [ ] Only sign in during purchase with sandbox account
3. [ ] Clear app data and try again

### Button Stuck on "Processing..."

**This should no longer happen due to timeout handling, but if it does:**

**Solutions:**
1. [ ] Wait 60 seconds for timeout
2. [ ] Check debug panel for error messages
3. [ ] Try restore purchases
4. [ ] Check Supabase logs for backend errors

### Purchase Completes but Credits Not Granted

**Causes:**
- Supabase edge function errors
- User not authenticated

**Solutions:**
1. [ ] Check Supabase logs for `validate-receipt` or `manage-credits` errors
2. [ ] Verify user is signed in to Supabase
3. [ ] Try restore purchases
4. [ ] Check debug panel for purchase result

---

## 📊 Using the Debug Panel

The debug panel shows real-time information:

### Status Indicators:
- **Green dot**: Purchase in progress
- **Gray dot**: Idle

### Information Displayed:
- **Current Status**: What the IAP system is doing
- **Connection**: IAP service connectivity
- **Purchase State**: Active purchase, selected plan, products loaded
- **Product IDs**: Platform and expected product IDs
- **Available Products**: List of products loaded from store

### Action Buttons:
- **Refresh Debug Info**: Get latest status from IAP service
- **Retry Load Products**: Try fetching products again

### How to Use:
1. Keep debug panel open during testing
2. Watch for status changes during purchase
3. Check if products are loading correctly
4. Verify product IDs match what's expected
5. Use to diagnose issues in real-time

---

## 🚀 Pre-Production Checklist

Before releasing to production:

### App Store Connect
- [ ] All products in "Approved" state
- [ ] Subscription group fully configured
- [ ] Terms and conditions added
- [ ] Privacy policy added
- [ ] Pricing correct in all regions

### App Configuration
- [ ] Debug panel disabled or hidden (optional - can leave for support)
- [ ] All product IDs verified
- [ ] Supabase edge functions deployed
- [ ] Receipt validation working

### Testing Complete
- [ ] Successful sandbox purchase test
- [ ] Restore purchases working
- [ ] Credits granted correctly
- [ ] Navigation working after purchase
- [ ] All three plans tested

### Legal & Compliance
- [ ] App Review includes subscription information
- [ ] Screenshots show subscription features
- [ ] App description mentions subscriptions
- [ ] Agreements, Tax, and Banking completed in App Store Connect

---

## 📝 Deployment Commands

### Deploy Supabase Edge Functions

```bash
# Deploy validate-receipt function
supabase functions deploy validate-receipt

# Deploy manage-credits function
supabase functions deploy manage-credits
```

### Build Production Version

```bash
# iOS Production Build
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios --latest
```

---

## 🆘 If You Still Have Issues

1. **Check Debug Panel First**
   - Shows exactly what's happening with IAP
   - Displays product IDs and availability
   - Shows connection status

2. **Check App Store Connect**
   - Product status must be "Ready to Submit" or "Approved"
   - Bundle ID must match exactly
   - Products can take 2-4 hours to become available

3. **Check Supabase Logs**
   - Go to Supabase Dashboard > Edge Functions > Logs
   - Look for errors in validate-receipt or manage-credits
   - Check if purchase data is being received

4. **Contact Apple Developer Support**
   - If products still not loading after 24 hours
   - If sandbox account issues persist

---

## ✅ Summary of Fixes Made

1. **Fixed Product ID Mismatch** ✓
   - Changed from `thumbnail.*` to `icon.*` in IAPService.ts
   - Now matches subscriptionScreen.tsx

2. **Fixed Weekly Credits Inconsistency** ✓
   - Changed from 30 to 10 in validate-receipt function
   - Now consistent across all files

3. **Added Enhanced Debug Panel** ✓
   - Shows product IDs and availability
   - Real-time status updates
   - Retry button for loading products
   - Toggle visibility with floating button

4. **Updated Documentation** ✓
   - IAP_SETUP_GUIDE.md updated with correct product IDs
   - Bundle identifiers corrected

Your IAP setup is now properly configured in the code. The only thing left is to ensure your App Store Connect configuration matches these product IDs!
