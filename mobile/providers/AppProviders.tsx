import { Suspense } from 'react';
import type { PropsWithChildren } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SQLiteProvider } from 'expo-sqlite';

import { DATABASE_NAME, initializeDatabase } from '@/data/database/initialize';
import { palette } from '@/theme/design';

import { ApplicationProvider } from './ApplicationProvider';
import { RepositoryProvider } from './RepositoryProvider';

function DatabaseFallback() {
  return (
    <View style={styles.container} accessibilityRole="progressbar">
      <ActivityIndicator size="small" color={palette.blue} />
      <Text style={styles.label}>Dein persönlicher Speicher wird vorbereitet …</Text>
    </View>
  );
}

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <Suspense fallback={<DatabaseFallback />}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={initializeDatabase} useSuspense>
        <RepositoryProvider>
          <ApplicationProvider>{children}</ApplicationProvider>
        </RepositoryProvider>
      </SQLiteProvider>
    </Suspense>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: palette.background,
  },
  label: {
    color: palette.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
});
