// Central source of truth for consumable IAP packs
// DO NOT modify plan data based on purchase object - use user's selection

export type SubscriptionPlan = 'starter' | 'value' | 'pro';

export const PLAN_CONFIG = {
  starter: {
    credits: 15,
    productId: 'starter.25',
    price: 1.99,
  },
  value: {
    credits: 45,
    productId: 'value.75',
    price: 5.99,
  },
  pro: {
    credits: 120,
    productId: 'pro.200',
    price: 14.99,
  },
} as const;
