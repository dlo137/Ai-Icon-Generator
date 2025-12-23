/**
 * PurchaseLedger.ts
 * 
 * Persistent ledger for tracking processed IAP transactions.
 * 
 * PURPOSE:
 * Prevents double-granting credits when:
 * - App restarts and StoreKit re-delivers a transaction
 * - Transaction listener fires multiple times for same purchase
 * - User reinstalls app and old transactions are re-processed
 * 
 * STORAGE:
 * AsyncStorage with format:
 * {
 *   [transactionId]: {
 *     productId: string,
 *     credits: number,
 *     processedAt: ISO timestamp,
 *     granted: boolean
 *   }
 * }
 * 
 * CRITICAL: This is the source of truth for "has this transaction been processed?"
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const LEDGER_KEY = '@iap_purchase_ledger';

export interface LedgerEntry {
  productId: string;
  credits: number;
  processedAt: string;
  granted: boolean;
}

export class PurchaseLedger {
  /**
   * Check if a transaction has already been processed.
   * 
   * CRITICAL: Must be checked BEFORE granting credits to prevent duplicates.
   * 
   * @param transactionId - Transaction ID from StoreKit
   * @returns true if already processed, false otherwise
   */
  static async isProcessed(transactionId: string): Promise<boolean> {
    try {
      const ledger = await this.getLedger();
      const entry = ledger[transactionId];
      
      if (entry && entry.granted) {
        console.log('[PurchaseLedger] Transaction already processed:', transactionId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[PurchaseLedger] Error checking transaction:', error);
      // On error, assume not processed to avoid blocking legitimate purchases
      return false;
    }
  }

  /**
   * Record a processed transaction in the ledger.
   * 
   * CRITICAL: Must be called AFTER credits are granted but BEFORE finishing transaction.
   * If app crashes between granting and recording, credits may be granted twice.
   * Solution: Make credit granting idempotent.
   * 
   * @param transactionId - Transaction ID from StoreKit
   * @param productId - Product ID purchased
   * @param credits - Number of credits granted
   */
  static async recordPurchase(
    transactionId: string,
    productId: string,
    credits: number
  ): Promise<void> {
    try {
      const ledger = await this.getLedger();
      
      ledger[transactionId] = {
        productId,
        credits,
        processedAt: new Date().toISOString(),
        granted: true,
      };
      
      await this.saveLedger(ledger);
      
      console.log('[PurchaseLedger] Recorded transaction:', transactionId, credits, 'credits');
    } catch (error) {
      console.error('[PurchaseLedger] Failed to record transaction:', error);
      throw error;
    }
  }

  /**
   * Get all processed transactions.
   * 
   * Useful for debugging or analytics.
   */
  static async getAllTransactions(): Promise<Record<string, LedgerEntry>> {
    return await this.getLedger();
  }

  /**
   * Clear the ledger.
   * 
   * WARNING: Only use for testing/debugging.
   * In production, ledger should persist forever.
   */
  static async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(LEDGER_KEY);
      console.log('[PurchaseLedger] Ledger cleared');
    } catch (error) {
      console.error('[PurchaseLedger] Failed to clear ledger:', error);
    }
  }

  /**
   * Get the ledger from storage.
   */
  private static async getLedger(): Promise<Record<string, LedgerEntry>> {
    try {
      const data = await AsyncStorage.getItem(LEDGER_KEY);
      if (!data) {
        return {};
      }
      return JSON.parse(data);
    } catch (error) {
      console.error('[PurchaseLedger] Failed to load ledger:', error);
      return {};
    }
  }

  /**
   * Save the ledger to storage.
   */
  private static async saveLedger(ledger: Record<string, LedgerEntry>): Promise<void> {
    try {
      await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    } catch (error) {
      console.error('[PurchaseLedger] Failed to save ledger:', error);
      throw error;
    }
  }

  /**
   * Get credits granted for a specific transaction.
   * 
   * Useful for verification or debugging.
   */
  static async getGrantedCredits(transactionId: string): Promise<number | null> {
    try {
      const ledger = await this.getLedger();
      const entry = ledger[transactionId];
      return entry?.granted ? entry.credits : null;
    } catch (error) {
      console.error('[PurchaseLedger] Error getting granted credits:', error);
      return null;
    }
  }

  /**
   * Prune old entries from ledger (optional maintenance).
   * 
   * Keep last 1000 entries or entries from last 90 days.
   * This prevents ledger from growing indefinitely.
   * 
   * NOTE: Be conservative - better to keep old entries than lose them.
   */
  static async pruneOldEntries(): Promise<void> {
    try {
      const ledger = await this.getLedger();
      const entries = Object.entries(ledger);
      
      // Keep last 1000 entries
      if (entries.length <= 1000) {
        return;
      }

      // Sort by processedAt (newest first)
      entries.sort((a, b) => {
        const timeA = new Date(a[1].processedAt).getTime();
        const timeB = new Date(b[1].processedAt).getTime();
        return timeB - timeA;
      });

      // Keep only newest 1000
      const pruned = Object.fromEntries(entries.slice(0, 1000));
      
      await this.saveLedger(pruned);
      
      console.log('[PurchaseLedger] Pruned ledger:', entries.length, '→', 1000);
    } catch (error) {
      console.error('[PurchaseLedger] Failed to prune ledger:', error);
    }
  }
}
