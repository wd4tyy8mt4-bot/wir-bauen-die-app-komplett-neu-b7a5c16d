import type { SQLiteDatabase } from 'expo-sqlite';
import initSqlJs from 'sql.js';
import type { Database, SqlValue } from 'sql.js';

interface ClosableSQLiteDatabase extends SQLiteDatabase {
  closeAsync(): Promise<void>;
}

function normalizeParams(params: unknown[]): SqlValue[] {
  return params.map((value) => (value === undefined ? null : (value as SqlValue)));
}

export async function createTestDatabase(): Promise<ClosableSQLiteDatabase> {
  const SQL = await initSqlJs({
    locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
  });
  const database: Database = new SQL.Database();

  const adapter = {
    async execAsync(sql: string): Promise<void> {
      database.run(sql);
    },
    async runAsync(sql: string, ...params: unknown[]) {
      database.run(sql, normalizeParams(params));
      return {
        lastInsertRowId: 0,
        changes: database.getRowsModified(),
      };
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const statement = database.prepare(sql);
      try {
        statement.bind(normalizeParams(params));
        return statement.step() ? (statement.getAsObject() as T) : null;
      } finally {
        statement.free();
      }
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const statement = database.prepare(sql);
      const rows: T[] = [];
      try {
        statement.bind(normalizeParams(params));
        while (statement.step()) {
          rows.push(statement.getAsObject() as T);
        }
        return rows;
      } finally {
        statement.free();
      }
    },
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      database.run('BEGIN');
      try {
        await task();
        database.run('COMMIT');
      } catch (error) {
        database.run('ROLLBACK');
        throw error;
      }
    },
    async closeAsync(): Promise<void> {
      database.close();
    },
  };

  return adapter as unknown as ClosableSQLiteDatabase;
}
