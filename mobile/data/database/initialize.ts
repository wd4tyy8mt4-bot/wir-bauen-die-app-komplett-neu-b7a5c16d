import type { SQLiteDatabase } from 'expo-sqlite';

import { migrateDatabase } from './migrations';
import { seedFoundationCatalogs } from './seed';

export const DATABASE_NAME = 'personal-life-os.db';

export async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
  await migrateDatabase(db);
  await seedFoundationCatalogs(db);
}
