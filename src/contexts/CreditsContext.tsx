/**
 * CreditsContext.tsx
 * 
 * Context for managing user credits across the app.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Helper to check if user is in guest mode
async function isGuestSession(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return !session;
  } catch {
    return true;
  }
}

interface CreditsContextType {
  credits: number;
  maxCredits: number;
  refreshCredits: () => Promise<void>;
  updateCredits: (newCredits: number) => void;
}

const CreditsContext = createContext<CreditsContextType | undefined>(undefined);

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  const [credits, setCredits] = useState(0);
  const [maxCredits, setMaxCredits] = useState(0);

  const refreshCredits = useCallback(async () => {
    try {
      console.log('[CreditsContext] Refreshing credits from Supabase...');
      
      // Get credits from Supabase
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !user) {
        console.log('[CreditsContext] No authenticated user, setting credits to 0');
        setCredits(0);
        setMaxCredits(0);
        return;
      }

      console.log('[CreditsContext] Fetching profile for user:', user.id);
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('credits_current, credits_max')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('[CreditsContext] Profile fetch error:', profileError);
        setCredits(0);
        setMaxCredits(0);
        return;
      }

      if (profile) {
        setCredits(profile.credits_current || 0);
        setMaxCredits(profile.credits_max || 0);
        console.log('[CreditsContext] ✅ Credits loaded from Supabase:', profile.credits_current, '/', profile.credits_max);
      } else {
        console.warn('[CreditsContext] No profile found');
        setCredits(0);
        setMaxCredits(0);
      }
    } catch (error) {
      console.error('[CreditsContext] Error refreshing credits:', error);
      setCredits(0);
      setMaxCredits(0);
    }
  }, []);

  const updateCredits = useCallback((newCredits: number) => {
    setCredits(newCredits);
  }, []);

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  return (
    <CreditsContext.Provider value={{ credits, maxCredits, refreshCredits, updateCredits }}>
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
