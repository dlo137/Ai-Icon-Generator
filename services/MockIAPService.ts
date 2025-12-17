// MockIAPService.ts - Simulated IAP for Expo Go
// This provides the same API as RealIAPService but doesn't use react-native-iap

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { IIAPService } from './IIAPService';

// Mock product type that matches react-native-iap structure
interface MockProduct {
  productId: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  type: string;
}

// Platform-specific product IDs
const IOS_PRODUCT_IDS = [
  'icon.yearly',
  'icon.monthly',
  'icon.weekly'
];

const ANDROID_PRODUCT_IDS = [
  'ai.icon.pro:yearly',
  'ai.icon.pro:monthly',
  'ai.icon.pro:weekly'
];

class MockIAPService implements IIAPService {
  private static instance: MockIAPService;
  private isConnected: boolean = false;
  private hasListener: boolean = false;
  private debugCallback: ((info: any) => void) | null = null;

  private constructor() {}

  static getInstance(): MockIAPService {
    if (!MockIAPService.instance) {
      MockIAPService.instance = new MockIAPService();
    }
    return MockIAPService.instance;
  }

  async initialize(): Promise<boolean> {
    console.log('[MOCK-IAP] 🧪 Initializing mock IAP service for Expo Go');
    this.isConnected = true;
    this.hasListener = true;

    if (this.debugCallback) {
      this.debugCallback({
        listenerStatus: 'MOCK MODE - Expo Go',
        connectionStatus: { isConnected: true, hasListener: true }
      });
    }

    return true;
  }

  async getProducts(): Promise<MockProduct[]> {
    console.log('[MOCK-IAP] 🧪 Returning mock products for Expo Go');

    const productIds = Platform.OS === 'ios' ? IOS_PRODUCT_IDS : ANDROID_PRODUCT_IDS;

    // Return mock products that match the real product structure
    const mockProducts: MockProduct[] = [
      {
        productId: productIds[0], // yearly
        title: 'Yearly Plan (Mock)',
        description: 'Mock yearly subscription for testing in Expo Go',
        price: '$59.99',
        currency: 'USD',
        type: 'subs'
      },
      {
        productId: productIds[1], // monthly
        title: 'Monthly Plan (Mock)',
        description: 'Mock monthly subscription for testing in Expo Go',
        price: '$5.99',
        currency: 'USD',
        type: 'subs'
      },
      {
        productId: productIds[2], // weekly
        title: 'Weekly Plan (Mock)',
        description: 'Mock weekly subscription for testing in Expo Go',
        price: '$2.99',
        currency: 'USD',
        type: 'subs'
      }
    ];

    console.log('[MOCK-IAP] 📦 Returning 3 mock products');
    return mockProducts;
  }

  async purchaseProduct(productId: string): Promise<void> {
    console.log('[MOCK-IAP] 🧪 Mock purchase initiated for:', productId);

    // Simulate purchase delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (this.debugCallback) {
      this.debugCallback({
        listenerStatus: 'MOCK PURCHASE SUCCESS ✅',
        shouldNavigate: true,
        purchaseComplete: true
      });
    }

    console.log('[MOCK-IAP] ✅ Mock purchase completed');
  }

  async restorePurchases(): Promise<any[]> {
    console.log('[MOCK-IAP] 🧪 Mock restore - returning empty array');
    throw new Error('No previous purchases found');
  }

  async checkForOrphanedTransactions(): Promise<void> {
    console.log('[MOCK-IAP] 🧪 Mock orphan check - no-op');
    // No-op for mock
  }

  isAvailable(): boolean {
    return true; // Always available in mock mode
  }

  setDebugCallback(callback: (info: any) => void) {
    this.debugCallback = callback;
  }

  getLastPurchaseResult() {
    return null;
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      hasListener: this.hasListener,
    };
  }

  async cleanup() {
    console.log('[MOCK-IAP] 🧪 Mock cleanup');
    this.isConnected = false;
    this.hasListener = false;
  }
}

export default MockIAPService.getInstance();
