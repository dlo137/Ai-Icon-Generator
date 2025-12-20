import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SessionInfo {
  isAuthenticated: boolean;
  user: any;
  session: any;
  isGuest: boolean;
}

/**
 * Comprehensive session check that handles both regular users and guests
 */
export const checkUserSession = async (): Promise<SessionInfo> => {
  try {
    const { isGuestSession } = require('./guestSession');
    
    // Starting comprehensive session check
    
    // Check onboarding completion status first
    let hasCompletedOnboarding = false;
    try {
      const onboardingStatus = await AsyncStorage.getItem('hasCompletedOnboarding');
      hasCompletedOnboarding = onboardingStatus === 'true';
    } catch (asyncError) {
    }
    
    // Check for stored session first with better error handling
    let storedSession = null;
    try {
      storedSession = await AsyncStorage.getItem('supabase.auth.token');
    } catch (asyncError) {
    }
    
    // Get current session from Supabase with timeout
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Session check timeout')), 5000)
    );
    
    let session = null;
    let user = null;
    let error = null;
    
    try {
      const result = await Promise.race([sessionPromise, timeoutPromise]) as any;
      session = result.data?.session;
      user = result.data?.user;
      error = result.error;
    } catch (timeoutError) {      
      // If we have a stored session and completed onboarding, try to trust it
      if (storedSession && hasCompletedOnboarding) {
        return { isAuthenticated: true, user: null, session: null, isGuest: false };
      }
    }
    
    if (error) {      
      // Clear invalid sessions but preserve onboarding completion
      if (error.message?.toLowerCase().includes('refresh token') ||
          error.message?.toLowerCase().includes('invalid') ||
          error.message?.toLowerCase().includes('jwt') ||
          error.message?.toLowerCase().includes('expired')) {
        await clearSession(false); // Don't clear onboarding - just session data
      }
      
      // Check guest session as fallback
      const isGuest = await isGuestSession();
      // If we have completed onboarding and have any form of session, consider authenticated
      if (hasCompletedOnboarding && (storedSession || isGuest)) {
        return { isAuthenticated: true, user: null, session: null, isGuest };
      }
      
      return { isAuthenticated: isGuest, user: null, session: null, isGuest };
    }
    
    // Check guest session
    const isGuest = await isGuestSession();
    
    // For non-guest sessions, verify the user actually exists in the database
    let isAuthenticated = !!(session?.user || isGuest);
    
    if (session?.user && !isGuest) {
      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, name, onboarding_completed')
          .eq('id', session.user.id)
          .maybeSingle();

        if (profileError) {
          isAuthenticated = false;
        } else if (!profile) {
          isAuthenticated = false;
          // Clear invalid session
          await clearSession(true);
        } else {
          // Update onboarding status based on database if available
          if (profile.onboarding_completed !== null && profile.onboarding_completed !== undefined) {
            await AsyncStorage.setItem('hasCompletedOnboarding', profile.onboarding_completed ? 'true' : 'false');
            hasCompletedOnboarding = profile.onboarding_completed;
          }
        }
      } catch (profileValidationError) {
        // Don't fail the whole auth check, but be cautious
      }
    }
    
    const finalIsAuthenticated = isAuthenticated;
    
    // Persist session state for faster startup
    if (finalIsAuthenticated) {
      try {
        const currentTime = Date.now().toString();
        await AsyncStorage.setItem('lastAuthCheck', currentTime);
        await AsyncStorage.setItem('hasValidSession', 'true');
        
        // If we have a real session (not guest), also store session indicator
        if (session?.user && !isGuest) {
          await AsyncStorage.setItem('lastValidAuth', currentTime);
        }
      } catch (asyncError) {
      }
    }
    
    return {
      isAuthenticated: finalIsAuthenticated,
      user: user || null,
      session: session || null,
      isGuest
    };
    
  } catch (error) {
    console.error('[SESSION] Error in checkUserSession:', error);
    
    // Final fallback: check if we have any cached auth state
    try {
      const { isGuestSession } = require('./guestSession');
      const isGuest = await isGuestSession();
      const hasValidSession = await AsyncStorage.getItem('hasValidSession');
      const lastAuthCheck = await AsyncStorage.getItem('lastAuthCheck');
      const hasCompletedOnboarding = await AsyncStorage.getItem('hasCompletedOnboarding');
      
      console.log('[SESSION] Fallback cache check:', {
        hasValidSession,
        lastAuthCheck,
        hasCompletedOnboarding: hasCompletedOnboarding === 'true',
        isGuest
      });
      
      // If user has completed onboarding, prioritize that over session checks
      if (hasCompletedOnboarding === 'true') {
        console.log('[SESSION] User completed onboarding - considering authenticated');
        
        // If we have recent cached auth and it's not too old (< 6 hours), trust it
        if (hasValidSession === 'true' && lastAuthCheck) {
          const timeSinceLastCheck = Date.now() - parseInt(lastAuthCheck);
          if (timeSinceLastCheck < 21600000) { // 6 hours
            console.log('[SESSION] Using cached auth state (onboarding completed)');
            return { isAuthenticated: true, user: null, session: null, isGuest: false };
          }
        }
        
        // Even without recent cache, if onboarding is complete and we have guest or any session indicators
        if (isGuest) {
          console.log('[SESSION] Onboarding complete + guest session = authenticated');
          return { isAuthenticated: true, user: null, session: null, isGuest: true };
        }
      }
      
      // Standard fallback
      if (hasValidSession === 'true' && lastAuthCheck) {
        const timeSinceLastCheck = Date.now() - parseInt(lastAuthCheck);
        if (timeSinceLastCheck < 3600000) { // 1 hour
          console.log('[SESSION] Using standard cached auth state');
          return { isAuthenticated: true, user: null, session: null, isGuest: false };
        }
      }
      
      return { isAuthenticated: isGuest, user: null, session: null, isGuest };
    } catch (fallbackError) {
      console.error('[SESSION] Fallback check failed:', fallbackError);
      return { isAuthenticated: false, user: null, session: null, isGuest: false };
    }
  }
};

/**
 * Clear all session data
 * @param clearOnboarding - Whether to clear the onboarding completion flag (default: false)
 */
export const clearSession = async (clearOnboarding: boolean = false): Promise<void> => {
  try {
    console.log('[SESSION] Clearing session data... (clearOnboarding:', clearOnboarding, ')');
    
    await supabase.auth.signOut();
    
    // Prepare items to remove - conditionally include onboarding flag
    const itemsToRemove = [
      'supabase.auth.token',
      'hasValidSession', 
      'lastAuthCheck',
      'lastValidAuth'
    ];
    
    // Only clear onboarding if explicitly requested (e.g., during sign out or account deletion)
    if (clearOnboarding) {
      itemsToRemove.push('hasCompletedOnboarding');
      console.log('[SESSION] Including onboarding completion flag in clear operation');
    }
    
    // Clear auth-related AsyncStorage items
    try {
      await AsyncStorage.multiRemove(itemsToRemove);
      console.log('[SESSION] Cleared items:', itemsToRemove);
    } catch (asyncError) {
      console.warn('[SESSION] Error clearing AsyncStorage:', asyncError);
      // Try to clear individually if multiRemove fails
      for (const item of itemsToRemove) {
        try {
          await AsyncStorage.removeItem(item);
        } catch (individualError) {
          console.warn(`[SESSION] Failed to clear ${item}:`, individualError);
        }
      }
    }
    
    // Clear guest session if exists (but preserve guest data unless clearOnboarding is true)
    const { clearGuestSession } = require('./guestSession');
    if (clearOnboarding) {
      await clearGuestSession();
      console.log('[SESSION] Guest session cleared due to clearOnboarding flag');
    }
    
    console.log('[SESSION] Session data cleared successfully');
  } catch (error) {
    console.error('[SESSION] Error clearing session:', error);
  }
};

/**
 * Refresh the current session
 */
export const refreshSession = async (): Promise<boolean> => {
  try {
    console.log('[SESSION] Refreshing session...');
    
    const { data, error } = await supabase.auth.refreshSession();
    
    if (error) {
      console.log('[SESSION] Error refreshing session:', error.message);
      await clearSession(false); // Don't clear onboarding on refresh failures
      return false;
    }
    
    console.log('[SESSION] Session refreshed successfully');
    return true;
  } catch (error) {
    console.error('[SESSION] Error in refreshSession:', error);
    return false;
  }
};

/**
 * Set up auth state listener for persistent session management
 */
export const setupAuthListener = (callback?: (isAuthenticated: boolean) => void) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    switch (event) {
      case 'SIGNED_IN':
        callback?.(true);
        break;
        
      case 'SIGNED_OUT':        
        // Check if this is during guest session creation (don't clear onboarding in that case)
        try {
          const { isCreatingGuestSession, isGuestSession } = require('./guestSession');
          const isCreatingGuest = await isCreatingGuestSession();
          const isGuest = await isGuestSession();
          
          if (isCreatingGuest) {
            await clearSession(false); // Don't clear onboarding during guest session creation
          } else if (isGuest) {
            await clearSession(false); // Don't clear onboarding for guests
          } else {
            await clearSession(true); // Clear onboarding on regular sign out
          }
        } catch (guestCheckError) {
          await clearSession(false); // Safe default - don't clear onboarding
        }
        
        callback?.(false);
        break;
        
      case 'TOKEN_REFRESHED':
        callback?.(true);
        break;
        
      case 'USER_UPDATED':
        break;
    }
  });
  
  return subscription;
};