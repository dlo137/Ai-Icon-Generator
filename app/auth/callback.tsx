import { useEffect } from "react";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "../../lib/supabase";

export default function AuthCallback() {
  useEffect(() => {
    const handle = async (url?: string | null) => {
      try {
        const incoming = url ?? (await Linking.getInitialURL());
        if (!incoming) {
          return;
        }

        // Parse URL to check parameters
        const parsedUrl = new URL(incoming);
        const urlParams = parsedUrl.searchParams;
        const hashParams = new URLSearchParams(parsedUrl.hash.substring(1));

        // Check for password reset indicators
        const typeParam = urlParams.get('type') || hashParams.get('type');
        const isPasswordReset = typeParam === 'recovery' || incoming.includes('type=recovery');

        // Try to extract code from URL first
        const code = urlParams.get('code');

        if (!code && !isPasswordReset) {
          // Check for direct tokens (legacy flow)
          const accessToken = hashParams.get('access_token');
          if (accessToken) {
            const refreshToken = hashParams.get('refresh_token');
            if (refreshToken) {
              const { error: setSessionError } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
              if (!setSessionError) {
                router.replace("/(tabs)/generate");
                return;
              }
            }
          }
          router.replace("/login");
          return;
        }

        // Exchange the OAuth/magic link code for a session
        const { data, error } = await supabase.auth.exchangeCodeForSession(code || incoming);

        if (error) {
          // If there's an error but it's a password reset, still try to navigate
          if (isPasswordReset) {
            router.replace("/reset-password");
            return;
          }

          // Otherwise go to login
          router.replace("/login");
          return;
        }

        // Double-check for password reset using session data
        const sessionEvent = data?.session?.user?.aud;
        const isRecovery = sessionEvent === 'recovery' || isPasswordReset;

        // Route based on the type of authentication
        if (isRecovery) {
          router.replace("/reset-password");
        } else {
          router.replace("/(tabs)/generate");
        }
      } catch (e) {
        // Try to detect if this was meant to be a password reset from URL
        try {
          const incoming = url ?? (await Linking.getInitialURL());
          if (incoming && (incoming.includes('type=recovery') || incoming.includes('recovery'))) {
            router.replace("/reset-password");
            return;
          }
        } catch (err) {
        }

        // Default to login on error
        router.replace("/login");
      }
    };

    // Handle initial open
    handle();

    // Also handle future opens while app is running
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  return null;
}