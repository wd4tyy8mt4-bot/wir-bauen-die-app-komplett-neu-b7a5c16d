import type { SQLiteDatabase } from 'expo-sqlite';

import {
  INITIAL_ALIAS_KINDS,
  INITIAL_ENTITY_TYPES,
  INITIAL_EVENT_TYPES,
  INITIAL_RELATIONSHIP_TYPES,
  INITIAL_SOURCE_TYPES,
  TYPE_CATALOG_KEYS,
} from '@/domain/constants';
import type { InitialTypeDefinition } from '@/domain/model';

interface CatalogSeed {
  key: string;
  label: string;
  terms: ReadonlyArray<InitialTypeDefinition>;
}

const CATALOGS: CatalogSeed[] = [
  { key: TYPE_CATALOG_KEYS.ENTITY, label: 'Entitätstypen', terms: INITIAL_ENTITY_TYPES },
  { key: TYPE_CATALOG_KEYS.EVENT, label: 'Ereignistypen', terms: INITIAL_EVENT_TYPES },
  { key: TYPE_CATALOG_KEYS.SOURCE, label: 'Quellentypen', terms: INITIAL_SOURCE_TYPES },
  {
    key: TYPE_CATALOG_KEYS.RELATIONSHIP,
    label: 'Beziehungstypen',
    terms: INITIAL_RELATIONSHIP_TYPES,
  },
  { key: TYPE_CATALOG_KEYS.ALIAS, label: 'Aliasarten', terms: INITIAL_ALIAS_KINDS },
];

function deterministicId(kind: 'vocabulary' | 'term' | 'relationship_type', value: string): string {
  return `system_${kind}_${value.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

async function insertBaseRecord(
  db: SQLiteDatabase,
  id: string,
  recordKind: string,
  timestamp: string,
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO records
      (id, record_kind, created_at, updated_at, sync_state, local_revision)
     VALUES (?, ?, ?, ?, 'local_only', 1)`,
    id,
    recordKind,
    timestamp,
    timestamp,
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO record_privacy
      (record_id, classification, classified_at, handling_rules_json)
     VALUES (?, 'PRIVATE', ?, '[]')`,
    id,
    timestamp,
  );
}

export async function seedFoundationCatalogs(db: SQLiteDatabase): Promise<void> {
  const timestamp = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const catalog of CATALOGS) {
      const existingVocabulary = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM vocabularies WHERE key = ?',
        catalog.key,
      );
      const vocabularyId =
        existingVocabulary?.id ?? deterministicId('vocabulary', catalog.key);

      if (!existingVocabulary) {
        await insertBaseRecord(db, vocabularyId, 'vocabulary', timestamp);
        await db.runAsync(
          `INSERT INTO vocabularies
            (id, key, label, description, metadata_json)
           VALUES (?, ?, ?, ?, '{}')`,
          vocabularyId,
          catalog.key,
          catalog.label,
          'Erweiterbarer Startkatalog; benutzerdefinierte Begriffe sind ausdrücklich erlaubt.',
        );
      } else {
        await db.runAsync(
          `UPDATE vocabularies
           SET label = ?, description = ?
           WHERE id = ?`,
          catalog.label,
          'Erweiterbarer Startkatalog; benutzerdefinierte Begriffe sind ausdrücklich erlaubt.',
          vocabularyId,
        );
      }

      for (const term of catalog.terms) {
        const existingTerm = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM vocabulary_terms WHERE vocabulary_id = ? AND code = ?',
          vocabularyId,
          term.key,
        );
        const termId =
          existingTerm?.id ?? deterministicId('term', `${catalog.key}_${term.key}`);

        if (!existingTerm) {
          await insertBaseRecord(db, termId, 'vocabulary_term', timestamp);
          await db.runAsync(
            `INSERT INTO vocabulary_terms
              (id, vocabulary_id, code, label, description, metadata_json)
             VALUES (?, ?, ?, ?, ?, '{}')`,
            termId,
            vocabularyId,
            term.key,
            term.label,
            term.description ?? null,
          );
        } else {
          await db.runAsync(
            'UPDATE vocabulary_terms SET label = ?, description = ? WHERE id = ?',
            term.label,
            term.description ?? null,
            termId,
          );
        }
      }
    }

    for (const type of INITIAL_RELATIONSHIP_TYPES) {
      const existingType = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM relationship_types WHERE key = ?',
        type.key,
      );
      const typeId = existingType?.id ?? deterministicId('relationship_type', type.key);
      if (!existingType) {
        await insertBaseRecord(db, typeId, 'relationship_type', timestamp);
        await db.runAsync(
          `INSERT INTO relationship_types
            (id, key, label, description, constraints_json, metadata_json)
           VALUES (?, ?, ?, ?, '{}', '{}')`,
          typeId,
          type.key,
          type.label,
          type.description ?? null,
        );
      } else {
        await db.runAsync(
          'UPDATE relationship_types SET label = ?, description = ? WHERE id = ?',
          type.label,
          type.description ?? null,
          typeId,
        );
      }
    }
  });
}
