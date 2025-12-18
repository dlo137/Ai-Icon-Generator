// Central source of truth for subscription plans
// DO NOT modify plan data based on purchase object - use user's selection

export type SubscriptionPlan = 'weekly' | 'monthly' | 'yearly';

export const PLAN_CONFIG = {
  weekly: {
    credits: 10,
    durationDays: 7,
    productId: 'ai.icons.weekly',
    price: 2.99,
  },
  monthly: {
    credits: 75,
    durationMonths: 1,
    productId: 'ai.icons.monthly',
    price: 5.99,
  },
  yearly: {
    credits: 90,
    durationYears: 1,
    productId: 'ai.icons.yearly',
    price: 59.99,
  },
} as const;

/**
 * Calculate subscription end date based on plan
 */
export function calculateEndDate(plan: SubscriptionPlan, startDate: Date = new Date()): Date {
  const endDate = new Date(startDate);
  const config = PLAN_CONFIG[plan];

  if ('durationDays' in config) {
    endDate.setDate(endDate.getDate() + config.durationDays);
  } else if ('durationMonths' in config) {
    endDate.setMonth(endDate.getMonth() + config.durationMonths);
  } else if ('durationYears' in config) {
    endDate.setFullYear(endDate.getFullYear() + config.durationYears);
  }

  return endDate;
}
