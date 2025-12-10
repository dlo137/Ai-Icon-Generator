import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { Platform } from "react-native";

const SUPABASE_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL ||
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SUPABASE_URL) || '';
const SUPABASE_ANON_KEY = Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY) || '';

// This is the URL Supabase should bounce back to after OAuth/magic link.
// Always use custom scheme - works in development and production
const scheme = Constants.expoConfig?.scheme || 'icongenerator';
export const redirectTo = `${scheme}://auth/callback`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // RN app, not web
    flowType: "pkce",          // required for mobile OAuth
    storageKey: 'supabase.auth.token', // Custom storage key for persistence
  },
});

// Helper function to check and clear bad tokens
export const checkAuthErrors = async () => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error?.message?.includes('audience') || error?.message?.includes('id_token')) {
      console.log('Invalid token detected, clearing session...');
      await supabase.auth.signOut();
      await AsyncStorage.removeItem('supabase.auth.token');
      return false;
    }

    return !!session;
  } catch (error) {
    console.error('Error checking auth:', error);
    return false;
  }
};