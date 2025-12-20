import '../polyfills';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking, LogBox } from 'react-native';
import { CreditsProvider } from '../src/contexts/CreditsContext';

// Suppress media library warning and NitroModules error for Expo Go
LogBox.ignoreLogs([
  'Due to changes in Androids permission requirements',
  'NitroModules are not supported in Expo Go',
]);

function RootLayoutNav() {
  const router = useRouter();

  // Listen for deep links from Google Sign-In
  useEffect(() => {
    const subscription = Linking.addEventListener('url', async ({ url }) => {
      console.log('[Deep Link] Received:', url);

      // Handle OAuth callbacks
      if (url.includes('access_token') || url.includes('code=')) {
        console.log('[Deep Link] Auth callback detected');

        try {
          // Import supabase
          const { supabase } = require('../lib/supabase');

          // Parse the URL
          const urlObj = new URL(url);
          const code = urlObj.searchParams.get('code');
          const accessToken = urlObj.searchParams.get('access_token');

          if (code) {
            console.log('[Deep Link] Exchanging code for session...');
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);

            if (error) {
              console.error('[Deep Link] Code exchange error:', error);
            } else {
              console.log('[Deep Link] Session created successfully!');
              router.push('/(tabs)/generate');
            }
          } else if (accessToken) {
            console.log('[Deep Link] Access token found in URL');
            router.push('/(tabs)/generate');
          }
        } catch (error) {
          console.error('[Deep Link] Error handling OAuth callback:', error);
        }
      }
    });

    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    // Global error handler
    const errorHandler = (error: Error, isFatal?: boolean) => {
      console.error('Global error:', error);
      console.error('Error stack:', error.stack);

      // Ignore NitroModules errors in Expo Go (doesn't affect production)
      if (error.message?.includes('NitroModules are not supported in Expo Go')) {
        console.warn('NitroModules error suppressed (Expo Go only)');
        return;
      }

      if (isFatal) {
        Alert.alert(
          'Unexpected Error',
          `Fatal error: ${error.message}\n\nPlease restart the app.`
        );
      }
    };

    // @ts-ignore
    if (ErrorUtils) {
      // @ts-ignore
      ErrorUtils.setGlobalHandler(errorHandler);
    }

    // Catch unhandled promise rejections
    const rejectionHandler = (event: any) => {
      console.error('Unhandled promise rejection:', event);
      if (event && event.reason) {
        console.error('Rejection reason:', event.reason);
      }
    };

    // @ts-ignore
    if (typeof window !== 'undefined' && window.addEventListener) {
      // @ts-ignore
      window.addEventListener('unhandledrejection', rejectionHandler);
    }

    return () => {
      // @ts-ignore
      if (typeof window !== 'undefined' && window.removeEventListener) {
        // @ts-ignore
        window.removeEventListener('unhandledrejection', rejectionHandler);
      }
    };
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: '#6366f1',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Ai Icon Generator',
          headerShown: false
        }}
      />
      <Stack.Screen
        name="signup"
        options={{
          title: 'Sign Up',
          headerShown: false
        }}
      />
      <Stack.Screen
        name="login"
        options={{
          title: 'Login',
          headerShown: false
        }}
      />
      <Stack.Screen
        name="forgot-password"
        options={{
          title: 'Forgot Password',
          headerShown: false
        }}
      />
      <Stack.Screen
        name="reset-password"
        options={{
          title: 'Reset Password',
          headerShown: false
        }}
      />
      <Stack.Screen
        name="auth/callback"
        options={{
          title: 'Auth Callback',
          headerShown: false
        }}
      />
      <Stack.Screen
        name="(tabs)"
        options={{
          headerShown: false
        }}
      />
      <Stack.Screen
        name="loadingaccount"
        options={{
          title: 'Loading',
          headerShown: false
        }}
      />
      <Stack.Screen
        name="subscriptionScreen"
        options={{
          headerShown: false
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <CreditsProvider>
      <RootLayoutNav />
    </CreditsProvider>
  );
}