// IAPService.ts - Smart wrapper that chooses Mock or Real implementation
// This prevents NitroModules from loading in Expo Go

import Constants from 'expo-constants';

// Detect if running in Expo Go
const isExpoGo = Constants.executionEnvironment === 'storeClient';

console.log('[IAP-SERVICE] Environment:', isExpoGo ? '🧪 Expo Go (Mock)' : '📱 Native Build (Real)');

// Dynamically choose the right implementation
let IAPService: any;

if (isExpoGo) {
  // In Expo Go: Use mock implementation (no react-native-iap loaded)
  console.log('[IAP-SERVICE] Loading MockIAPService for Expo Go');
  IAPService = require('./MockIAPService').default;
} else {
  // In native builds: Use real implementation with react-native-iap
  console.log('[IAP-SERVICE] Loading RealIAPService for native build');
  IAPService = require('./RealIAPService').default;
}

export default IAPService;
