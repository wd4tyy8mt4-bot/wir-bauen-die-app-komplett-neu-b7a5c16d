import type { SQLiteDatabase } from 'expo-sqlite';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'open_knowledge_graph_foundation',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE records (
        id TEXT PRIMARY KEY,
        record_kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        local_revision INTEGER NOT NULL DEFAULT 1,
        remote_revision TEXT,
        sync_state TEXT NOT NULL DEFAULT 'local_only',
        device_id TEXT,
        last_synced_at TEXT,
        conflict_json TEXT
      );

      CREATE INDEX idx_records_active_kind ON records(record_kind, updated_at)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_records_sync ON records(sync_state, updated_at)
        WHERE deleted_at IS NULL;

      CREATE TABLE record_privacy (
        record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        classification TEXT NOT NULL DEFAULT 'PRIVATE',
        reason TEXT,
        classified_at TEXT NOT NULL,
        classified_by TEXT,
        handling_rules_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE entities (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        type_key TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX idx_entities_type_status ON entities(type_key, status);
      CREATE INDEX idx_entities_title ON entities(title COLLATE NOCASE);

      CREATE TABLE attribute_definitions (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        value_type TEXT NOT NULL,
        description TEXT,
        cardinality TEXT NOT NULL DEFAULT 'many',
        constraints_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE attribute_values (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        definition_id TEXT REFERENCES attribute_definitions(id) ON DELETE SET NULL,
        key TEXT NOT NULL,
        value_type TEXT NOT NULL,
        text_value TEXT,
        number_value REAL,
        boolean_value INTEGER,
        datetime_value TEXT,
        json_value TEXT,
        entity_reference_id TEXT REFERENCES entities(id) ON DELETE RESTRICT,
        term_reference_id TEXT,
        ordinal INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX idx_attribute_values_entity ON attribute_values(entity_id, key, ordinal);
      CREATE INDEX idx_attribute_values_definition ON attribute_values(definition_id);
      CREATE INDEX idx_attribute_values_text ON attribute_values(key, text_value COLLATE NOCASE);

      CREATE TABLE relationship_types (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        inverse_key TEXT,
        description TEXT,
        constraints_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        type_key TEXT NOT NULL,
        type_definition_id TEXT REFERENCES relationship_types(id) ON DELETE SET NULL,
        source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
        target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
        title TEXT,
        description TEXT,
        status TEXT,
        valid_from TEXT,
        valid_to TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX idx_relationships_source ON relationships(source_entity_id, type_key);
      CREATE INDEX idx_relationships_target ON relationships(target_entity_id, type_key);

      CREATE TABLE events (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        type_key TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT,
        occurred_at TEXT,
        ended_at TEXT,
        actor_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX idx_events_occurred_at ON events(occurred_at DESC);
      CREATE INDEX idx_events_type ON events(type_key, occurred_at DESC);

      CREATE TABLE event_subjects (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
        ordinal INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (event_id, entity_id)
      );

      CREATE TABLE event_relationships (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        relationship_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE RESTRICT,
        ordinal INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (event_id, relationship_id)
      );

      CREATE TABLE sources (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        type_key TEXT NOT NULL,
        title TEXT,
        uri TEXT,
        captured_at TEXT NOT NULL,
        observed_at TEXT,
        content_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
        originating_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
        source_device_id TEXT,
        checksum TEXT,
        is_ai_inference INTEGER NOT NULL DEFAULT 0,
        is_user_confirmed INTEGER NOT NULL DEFAULT 0,
        confidence REAL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX idx_sources_checksum ON sources(checksum);
      CREATE INDEX idx_sources_uri ON sources(uri);

      CREATE TABLE vocabularies (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        description TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE vocabulary_terms (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        vocabulary_id TEXT NOT NULL REFERENCES vocabularies(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT,
        parent_term_id TEXT REFERENCES vocabulary_terms(id) ON DELETE SET NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (vocabulary_id, code)
      );

      CREATE INDEX idx_terms_parent ON vocabulary_terms(parent_term_id);

      CREATE TABLE aliases (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'name',
        language TEXT,
        is_preferred INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE UNIQUE INDEX idx_alias_unique ON aliases(
        entity_id,
        normalized_value,
        kind,
        IFNULL(language, '')
      );
      CREATE INDEX idx_alias_lookup ON aliases(normalized_value, kind);

      CREATE TABLE record_provenance_links (
        record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
        role TEXT NOT NULL DEFAULT 'evidence',
        ordinal INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (record_id, source_id, role)
      );

      CREATE INDEX idx_provenance_source ON record_provenance_links(source_id, record_id);
    `,
  },
  {
    version: 2,
    name: 'dynamic_catalogs_and_unknown_entity_resolution',
    sql: `
      ALTER TABLE entities ADD COLUMN is_placeholder INTEGER NOT NULL DEFAULT 0
        CHECK (is_placeholder IN (0, 1));
      ALTER TABLE entities ADD COLUMN resolved_entity_id TEXT
        REFERENCES entities(id) ON DELETE SET NULL;

      CREATE INDEX idx_entities_placeholders ON entities(is_placeholder, type_key);
      CREATE INDEX idx_entities_resolved ON entities(resolved_entity_id);
    `,
  },
  {
    version: 3,
    name: 'graph_integrity_guards',
    sql: `
      CREATE TRIGGER validate_attribute_term_reference_insert
      BEFORE INSERT ON attribute_values
      WHEN NEW.term_reference_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM vocabulary_terms WHERE id = NEW.term_reference_id)
      BEGIN
        SELECT RAISE(ABORT, 'unknown term_reference_id');
      END;

      CREATE TRIGGER validate_attribute_term_reference_update
      BEFORE UPDATE OF term_reference_id ON attribute_values
      WHEN NEW.term_reference_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM vocabulary_terms WHERE id = NEW.term_reference_id)
      BEGIN
        SELECT RAISE(ABORT, 'unknown term_reference_id');
      END;

      CREATE TRIGGER validate_source_values_insert
      BEFORE INSERT ON sources
      WHEN NEW.is_ai_inference NOT IN (0, 1)
        OR NEW.is_user_confirmed NOT IN (0, 1)
        OR (NEW.confidence IS NOT NULL AND (NEW.confidence < 0 OR NEW.confidence > 1))
      BEGIN
        SELECT RAISE(ABORT, 'invalid source values');
      END;

      CREATE TRIGGER validate_source_values_update
      BEFORE UPDATE ON sources
      WHEN NEW.is_ai_inference NOT IN (0, 1)
        OR NEW.is_user_confirmed NOT IN (0, 1)
        OR (NEW.confidence IS NOT NULL AND (NEW.confidence < 0 OR NEW.confidence > 1))
      BEGIN
        SELECT RAISE(ABORT, 'invalid source values');
      END;

      CREATE TRIGGER validate_alias_preferred_insert
      BEFORE INSERT ON aliases
      WHEN NEW.is_preferred NOT IN (0, 1)
      BEGIN
        SELECT RAISE(ABORT, 'invalid alias preference');
      END;

      CREATE TRIGGER validate_alias_preferred_update
      BEFORE UPDATE OF is_preferred ON aliases
      WHEN NEW.is_preferred NOT IN (0, 1)
      BEGIN
        SELECT RAISE(ABORT, 'invalid alias preference');
      END;

      CREATE TRIGGER validate_nonnegative_attribute_ordinal
      BEFORE INSERT ON attribute_values
      WHEN NEW.ordinal < 0
      BEGIN
        SELECT RAISE(ABORT, 'attribute ordinal must be nonnegative');
      END;

      CREATE TRIGGER validate_nonnegative_provenance_ordinal
      BEFORE INSERT ON record_provenance_links
      WHEN NEW.ordinal < 0
      BEGIN
        SELECT RAISE(ABORT, 'provenance ordinal must be nonnegative');
      END;
    `,
  },
  {
    version: 4,
    name: 'ordered_link_and_event_guards',
    sql: `
      CREATE TRIGGER validate_nonnegative_attribute_ordinal_update
      BEFORE UPDATE OF ordinal ON attribute_values
      WHEN NEW.ordinal < 0
      BEGIN
        SELECT RAISE(ABORT, 'attribute ordinal must be nonnegative');
      END;

      CREATE TRIGGER validate_nonnegative_provenance_ordinal_update
      BEFORE UPDATE OF ordinal ON record_provenance_links
      WHEN NEW.ordinal < 0
      BEGIN
        SELECT RAISE(ABORT, 'provenance ordinal must be nonnegative');
      END;

      CREATE TRIGGER validate_event_subject_ordinal_insert
      BEFORE INSERT ON event_subjects
      WHEN NEW.ordinal < 0
      BEGIN
        SELECT RAISE(ABORT, 'event subject ordinal must be nonnegative');
      END;

      CREATE TRIGGER validate_event_subject_ordinal_update
      BEFORE UPDATE OF ordinal ON event_subjects
      WHEN NEW.ordinal < 0
      BEGIN
        SELECT RAISE(ABORT, 'event subject ordinal must be nonnegative');
      END;

      CREATE TRIGGER validate_event_relationship_ordinal_insert
      BEFORE INSERT ON event_relationships
      WHEN NEW.ordinal < 0
      BEGIN
        SELECT RAISE(ABORT, 'event relationship ordinal must be nonnegative');
      END;

      CREATE TRIGGER validate_event_relationship_ordinal_update
      BEFORE UPDATE OF ordinal ON event_relationships
      WHEN NEW.ordinal < 0
      BEGIN
        SELECT RAISE(ABORT, 'event relationship ordinal must be nonnegative');
      END;

      CREATE TRIGGER validate_event_time_range_insert
      BEFORE INSERT ON events
      WHEN NEW.occurred_at IS NOT NULL AND NEW.ended_at IS NOT NULL
        AND NEW.ended_at < NEW.occurred_at
      BEGIN
        SELECT RAISE(ABORT, 'event end must not precede start');
      END;

      CREATE TRIGGER validate_event_time_range_update
      BEFORE UPDATE OF occurred_at, ended_at ON events
      WHEN NEW.occurred_at IS NOT NULL AND NEW.ended_at IS NOT NULL
        AND NEW.ended_at < NEW.occurred_at
      BEGIN
        SELECT RAISE(ABORT, 'event end must not precede start');
      END;
    `,
  },
  {
    version: 5,
    name: 'personal_memory_engine',
    sql: `
      CREATE TABLE memories (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        type_key TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL,
        verified_at TEXT,
        last_accessed_at TEXT,
        is_temporary INTEGER NOT NULL DEFAULT 0 CHECK (is_temporary IN (0, 1)),
        user_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (user_confirmed IN (0, 1)),
        valid_from TEXT,
        valid_to TEXT,
        temporal_mode TEXT NOT NULL DEFAULT 'UNKNOWN',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
      );

      CREATE TABLE memory_entities (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
        ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
        PRIMARY KEY (memory_id, entity_id)
      );

      CREATE TABLE memory_events (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
        ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
        PRIMARY KEY (memory_id, event_id)
      );

      CREATE TABLE memory_relationships (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        relationship_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE RESTRICT,
        ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
        PRIMARY KEY (memory_id, relationship_id)
      );

      CREATE TABLE memory_relations (
        id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
        from_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE RESTRICT,
        to_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE RESTRICT,
        type_key TEXT NOT NULL,
        conflict_status TEXT,
        resolved_at TEXT,
        note TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        CHECK (from_memory_id <> to_memory_id),
        UNIQUE (from_memory_id, to_memory_id, type_key)
      );

      CREATE INDEX idx_memories_type_status
        ON memories(type_key, status);
      CREATE INDEX idx_memories_validity
        ON memories(valid_from, valid_to);
      CREATE INDEX idx_memories_temporary
        ON memories(is_temporary, status);
      CREATE INDEX idx_memories_confirmed
        ON memories(user_confirmed, verified_at);
      CREATE INDEX idx_memory_entities_entity
        ON memory_entities(entity_id, ordinal, memory_id);
      CREATE INDEX idx_memory_events_event
        ON memory_events(event_id, ordinal, memory_id);
      CREATE INDEX idx_memory_relationships_relationship
        ON memory_relationships(relationship_id, ordinal, memory_id);
      CREATE INDEX idx_memory_relations_from
        ON memory_relations(from_memory_id, type_key);
      CREATE INDEX idx_memory_relations_to
        ON memory_relations(to_memory_id, type_key);
      CREATE INDEX idx_memory_relations_conflict
        ON memory_relations(conflict_status, type_key);
    `,
  },
  {
    version: 6,
    name: 'ai_proposal_review_queue',
    sql: `
      CREATE TABLE ai_extractions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
        input_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
        language TEXT NOT NULL,
        summary TEXT,
        extraction_json TEXT NOT NULL,
        provider_provenance_json TEXT NOT NULL,
        validation_warnings_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_ai_extractions_source
        ON ai_extractions(source_id, created_at DESC);
      CREATE INDEX idx_ai_extractions_input
        ON ai_extractions(input_entity_id, created_at DESC);
      CREATE INDEX idx_ai_extractions_request
        ON ai_extractions(request_id);

      CREATE TABLE ai_action_proposals (
        id TEXT PRIMARY KEY,
        extraction_id TEXT NOT NULL REFERENCES ai_extractions(id) ON DELETE CASCADE,
        proposal_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('create', 'refine', 'link')),
        target_kind TEXT NOT NULL,
        type_key TEXT NOT NULL,
        proposal_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING', 'CONFIRMED', 'CORRECTED', 'REJECTED')),
        resolved_record_id TEXT REFERENCES records(id) ON DELETE SET NULL,
        corrected_proposal_json TEXT,
        decision_note TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (extraction_id, proposal_id)
      );

      CREATE INDEX idx_ai_action_proposals_pending
        ON ai_action_proposals(status, created_at DESC);
      CREATE INDEX idx_ai_action_proposals_extraction
        ON ai_action_proposals(extraction_id, created_at);
    `,
  },
];

export const DATABASE_MIGRATIONS: ReadonlyArray<Readonly<Migration>> = migrations;
export const LATEST_DATABASE_VERSION = migrations[migrations.length - 1]?.version ?? 0;

function validateMigrationDefinitions(): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion || !migration.name.trim()) {
      throw new Error(`Ungültige Migrationsdefinition für Version ${expectedVersion}.`);
    }
  });
}

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  validateMigrationDefinitions();
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('PRAGMA busy_timeout = 5000;');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const auditRows = await db.getAllAsync<{ version: number; name: string }>(
    'SELECT version, name FROM schema_migrations ORDER BY version',
  );
  if (!result) {
    throw new Error('Die lokale Datenbankversion konnte nicht gelesen werden.');
  }
  if (result.user_version > LATEST_DATABASE_VERSION) {
    throw new Error('Die lokale Datenbank ist neuer als diese App-Version.');
  }
  if (auditRows.length !== result.user_version) {
    throw new Error('Die SQLite-Migrationshistorie ist unvollständig oder inkonsistent.');
  }
  for (const [index, row] of auditRows.entries()) {
    const expected = migrations[index];
    if (!expected || row.version !== expected.version || row.name !== expected.name) {
      throw new Error(`Die SQLite-Migration ${row.version} stimmt nicht mit der App überein.`);
    }
  }

  let currentVersion = result.user_version;
  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      await db.execAsync(`PRAGMA user_version = ${migration.version};`);
    });
    currentVersion = migration.version;
  }

  const foreignKeyViolations = await db.getAllAsync<Record<string, unknown>>(
    'PRAGMA foreign_key_check',
  );
  if (foreignKeyViolations.length > 0) {
    throw new Error('Die lokale Datenbank enthält ungültige Fremdschlüsselbeziehungen.');
  }
}
