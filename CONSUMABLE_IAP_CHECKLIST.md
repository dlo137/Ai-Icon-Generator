# App Store Review Checklist for Consumable IAPs

## ✅ CRITICAL: Pre-Submission Checklist

### 1. Product Configuration (App Store Connect)
- [ ] Products are configured as **CONSUMABLE** (not auto-renewable subscriptions)
- [ ] Product IDs exactly match code (e.g., `starter.25`, `value.75`, `pro.200`)
- [ ] Bundle ID in Xcode matches App Store Connect EXACTLY
- [ ] Products are in "Ready to Submit" status
- [ ] At least one screenshot/description per product
- [ ] Cleared for sale = YES
- [ ] Price tier is set correctly

### 2. Code Implementation
- [ ] `finishTransaction` called with `isConsumable: true`
- [ ] Transactions finished ONLY AFTER credits are granted
- [ ] Purchase ledger prevents double-granting credits
- [ ] No subscription or entitlement logic remaining
- [ ] No "isPro" or "isSubscribed" flags

### 3. Restore Purchases
- [ ] Restore does NOT grant credits (consumables can't be restored)
- [ ] Restore button either removed or shows appropriate message
- [ ] No logic that grants credits based on purchase history

### 4. Testing
- [ ] Test with Sandbox account (not production account)
- [ ] Purchase completes and grants correct credits
- [ ] Kill app mid-purchase → restart → credits still granted
- [ ] Purchase same product multiple times (consumables are repeatable)
- [ ] Purchase ledger prevents double-grant on app restart
- [ ] Receipts validated (if using server validation)

### 5. Expo / Build Configuration
- [ ] NOT using Expo Go for IAP testing (use development build)
- [ ] `expo-build-properties` configured for StoreKit if needed
- [ ] Provisioning profile has "In-App Purchase" capability

---

## 🚨 APPLE REJECTION RISKS

### HIGH RISK - Will cause rejection:

1. **Granting credits on restore**
   - ❌ WRONG: `restorePurchases()` → grant credits
   - ✅ RIGHT: `restorePurchases()` → NO-OP for consumables
   
2. **Not finishing transactions**
   - ❌ WRONG: Purchase completes but `finishTransaction` never called
   - ✅ RIGHT: Call `finishTransaction` AFTER credits granted
   
3. **Finishing transactions before granting credits**
   - ❌ WRONG: `finishTransaction` → then grant credits
   - ✅ RIGHT: Grant credits → then `finishTransaction`
   
4. **Product ID mismatch**
   - ❌ WRONG: Code uses `starter_pack` but App Store Connect has `starter.25`
   - ✅ RIGHT: IDs match exactly (case-sensitive)

5. **Missing `isConsumable: true`**
   - ❌ WRONG: `finishTransaction({ purchase })`
   - ✅ RIGHT: `finishTransaction({ purchase, isConsumable: true })`

### MEDIUM RISK - May cause rejection or bad UX:

6. **Double-granting credits**
   - Purchase ledger must prevent this
   - Test: Purchase → kill app → restart → check credits
   
7. **Lost purchases**
   - Transaction listener must run on app startup
   - Must process pending transactions from previous sessions
   
8. **Using subscription terminology**
   - Avoid words like "subscribe", "plan", "monthly"
   - Use "buy", "purchase", "credit pack"

9. **Not handling interrupted purchases**
   - User approves purchase → app crashes → what happens?
   - Must grant credits on next app launch

### LOW RISK - Won't cause rejection but bad practice:

10. **Hardcoded product IDs**
    - Store in config file for easy updates
    
11. **No error handling**
    - Handle network failures gracefully
    
12. **Poor user feedback**
    - Show "Processing..." during purchase
    - Show success message with credits granted

---

## 📋 INTEGRATION STEPS

### Step 1: Update App Store Connect
```
1. Go to "Features" → "In-App Purchases"
2. Click "+" → "Consumable"
3. Set Product ID: starter.25
4. Set Price: $1.99
5. Add localized name & description
6. Submit for review
```

### Step 2: Update Your Code

**In App.tsx or root component:**
```typescript
import ConsumableIAPService from './services/ConsumableIAPService';

useEffect(() => {
  // Initialize on app startup
  const cleanup = async () => {
    await ConsumableIAPService.destroy();
  };
  
  return () => {
    cleanup();
  };
}, []);
```

**In subscriptionScreen.tsx:**
```typescript
import { useConsumableIAP } from '../hooks/useConsumableIAP';

const creditPacks = [
  { productId: 'starter.25', credits: 15, displayName: 'Starter Pack' },
  { productId: 'value.75', credits: 45, displayName: 'Value Pack' },
  { productId: 'pro.200', credits: 120, displayName: 'Pro Pack' },
];

export default function SubscriptionScreen() {
  const { products, purchase, isLoading, purchasingProduct } = useConsumableIAP(creditPacks);
  
  const handlePurchase = async (productId: string) => {
    const result = await purchase(productId);
    if (result.success) {
      Alert.alert('Success', `${result.credits} credits added!`);
    }
  };
  
  // ... rest of UI
}
```

### Step 3: Remove Old Subscription Logic

**Files to check:**
- ❌ Remove: `subscription_plan` column from profiles table
- ❌ Remove: `is_pro_version` boolean flags
- ❌ Remove: Any "check if subscribed" logic
- ✅ Keep: `credits_current` and `credits_max` columns

### Step 4: Test Thoroughly

**Test Scenarios:**
1. Happy path: Purchase → credits granted → transaction finished
2. App crash: Purchase → kill app → restart → credits still granted
3. Double-grant protection: Purchase → restart app 3 times → credits only granted once
4. Multiple purchases: Buy starter pack 3 times → 45 credits total
5. Network failure: Purchase during airplane mode → what happens?

### Step 5: Submit for Review

**Review Notes to Include:**
```
This app uses CONSUMABLE in-app purchases for credit packs.
Each purchase grants a fixed number of AI generation credits.
Credits are NOT restorable (per Apple guidelines for consumables).
Users can purchase credit packs multiple times.

Test Account: [your sandbox email]
Test Instructions: Tap "Buy Credits" → Purchase any pack → Credits will appear in header
```

---

## 🔍 DEBUGGING CHECKLIST

If purchases fail:

1. **Check Bundle ID**
   - Xcode: Target → General → Bundle Identifier
   - Must match App Store Connect exactly

2. **Check Product IDs**
   - Run `ConsumableIAPService.getProducts()`
   - If empty array → product setup issue

3. **Check Sandbox Account**
   - Settings → App Store → Sandbox Account
   - Must be signed in with test account

4. **Check Transaction Finishing**
   - Search logs for "finishTransaction"
   - Should appear AFTER "credits granted"

5. **Check Purchase Ledger**
   - Run `PurchaseLedger.getAllTransactions()`
   - Should show all processed transactions

---

## 📞 SUPPORT RESOURCES

- [Apple: Consumables](https://developer.apple.com/documentation/storekit/in-app_purchase/original_api_for_in-app_purchase/offering_completing_and_restoring_in-app_purchases)
- [react-native-iap: Consumables](https://github.com/dooboolab-community/react-native-iap#-consumable-in-app-purchases)
- [App Review Guidelines: 3.1.1](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase)

---

## ⚠️ FINAL WARNING

**DO NOT:**
- Grant credits in restore flow
- Use subscription terminology
- Use auto-renewable subscription product type
- Finish transactions before granting credits
- Forget `isConsumable: true`

**DO:**
- Test with Sandbox account
- Handle interrupted purchases
- Prevent double-granting with ledger
- Finish transactions after granting credits
- Use consumable product type
