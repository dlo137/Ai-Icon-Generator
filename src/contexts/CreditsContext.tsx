/**
 * CreditsContext.tsx
 * 
 * SINGLE SOURCE OF TRUTH for credits.
 * 
 * ARCHITECTURE:
 * - In-memory state (credits, maxCredits) is the PRIMARY source of truth
 * - Supabase is PERSISTENCE ONLY - used to load/save state
 * - UI components read ONLY from this context
 * - All credit updates go through setCredits() -> triggers re-render
 * 
 * FLOW:
 * 1. On mount: Load from Supabase → setState
 * 2. On purchase: Update state immediately → Save to Supabase in background
 * 3. Header reads state → Auto re-renders when state changes
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface CreditsContextType {
  credits: number;
  maxCredits: number;
  refreshCredits: () => Promise<void>;
  setCreditsImmediate: (current: number, max: number) => void;
}

const CreditsContext = createContext<CreditsContextType | undefined>(undefined);

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  // IN-MEMORY STATE - Single source of truth for UI
  const [credits, setCredits] = useState(0);
  const [maxCredits, setMaxCredits] = useState(0);

  /**
   * Load credits from Supabase (persistence layer)
   * Called on mount and when explicitly refreshing
   */
  const refreshCredits = useCallback(async () => {
    try {
      console.log('[CreditsContext] 🔄 Loading credits from Supabase...');
      
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !user) {
        console.log('[CreditsContext] ⚠️ No authenticated user');
        setCredits(0);
        setMaxCredits(0);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('credits_current, credits_max')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('[CreditsContext] ❌ Profile fetch error:', profileError);
        setCredits(0);
        setMaxCredits(0);
        return;
      }

      if (profile) {
        const newCredits = profile.credits_current || 0;
        const newMaxCredits = profile.credits_max || 0;
        
        console.log('[CreditsContext] ✅ Loaded from Supabase:', newCredits, '/', newMaxCredits);
        
        // Update in-memory state (triggers re-render)
        setCredits(newCredits);
        setMaxCredits(newMaxCredits);
      } else {
        console.warn('[CreditsContext] ⚠️ No profile found');
        setCredits(0);
        setMaxCredits(0);
      }
    } catch (error) {
      console.error('[CreditsContext] ❌ Error refreshing credits:', error);
      setCredits(0);
      setMaxCredits(0);
    }
  }, []);

  /**
   * Immediately update in-memory state (for purchase flow)
   * This guarantees the header updates instantly
   */
  const setCreditsImmediate = useCallback((current: number, max: number) => {
    console.log('[CreditsContext] ⚡ Immediate state update:', current, '/', max);
    setCredits(current);
    setMaxCredits(max);
  }, []);

  // Load credits on mount
  useEffect(() => {
    console.log('[CreditsContext] 🚀 Initializing credits...');
    refreshCredits();
  }, []);

  return (
    <CreditsContext.Provider value={{ credits, maxCredits, refreshCredits, setCreditsImmediate }}>
      {children}
    </CreditsContext.Provider>
  );
}

export function useCredits() {
  const context = useContext(CreditsContext);
  if (context === undefined) {
    throw new Error('useCredits must be used within a CreditsProvider');
  }
  return context;
}

/**
 * WHY THIS GUARANTEES HEADER UPDATES:
 * 
 * 1. Single Source of Truth: credits/maxCredits state in context
 * 2. Header subscribes to context via useCredits()
 * 3. Any setState() call triggers re-render of ALL consumers
 * 4. setCreditsImmediate() updates state synchronously
 * 5. React guarantees: state change → component re-render
 * 
 * FLOW:
 * Purchase → setCreditsImmediate(newValue) → setState → Header re-renders ✅
 */
