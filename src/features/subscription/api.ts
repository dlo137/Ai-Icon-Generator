import { supabase } from '../../../lib/supabase';

export interface SupabaseSubscriptionInfo {
  is_pro_version: boolean;
  subscription_plan?: string;
  product_id?: string;
  credits_current?: number;
  credits_max?: number;
  purchase_time?: string;
  price?: number;
}

/**
 * Get subscription info from Supabase profile
 */
export async function getSubscriptionInfo(): Promise<SupabaseSubscriptionInfo | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      console.log('[Subscription API] No active session');
      return null;
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('is_pro_version, subscription_plan, product_id, credits_current, credits_max, purchase_time, price')
      .eq('id', session.user.id)
      .single();

    if (error) {
      console.error('[Subscription API] Error fetching subscription:', error);
      return null;
    }

    return profile as SupabaseSubscriptionInfo;
  } catch (error) {
    console.error('[Subscription API] Unexpected error:', error);
    return null;
  }
}

/**
 * Update subscription info in Supabase profile
 */
export async function updateSubscriptionInfo(
  updates: Partial<SupabaseSubscriptionInfo>
): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      console.error('[Subscription API] No active session');
      return false;
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', session.user.id);

    if (error) {
      console.error('[Subscription API] Error updating subscription:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Subscription API] Unexpected error:', error);
    return false;
  }
}
