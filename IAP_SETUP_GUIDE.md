# In-App Purchase Setup Guide

## Issue: Button Stuck on "Processing..."

This happens when the IAP purchase flow doesn't complete properly. Here's how to fix it:

## 1. Apple Developer Console Setup

### A. Create In-App Purchase Products

1. Go to: https://appstoreconnect.apple.com
2. Navigate to: **My Apps** > **Your App** > **Subscriptions**
3. Create three auto-renewable subscription products:

   **Weekly Plan:**
   - Product ID: `icon.weekly`
   - Price: $2.99/week
   - Subscription Group: Create a new group (e.g., "Icon Pro")

   **Monthly Plan:**
   - Product ID: `icon.monthly`
   - Price: $5.99/month
   - Subscription Group: Same as above

   **Yearly Plan:**
   - Product ID: `icon.yearly`
   - Price: $59.99/year
   - Subscription Group: Same as above

4. For each product, add:
   - Display Name
   - Description
   - Review Information

### B. App Store Sandbox Testing

1. Go to: **Users and Access** > **Sandbox Testers**
2. Create a test user with a different email than your main Apple ID
3. **IMPORTANT**: Sign out of your main Apple ID on your test device
4. When testing, sign in with the sandbox test account

## 2. App Configuration

### A. Update app.config.ts

Make sure you have:

```typescript
ios: {
  bundleIdentifier: "com.watson.AI-Icon-Generator",
  usesAppleSignIn: true,
  infoPlist: {
    ITSAppUsesNonExemptEncryption: false,
    NSPhotoLibraryUsageDescription: "This app needs access to your photo library to save generated icons.",
  }
}
```

### B. Verify Product IDs Match

In `subscriptionScreen.tsx`, verify:

```typescript
const PRODUCT_IDS = Platform.OS === 'ios' ? {
  yearly: 'icon.yearly',
  monthly: 'icon.monthly',
  weekly: 'icon.weekly',
} : {
  yearly: 'ai.icon.pro:yearly',
  monthly: 'ai.icon.pro:monthly',
  weekly: 'ai.icon.pro:weekly',
};
```

These MUST match exactly what's in App Store Connect.

## 3. Testing Checklist

### Before Testing:

- [ ] Products created in App Store Connect
- [ ] Products in "Ready to Submit" or "Approved" state
- [ ] Sandbox tester account created
- [ ] App built with `eas build` (not Expo Go)
- [ ] TestFlight build uploaded

### During Testing:

1. **Sign out** of your main Apple ID on the device
2. Install TestFlight build
3. Open app and go to subscription screen
4. Tap "Continue" on a plan
5. When prompted, sign in with **sandbox test account**
6. Complete purchase flow

### Common Issues:

**"Cannot connect to iTunes Store"**
- Solution: Make sure you're signed out of regular App Store
- Sign in only when prompted during purchase

**"Processing..." stuck forever**
- Solution: Products might not be approved in App Store Connect
- Check product status (must be "Ready to Submit" or "Approved")
- Try restore purchases to verify

**"Product not found"**
- Solution: Product IDs don't match
- Double-check spelling and capitalization
- Wait 2-4 hours after creating products

## 4. Production Checklist

Before releasing to production:

- [ ] All products in "Approved" state
- [ ] Subscription pricing correct ($2.99, $5.99, $59.99)
- [ ] Terms and conditions added to subscription group
- [ ] App metadata includes subscription details
- [ ] Receipt validation implemented (Supabase handles this)

## 5. Debugging in Production

If users report stuck on "Processing...":

1. **Check App Store Connect**:
   - Products must be in "Approved" state
   - Subscriptions must be active

2. **Check Logs**:
   - Look for "Purchase response:" logs
   - Check for error codes

3. **Have User Try**:
   - Close app completely
   - Open Settings > [Their Name] > Subscriptions
   - Check if subscription shows there
   - If yes: Use "Restore Purchases" button

## 6. Code Improvements Made

I've added:

✅ **60-second timeout** - Prevents infinite "Processing..." state
✅ **Fallback check** - Verifies purchase after 5 seconds if listener doesn't fire
✅ **Better error handling** - Detects user cancellation vs. actual errors
✅ **Timeout alert** - Offers to check purchase history if stuck

## 7. Test the Fix

1. Build new version:
   ```bash
   eas build --platform ios --profile production
   ```

2. Upload to TestFlight

3. Test with sandbox account

4. Purchase should either:
   - Complete successfully, OR
   - Show timeout message after 60 seconds with option to restore

## Need Help?

If still stuck, check:
- Console logs during purchase attempt
- App Store Connect > Agreements, Tax, and Banking (must be completed)
- Subscription group configuration
