// IIAPService.ts - Shared interface for all IAP service implementations
// Both MockIAPService and RealIAPService must implement this

export interface IIAPService {
  // Lifecycle methods
  initialize(): Promise<boolean>;
  cleanup(): Promise<void>;

  // Product methods
  getProducts(): Promise<any[]>;
  purchaseProduct(productId: string): Promise<void>;
  restorePurchases(): Promise<any[]>;
  checkForOrphanedTransactions(): Promise<void>;

  // Status methods
  isAvailable(): boolean;
  getConnectionStatus(): { isConnected: boolean; hasListener: boolean };
  getLastPurchaseResult(): any;

  // Debug methods
  setDebugCallback(callback: (info: any) => void): void;
}
