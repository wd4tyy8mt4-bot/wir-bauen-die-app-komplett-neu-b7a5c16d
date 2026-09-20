import '../_system/early-error-handler';
import '../global.css';

import { useEffect } from 'react';
import { Stack, useNavigationContainerRef } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getNavigationIntegration, wrapWithSentry } from '../_system/sentry';
import { ErrorBoundary } from '../_system/ErrorBoundary';
import { GlobalErrorOverlay } from '../_system/GlobalErrorOverlay';
import { AppifexFloatingButton } from '../_system/AppifexFloatingButton';
import { AppProviders } from '@/providers/AppProviders';
import { palette } from '@/theme/design';

function RootLayout() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    const integration = getNavigationIntegration();
    integration?.registerNavigationContainer(navigationRef);
  }, [navigationRef]);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppProviders>
          <Stack
            initialRouteName="index"
            screenOptions={{
              headerShown: false,
              headerBackButtonDisplayMode: 'minimal',
              contentStyle: { backgroundColor: palette.background },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="review" options={{ presentation: 'card', animation: 'slide_from_right' }} />
          </Stack>
        </AppProviders>
        <StatusBar style="light" />
        <AppifexFloatingButton />
        <GlobalErrorOverlay />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default wrapWithSentry(RootLayout);
