import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { useEffect } from 'react';

export default function App() {
  const posthog = usePostHog();
  
  useEffect(() => {
    posthog?.capture('app_opened_test');
  }, [posthog]);

  return (
    <PostHogProvider apiKey="phc_UIEKZ38vjlXI2YhAhYHJ1n6Mosf1wti1XUzE9Zb5WQT" options={{
      host: 'https://us.i.posthog.com',
      enableSessionReplay: true,
    }} autocapture>
      <View style={styles.container}>
        <Text>Open up App.tsx to start working on your app!</Text>
        <StatusBar style="auto" />
      </View>
    </PostHogProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});