import type { SQLiteDatabase } from 'expo-sqlite';

import {
  DEFAULT_MEMORY_CONFLICT_STATUS,
  DEFAULT_MEMORY_RELATION_TYPE,
  DEFAULT_MEMORY_STATUS,
  DEFAULT_MEMORY_TEMPORAL_MODE,
  DEFAULT_MEMORY_TYPE,
  DEFAULT_PRIVACY_CLASSIFICATION,
} from '@/domain';
import type {
  EntityMemorySnapshot,
  EntityRecord,
  EventRecord,
  JsonObject,
  MemoryInput,
  MemoryQuery,
  MemoryRecord,
  MemoryRelationRecord,
  MemoryRepository,
  MemoryRevisionInput,
  MemoryStatus,
  MemoryUpdateInput,
  PersonalAlias,
  PrivacyClassification,
  RecordProvenanceLink,
  RelationshipRecord,
  SourceRecord,
  StableId,
} from '@/domain';
import {
  assertConfidence,
  assertJsonObject,
  assertNonEmpty,
  assertTemporalRange,
  createPrivacyDescriptor,
  createStableId,
  createSyncMetadata,
  normalizeAlias,
  normalizeMemoryConflictStatus,
  normalizeMemoryRelationType,
  normalizeMemoryStatus,
  normalizeMemoryTemporalMode,
  normalizeMemoryType,
  normalizeOpenType,
  nowIso,
} from '@/domain';

interface BaseRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  local_revision: number;
  remote_revision: string | null;
  sync_state: 'local_only' | 'pending' | 'synced' | 'conflict' | 'error';
  device_id: string | null;
  last_synced_at: string | null;
  conflict_json: string | null;
  classification: PrivacyClassification;
  reason: string | null;
  classified_at: string;
  classified_by: string | null;
  handling_rules_json: string;
}

interface MemoryRow extends BaseRow {
  content: string;
  type_key: string;
  status: string;
  confidence: number | null;
  verified_at: string | null;
  last_accessed_at: string | null;
  is_temporary: number;
  user_confirmed: number;
  valid_from: string | null;
  valid_to: string | null;
  temporal_mode: string;
  metadata_json: string;
}

interface MemoryRelationRow extends BaseRow {
  from_memory_id: string;
  to_memory_id: string;
  type_key: string;
  conflict_status: string | null;
  resolved_at: string | null;
  note: string | null;
  metadata_json: string;
}

interface MemoryRepositoryDependencies {
  getEntity(id: StableId): Promise<EntityRecord | null>;
  findEvents(entityId: StableId): Promise<EventRecord[]>;
  findRelationships(entityId: StableId): Promise<RelationshipRecord[]>;
  findAliases(entityId: StableId): Promise<PersonalAlias[]>;
  findSources(recordId: StableId): Promise<SourceRecord[]>;
  findProvenance(recordId: StableId): Promise<RecordProvenanceLink[]>;
}

interface NormalizedMemoryValues {
  content: string;
  type: MemoryRecord['type'];
  status: MemoryRecord['status'];
  confidence?: number;
  verifiedAt?: string;
  lastAccessedAt?: string;
  isTemporary: boolean;
  userConfirmed: boolean;
  validFrom?: string;
  validTo?: string;
  temporalMode: MemoryRecord['temporalMode'];
  metadata: JsonObject;
}

const BASE_SELECT = `
  r.id, r.created_at, r.updated_at, r.deleted_at,
  r.local_revision, r.remote_revision, r.sync_state, r.device_id,
  r.last_synced_at, r.conflict_json,
  p.classification, p.reason, p.classified_at, p.classified_by,
  p.handling_rules_json
`;

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error('Beschädigte JSON-Daten in der lokalen Datenbank.');
  }
}

function mapBase(row: BaseRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    privacy: {
      classification: row.classification,
      reason: row.reason ?? undefined,
      classifiedAt: row.classified_at,
      classifiedBy: row.classified_by ?? undefined,
      handlingRules: parseJson<string[]>(row.handling_rules_json, []),
    },
    sync: {
      deviceId: row.device_id ?? undefined,
      localRevision: row.local_revision,
      remoteRevision: row.remote_revision ?? undefined,
      syncState: row.sync_state,
      lastSyncedAt: row.last_synced_at,
      conflictData: parseJson<JsonObject | null>(row.conflict_json, null),
    },
    provenanceIds: [] as StableId[],
  };
}

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    ...mapBase(row),
    content: row.content,
    type: row.type_key,
    status: row.status,
    confidence: row.confidence ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    isTemporary: row.is_temporary === 1,
    userConfirmed: row.user_confirmed === 1,
    validFrom: row.valid_from ?? undefined,
    validTo: row.valid_to ?? undefined,
    temporalMode: row.temporal_mode,
    entityIds: [],
    eventIds: [],
    relationshipIds: [],
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
  };
}

function mapMemoryRelation(row: MemoryRelationRow): MemoryRelationRecord {
  return {
    ...mapBase(row),
    fromMemoryId: row.from_memory_id,
    toMemoryId: row.to_memory_id,
    type: row.type_key,
    conflictStatus: row.conflict_status ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    note: row.note ?? undefined,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
  };
}

function uniqueIds(ids: StableId[] = []): StableId[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
}

function deriveTemporalMode(
  explicit: MemoryInput['temporalMode'] | MemoryUpdateInput['temporalMode'],
  validFrom?: string,
  validTo?: string,
): MemoryRecord['temporalMode'] {
  if (explicit) {
    return normalizeMemoryTemporalMode(explicit);
  }
  if (validFrom && validTo) {
    return 'RANGE';
  }
  if (validFrom) {
    return 'FROM';
  }
  if (validTo) {
    return 'UNTIL';
  }
  return DEFAULT_MEMORY_TEMPORAL_MODE;
}

function normalizeCreatedMemory(input: MemoryInput, timestamp: string): NormalizedMemoryValues {
  const content = assertNonEmpty(input.content, 'Memory-Inhalt');
  const type = normalizeMemoryType(input.type ?? DEFAULT_MEMORY_TYPE);
  let status = normalizeMemoryStatus(input.status ?? DEFAULT_MEMORY_STATUS);
  let isTemporary = input.isTemporary ?? status === 'TEMPORARY';
  let userConfirmed = input.userConfirmed ?? status === 'CONFIRMED';
  let verifiedAt = input.verifiedAt;

  if (status === 'TEMPORARY' || isTemporary) {
    status = 'TEMPORARY';
    isTemporary = true;
    userConfirmed = false;
    verifiedAt = undefined;
  } else if (status === 'CONFIRMED' || userConfirmed || verifiedAt) {
    status = 'CONFIRMED';
    userConfirmed = true;
    verifiedAt = verifiedAt ?? timestamp;
  } else if (status === 'INFERRED' || status === 'UNCERTAIN') {
    userConfirmed = false;
    verifiedAt = undefined;
  }

  assertTemporalRange(input.validFrom, input.validTo);
  return {
    content,
    type,
    status,
    confidence: assertConfidence(input.confidence),
    verifiedAt,
    lastAccessedAt: input.lastAccessedAt,
    isTemporary,
    userConfirmed,
    validFrom: input.validFrom,
    validTo: input.validTo,
    temporalMode: deriveTemporalMode(input.temporalMode, input.validFrom, input.validTo),
    metadata: assertJsonObject(input.metadata ?? {}),
  };
}

async function insertBaseRecord(
  db: SQLiteDatabase,
  id: string,
  kind: string,
  timestamp: string,
  classification: PrivacyClassification,
): Promise<void> {
  const sync = createSyncMetadata();
  const privacy = createPrivacyDescriptor(classification, timestamp);
  await db.runAsync(
    `INSERT INTO records
      (id, record_kind, created_at, updated_at, local_revision, sync_state)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    kind,
    timestamp,
    timestamp,
    sync.localRevision,
    sync.syncState,
  );
  await db.runAsync(
    `INSERT INTO record_privacy
      (record_id, classification, classified_at, handling_rules_json)
     VALUES (?, ?, ?, '[]')`,
    id,
    privacy.classification,
    privacy.classifiedAt,
  );
}

async function insertProvenanceLinks(
  db: SQLiteDatabase,
  recordId: StableId,
  sourceIds: StableId[],
): Promise<void> {
  const timestamp = nowIso();
  for (const [ordinal, sourceId] of uniqueIds(sourceIds).entries()) {
    await db.runAsync(
      `INSERT OR IGNORE INTO record_provenance_links
        (record_id, source_id, role, ordinal, created_at)
       VALUES (?, ?, 'evidence', ?, ?)`,
      recordId,
      sourceId,
      ordinal,
      timestamp,
    );
  }
}

async function insertOrderedLinks(
  db: SQLiteDatabase,
  table: 'memory_entities' | 'memory_events' | 'memory_relationships',
  foreignColumn: 'entity_id' | 'event_id' | 'relationship_id',
  memoryId: StableId,
  ids: StableId[],
): Promise<void> {
  for (const [ordinal, id] of uniqueIds(ids).entries()) {
    await db.runAsync(
      `INSERT INTO ${table} (memory_id, ${foreignColumn}, ordinal) VALUES (?, ?, ?)`,
      memoryId,
      id,
      ordinal,
    );
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function dedupeById<T extends { id: StableId }>(records: T[]): T[] {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

class SQLiteMemoryRepository implements MemoryRepository {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly dependencies: MemoryRepositoryDependencies,
  ) {}

  private async getProvenanceIds(recordId: StableId): Promise<StableId[]> {
    const rows = await this.db.getAllAsync<{ source_id: string }>(
      `SELECT DISTINCT source_id FROM record_provenance_links
       WHERE record_id = ? ORDER BY ordinal, created_at`,
      recordId,
    );
    return rows.map((row) => row.source_id);
  }

  private async getLinkedIds(
    table: 'memory_entities' | 'memory_events' | 'memory_relationships',
    column: 'entity_id' | 'event_id' | 'relationship_id',
    memoryId: StableId,
  ): Promise<StableId[]> {
    const rows = await this.db.getAllAsync<Record<string, string>>(
      `SELECT ${column} FROM ${table} WHERE memory_id = ? ORDER BY ordinal, ${column}`,
      memoryId,
    );
    return rows.map((row) => row[column] ?? '').filter(Boolean);
  }

  private async hydrateMemory(memory: MemoryRecord): Promise<MemoryRecord> {
    const [provenanceIds, entityIds, eventIds, relationshipIds] = await Promise.all([
      this.getProvenanceIds(memory.id),
      this.getLinkedIds('memory_entities', 'entity_id', memory.id),
      this.getLinkedIds('memory_events', 'event_id', memory.id),
      this.getLinkedIds('memory_relationships', 'relationship_id', memory.id),
    ]);
    memory.provenanceIds = provenanceIds;
    memory.entityIds = entityIds;
    memory.eventIds = eventIds;
    memory.relationshipIds = relationshipIds;
    return memory;
  }

  private async hydrateRelation(relation: MemoryRelationRecord): Promise<MemoryRelationRecord> {
    relation.provenanceIds = await this.getProvenanceIds(relation.id);
    return relation;
  }

  private async touchRecord(recordId: StableId, timestamp: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE records
       SET updated_at = ?, local_revision = local_revision + 1, sync_state = 'pending'
       WHERE id = ? AND deleted_at IS NULL`,
      timestamp,
      recordId,
    );
  }

  private async assertActiveRecord(id: StableId, kind: string): Promise<void> {
    const row = await this.db.getFirstAsync<{ id: string }>(
      `SELECT id FROM records WHERE id = ? AND record_kind = ? AND deleted_at IS NULL`,
      id,
      kind,
    );
    if (!row) {
      throw new Error(`Datensatz „${id}“ vom Typ „${kind}“ wurde nicht gefunden.`);
    }
  }

  private async insertMemory(
    input: MemoryInput,
    classification: PrivacyClassification,
    timestamp: string,
  ): Promise<StableId> {
    const id = input.id ?? createStableId('memory');
    const values = normalizeCreatedMemory(input, timestamp);
    await insertBaseRecord(this.db, id, 'memory', timestamp, classification);
    await this.db.runAsync(
      `INSERT INTO memories
        (id, content, type_key, status, confidence, verified_at, last_accessed_at,
         is_temporary, user_confirmed, valid_from, valid_to, temporal_mode, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      values.content,
      values.type,
      values.status,
      values.confidence ?? null,
      values.verifiedAt ?? null,
      values.lastAccessedAt ?? null,
      values.isTemporary ? 1 : 0,
      values.userConfirmed ? 1 : 0,
      values.validFrom ?? null,
      values.validTo ?? null,
      values.temporalMode,
      JSON.stringify(values.metadata),
    );
    await insertOrderedLinks(this.db, 'memory_entities', 'entity_id', id, input.entityIds ?? []);
    await insertOrderedLinks(this.db, 'memory_events', 'event_id', id, input.eventIds ?? []);
    await insertOrderedLinks(
      this.db,
      'memory_relationships',
      'relationship_id',
      id,
      input.relationshipIds ?? [],
    );
    await insertProvenanceLinks(this.db, id, input.provenanceIds ?? []);
    return id;
  }

  async createMemory(input: MemoryInput): Promise<MemoryRecord> {
    const timestamp = nowIso();
    const classification = input.privacyClassification ?? DEFAULT_PRIVACY_CLASSIFICATION;
    let id = '';
    await this.db.withTransactionAsync(async () => {
      id = await this.insertMemory(input, classification, timestamp);
    });
    const memory = await this.getMemory(id);
    if (!memory) {
      throw new Error('Die Erinnerung konnte nach dem Speichern nicht geladen werden.');
    }
    return memory;
  }

  async getMemory(id: StableId): Promise<MemoryRecord | null> {
    const row = await this.db.getFirstAsync<MemoryRow>(
      `SELECT ${BASE_SELECT},
        m.content, m.type_key, m.status, m.confidence, m.verified_at,
        m.last_accessed_at, m.is_temporary, m.user_confirmed,
        m.valid_from, m.valid_to, m.temporal_mode, m.metadata_json
       FROM memories m
       JOIN records r ON r.id = m.id
       JOIN record_privacy p ON p.record_id = r.id
       WHERE m.id = ? AND r.deleted_at IS NULL`,
      id,
    );
    return row ? this.hydrateMemory(mapMemory(row)) : null;
  }

  async updateMemory(id: StableId, input: MemoryUpdateInput): Promise<MemoryRecord> {
    const current = await this.getMemory(id);
    if (!current) {
      throw new Error('Die Erinnerung wurde nicht gefunden.');
    }
    if (Object.keys(input).length === 0) {
      return current;
    }

    const timestamp = nowIso();
    const content = input.content === undefined
      ? current.content
      : assertNonEmpty(input.content, 'Memory-Inhalt');
    const type = input.type === undefined ? current.type : normalizeMemoryType(input.type);
    let status = input.status === undefined ? current.status : normalizeMemoryStatus(input.status);
    let confidence = input.confidence === undefined
      ? current.confidence
      : input.confidence === null
        ? undefined
        : assertConfidence(input.confidence);
    let verifiedAt = input.verifiedAt === undefined
      ? current.verifiedAt
      : input.verifiedAt ?? undefined;
    const lastAccessedAt = input.lastAccessedAt === undefined
      ? current.lastAccessedAt
      : input.lastAccessedAt ?? undefined;
    let isTemporary = input.isTemporary ?? current.isTemporary;
    let userConfirmed = input.userConfirmed ?? current.userConfirmed;
    const validFrom = input.validFrom === undefined ? current.validFrom : input.validFrom ?? undefined;
    const validTo = input.validTo === undefined ? current.validTo : input.validTo ?? undefined;

    if (input.isTemporary === false && status === 'TEMPORARY') {
      status = DEFAULT_MEMORY_STATUS;
    }
    if (status === 'TEMPORARY' || input.isTemporary === true) {
      status = 'TEMPORARY';
      isTemporary = true;
      userConfirmed = false;
      verifiedAt = undefined;
    } else if (status === 'CONFIRMED' || input.userConfirmed === true || input.verifiedAt) {
      status = 'CONFIRMED';
      isTemporary = false;
      userConfirmed = true;
      verifiedAt = verifiedAt ?? timestamp;
    } else if (
      status === 'INFERRED' ||
      status === 'UNCERTAIN' ||
      status === 'UNCONFIRMED' ||
      input.userConfirmed === false
    ) {
      userConfirmed = false;
      verifiedAt = undefined;
    }

    assertTemporalRange(validFrom, validTo);
    const temporalMode = deriveTemporalMode(input.temporalMode, validFrom, validTo);
    const metadata = input.metadata === undefined
      ? current.metadata
      : assertJsonObject(input.metadata);

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE memories SET
          content = ?, type_key = ?, status = ?, confidence = ?, verified_at = ?,
          last_accessed_at = ?, is_temporary = ?, user_confirmed = ?, valid_from = ?,
          valid_to = ?, temporal_mode = ?, metadata_json = ?
         WHERE id = ?`,
        content,
        type,
        status,
        confidence ?? null,
        verifiedAt ?? null,
        lastAccessedAt ?? null,
        isTemporary ? 1 : 0,
        userConfirmed ? 1 : 0,
        validFrom ?? null,
        validTo ?? null,
        temporalMode,
        JSON.stringify(metadata),
        id,
      );
      await this.touchRecord(id, timestamp);
    });

    const updated = await this.getMemory(id);
    if (!updated) {
      throw new Error('Die Erinnerung konnte nach der Aktualisierung nicht geladen werden.');
    }
    return updated;
  }

  confirmMemory(id: StableId, verifiedAt = nowIso()): Promise<MemoryRecord> {
    return this.updateMemory(id, {
      status: 'CONFIRMED',
      userConfirmed: true,
      verifiedAt,
      isTemporary: false,
    });
  }

  markAsUncertain(id: StableId): Promise<MemoryRecord> {
    return this.updateMemory(id, {
      status: 'UNCERTAIN',
      userConfirmed: false,
      verifiedAt: null,
    });
  }

  markAsInferred(id: StableId): Promise<MemoryRecord> {
    return this.updateMemory(id, {
      status: 'INFERRED',
      userConfirmed: false,
      verifiedAt: null,
    });
  }

  markAsTemporary(id: StableId): Promise<MemoryRecord> {
    return this.updateMemory(id, {
      status: 'TEMPORARY',
      isTemporary: true,
      userConfirmed: false,
      verifiedAt: null,
    });
  }

  async makePersistent(id: StableId): Promise<MemoryRecord> {
    const memory = await this.getMemory(id);
    if (!memory) {
      throw new Error('Die Erinnerung wurde nicht gefunden.');
    }
    return this.updateMemory(id, {
      isTemporary: false,
      status: memory.status === 'TEMPORARY' ? 'UNCONFIRMED' : memory.status,
    });
  }

  async attachSource(
    memoryId: StableId,
    sourceId: StableId,
    role = 'evidence',
  ): Promise<MemoryRecord> {
    const timestamp = nowIso();
    await this.db.withTransactionAsync(async () => {
      await this.assertActiveRecord(memoryId, 'memory');
      await this.assertActiveRecord(sourceId, 'source');
      const ordinalRow = await this.db.getFirstAsync<{ next_ordinal: number }>(
        `SELECT COALESCE(MAX(ordinal), -1) + 1 AS next_ordinal
         FROM record_provenance_links WHERE record_id = ?`,
        memoryId,
      );
      const result = await this.db.runAsync(
        `INSERT INTO record_provenance_links
          (record_id, source_id, role, ordinal, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(record_id, source_id, role) DO NOTHING`,
        memoryId,
        sourceId,
        normalizeOpenType(role, 'evidence'),
        ordinalRow?.next_ordinal ?? 0,
        timestamp,
      );
      if (result.changes === 1) {
        await this.touchRecord(memoryId, timestamp);
      }
    });
    return this.requireMemory(memoryId);
  }

  private async attachRecord(
    memoryId: StableId,
    linkedId: StableId,
    kind: 'entity' | 'event' | 'relationship',
  ): Promise<MemoryRecord> {
    const config = {
      entity: { table: 'memory_entities', column: 'entity_id' },
      event: { table: 'memory_events', column: 'event_id' },
      relationship: { table: 'memory_relationships', column: 'relationship_id' },
    } as const;
    const { table, column } = config[kind];
    const timestamp = nowIso();
    await this.db.withTransactionAsync(async () => {
      await this.assertActiveRecord(memoryId, 'memory');
      await this.assertActiveRecord(linkedId, kind);
      const ordinalRow = await this.db.getFirstAsync<{ next_ordinal: number }>(
        `SELECT COALESCE(MAX(ordinal), -1) + 1 AS next_ordinal FROM ${table} WHERE memory_id = ?`,
        memoryId,
      );
      const result = await this.db.runAsync(
        `INSERT OR IGNORE INTO ${table} (memory_id, ${column}, ordinal) VALUES (?, ?, ?)`,
        memoryId,
        linkedId,
        ordinalRow?.next_ordinal ?? 0,
      );
      if (result.changes === 1) {
        await this.touchRecord(memoryId, timestamp);
      }
    });
    return this.requireMemory(memoryId);
  }

  attachEntity(memoryId: StableId, entityId: StableId): Promise<MemoryRecord> {
    return this.attachRecord(memoryId, entityId, 'entity');
  }

  attachEvent(memoryId: StableId, eventId: StableId): Promise<MemoryRecord> {
    return this.attachRecord(memoryId, eventId, 'event');
  }

  attachRelationship(memoryId: StableId, relationshipId: StableId): Promise<MemoryRecord> {
    return this.attachRecord(memoryId, relationshipId, 'relationship');
  }

  async detachEntity(memoryId: StableId, entityId: StableId): Promise<MemoryRecord> {
    const timestamp = nowIso();
    await this.db.withTransactionAsync(async () => {
      await this.assertActiveRecord(memoryId, 'memory');
      const result = await this.db.runAsync(
        'DELETE FROM memory_entities WHERE memory_id = ? AND entity_id = ?',
        memoryId,
        entityId,
      );
      if (result.changes === 1) {
        const rows = await this.db.getAllAsync<{ entity_id: string }>(
          'SELECT entity_id FROM memory_entities WHERE memory_id = ? ORDER BY ordinal, entity_id',
          memoryId,
        );
        for (const [ordinal, row] of rows.entries()) {
          await this.db.runAsync(
            'UPDATE memory_entities SET ordinal = ? WHERE memory_id = ? AND entity_id = ?',
            ordinal,
            memoryId,
            row.entity_id,
          );
        }
        await this.touchRecord(memoryId, timestamp);
      }
    });
    return this.requireMemory(memoryId);
  }

  async moveEntityAttachment(
    memoryId: StableId,
    fromEntityId: StableId,
    toEntityId: StableId,
  ): Promise<MemoryRecord> {
    if (fromEntityId === toEntityId) {
      return this.requireMemory(memoryId);
    }
    const timestamp = nowIso();
    await this.db.withTransactionAsync(async () => {
      await this.assertActiveRecord(memoryId, 'memory');
      await this.assertActiveRecord(fromEntityId, 'entity');
      await this.assertActiveRecord(toEntityId, 'entity');
      const existing = await this.db.getFirstAsync<{ ordinal: number }>(
        'SELECT ordinal FROM memory_entities WHERE memory_id = ? AND entity_id = ?',
        memoryId,
        fromEntityId,
      );
      if (!existing) {
        throw new Error('Die ursprüngliche Entity ist nicht mit der Erinnerung verknüpft.');
      }
      await this.db.runAsync(
        `INSERT INTO memory_entities (memory_id, entity_id, ordinal)
         VALUES (?, ?, ?)
         ON CONFLICT(memory_id, entity_id) DO NOTHING`,
        memoryId,
        toEntityId,
        existing.ordinal,
      );
      await this.db.runAsync(
        'DELETE FROM memory_entities WHERE memory_id = ? AND entity_id = ?',
        memoryId,
        fromEntityId,
      );
      const rows = await this.db.getAllAsync<{ entity_id: string }>(
        'SELECT entity_id FROM memory_entities WHERE memory_id = ? ORDER BY ordinal, entity_id',
        memoryId,
      );
      for (const [ordinal, row] of rows.entries()) {
        await this.db.runAsync(
          'UPDATE memory_entities SET ordinal = ? WHERE memory_id = ? AND entity_id = ?',
          ordinal,
          memoryId,
          row.entity_id,
        );
      }
      await this.touchRecord(memoryId, timestamp);
    });
    return this.requireMemory(memoryId);
  }

  async createRevision(
    previousMemoryId: StableId,
    input: MemoryRevisionInput,
  ): Promise<MemoryRecord> {
    const previous = await this.getMemory(previousMemoryId);
    if (!previous) {
      throw new Error('Die ursprüngliche Erinnerung wurde nicht gefunden.');
    }
    const timestamp = nowIso();
    const relationType = normalizeMemoryRelationType(
      input.relationType ?? DEFAULT_MEMORY_RELATION_TYPE,
    );
    const relationId = createStableId('memory_relation');
    const relationMetadata = assertJsonObject(input.relationMetadata ?? {});
    const conflictStatus = input.conflictStatus
      ? normalizeMemoryConflictStatus(input.conflictStatus)
      : relationType === 'CONTRADICTS'
        ? DEFAULT_MEMORY_CONFLICT_STATUS
        : undefined;
    const inheritedInput: MemoryInput = {
      ...input,
      entityIds: input.entityIds ?? previous.entityIds,
      eventIds: input.eventIds ?? previous.eventIds,
      relationshipIds: input.relationshipIds ?? previous.relationshipIds,
      provenanceIds: input.provenanceIds ?? previous.provenanceIds,
      privacyClassification: input.privacyClassification ?? previous.privacy.classification,
    };
    let newMemoryId = '';

    await this.db.withTransactionAsync(async () => {
      newMemoryId = await this.insertMemory(
        inheritedInput,
        inheritedInput.privacyClassification ?? previous.privacy.classification,
        timestamp,
      );
      await insertBaseRecord(
        this.db,
        relationId,
        'memory_relation',
        timestamp,
        previous.privacy.classification,
      );
      await this.db.runAsync(
        `INSERT INTO memory_relations
          (id, from_memory_id, to_memory_id, type_key, conflict_status, note, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        relationId,
        newMemoryId,
        previousMemoryId,
        relationType,
        conflictStatus ?? null,
        input.relationNote?.trim() || null,
        JSON.stringify(relationMetadata),
      );
      await insertProvenanceLinks(this.db, relationId, inheritedInput.provenanceIds ?? []);
    });

    return this.requireMemory(newMemoryId);
  }

  async listRelations(memoryId: StableId): Promise<MemoryRelationRecord[]> {
    const rows = await this.db.getAllAsync<MemoryRelationRow>(
      `SELECT ${BASE_SELECT}, mr.from_memory_id, mr.to_memory_id, mr.type_key,
        mr.conflict_status, mr.resolved_at, mr.note, mr.metadata_json
       FROM memory_relations mr
       JOIN records r ON r.id = mr.id
       JOIN record_privacy p ON p.record_id = r.id
       WHERE (mr.from_memory_id = ? OR mr.to_memory_id = ?)
         AND r.deleted_at IS NULL
       ORDER BY r.created_at, r.id`,
      memoryId,
      memoryId,
    );
    return Promise.all(rows.map((row) => this.hydrateRelation(mapMemoryRelation(row))));
  }

  listMemoriesForEntity(entityId: StableId): Promise<MemoryRecord[]> {
    return this.searchMemories({ entityId, includeTemporary: true, limit: 500 });
  }

  listMemoriesByStatus(status: string): Promise<MemoryRecord[]> {
    return this.searchMemories({
      statuses: [normalizeMemoryStatus(status)],
      includeTemporary: true,
      limit: 500,
    });
  }

  listMemoriesByType(type: string): Promise<MemoryRecord[]> {
    return this.searchMemories({
      types: [normalizeMemoryType(type)],
      includeTemporary: true,
      limit: 500,
    });
  }

  async searchMemories(query: MemoryQuery = {}): Promise<MemoryRecord[]> {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (!query.includeDeleted) {
      where.push('r.deleted_at IS NULL');
    }
    if (query.includeTemporary === false) {
      where.push('m.is_temporary = 0');
    }
    if (query.entityId) {
      where.push('EXISTS (SELECT 1 FROM memory_entities me WHERE me.memory_id = m.id AND me.entity_id = ?)');
      params.push(query.entityId);
    }
    if (query.eventId) {
      where.push('EXISTS (SELECT 1 FROM memory_events mev WHERE mev.memory_id = m.id AND mev.event_id = ?)');
      params.push(query.eventId);
    }
    if (query.relationshipId) {
      where.push('EXISTS (SELECT 1 FROM memory_relationships mrr WHERE mrr.memory_id = m.id AND mrr.relationship_id = ?)');
      params.push(query.relationshipId);
    }
    if (query.statuses) {
      if (query.statuses.length === 0) {
        return [];
      }
      const values = query.statuses.map((status) => normalizeMemoryStatus(status));
      where.push(`m.status IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    }
    if (query.types) {
      if (query.types.length === 0) {
        return [];
      }
      const values = query.types.map((type) => normalizeMemoryType(type));
      where.push(`m.type_key IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    }
    if (query.validAt) {
      where.push('(m.valid_from IS NULL OR m.valid_from <= ?)');
      where.push('(m.valid_to IS NULL OR m.valid_to >= ?)');
      params.push(query.validAt, query.validAt);
    }
    if (query.search?.trim()) {
      const text = query.search.trim();
      const like = `%${escapeLike(text)}%`;
      const normalizedLike = `%${escapeLike(normalizeAlias(text))}%`;
      where.push(`(
        m.content LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR m.type_key LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR m.status LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR EXISTS (
          SELECT 1 FROM memory_entities me
          JOIN entities e ON e.id = me.entity_id
          JOIN records er ON er.id = e.id AND er.deleted_at IS NULL
          LEFT JOIN aliases a ON a.entity_id = e.id
          LEFT JOIN records ar ON ar.id = a.id AND ar.deleted_at IS NULL
          WHERE me.memory_id = m.id AND (
            e.title LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR COALESCE(e.description, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR e.type_key LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR COALESCE(e.status, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR (ar.id IS NOT NULL AND a.normalized_value LIKE ? ESCAPE '\\' COLLATE NOCASE)
          )
        )
        OR EXISTS (
          SELECT 1 FROM memory_events mev
          JOIN events ev ON ev.id = mev.event_id
          JOIN records evr ON evr.id = ev.id AND evr.deleted_at IS NULL
          WHERE mev.memory_id = m.id AND (
            ev.title LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR COALESCE(ev.description, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR ev.type_key LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR COALESCE(ev.status, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
          )
        )
      )`);
      params.push(
        like,
        like,
        like,
        like,
        like,
        like,
        like,
        normalizedLike,
        like,
        like,
        like,
        like,
      );
    }
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
    params.push(limit);
    const rows = await this.db.getAllAsync<MemoryRow>(
      `SELECT ${BASE_SELECT},
        m.content, m.type_key, m.status, m.confidence, m.verified_at,
        m.last_accessed_at, m.is_temporary, m.user_confirmed,
        m.valid_from, m.valid_to, m.temporal_mode, m.metadata_json
       FROM memories m
       JOIN records r ON r.id = m.id
       JOIN record_privacy p ON p.record_id = r.id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY
         CASE WHEN m.status = 'CONFIRMED' OR m.user_confirmed = 1 THEN 0 ELSE 1 END,
         m.is_temporary,
         m.verified_at DESC,
         r.updated_at DESC,
         r.id
       LIMIT ?`,
      ...params,
    );
    return Promise.all(rows.map((row) => this.hydrateMemory(mapMemory(row))));
  }

  async buildEntitySnapshot(entityId: StableId): Promise<EntityMemorySnapshot | null> {
    const entity = await this.dependencies.getEntity(entityId);
    if (!entity) {
      return null;
    }
    const generatedAt = nowIso();
    let snapshot: EntityMemorySnapshot | null = null;
    await this.db.withTransactionAsync(async () => {
      const [memories, events, relationships, aliases, entitySources, entityProvenance] =
        await Promise.all([
          this.listMemoriesForEntity(entityId),
          this.dependencies.findEvents(entityId),
          this.dependencies.findRelationships(entityId),
          this.dependencies.findAliases(entityId),
          this.dependencies.findSources(entityId),
          this.dependencies.findProvenance(entityId),
        ]);
      const relationGroups = await Promise.all(memories.map((memory) => this.listRelations(memory.id)));
      const sourceGroups = await Promise.all(memories.map((memory) => this.dependencies.findSources(memory.id)));
      const provenanceGroups = await Promise.all(
        memories.map((memory) => this.dependencies.findProvenance(memory.id)),
      );
      const confirmedMemories = memories.filter(
        (memory) => memory.status === 'CONFIRMED' || memory.userConfirmed,
      );
      const inferredMemories = memories.filter((memory) => memory.status === 'INFERRED');
      const uncertainMemories = memories.filter((memory) => memory.status === 'UNCERTAIN');
      const temporaryMemories = memories.filter(
        (memory) => memory.isTemporary || memory.status === 'TEMPORARY',
      );
      const categorized = new Set([
        ...confirmedMemories,
        ...inferredMemories,
        ...uncertainMemories,
        ...temporaryMemories,
      ].map((memory) => memory.id));
      const unconfirmedMemories = memories.filter((memory) => !categorized.has(memory.id));
      const currentMemories = memories.filter(
        (memory) =>
          !memory.isTemporary &&
          memory.status !== 'TEMPORARY' &&
          (!memory.validFrom || memory.validFrom <= generatedAt) &&
          (!memory.validTo || memory.validTo >= generatedAt),
      );
      snapshot = {
        entity,
        confirmedMemories,
        currentMemories,
        unconfirmedMemories,
        inferredMemories,
        uncertainMemories,
        temporaryMemories,
        events,
        relationships,
        aliases,
        sources: dedupeById([...entitySources, ...sourceGroups.flat()]),
        memoryRelations: dedupeById(relationGroups.flat()),
        provenance: [entityProvenance, ...provenanceGroups].flat(),
        generatedAt,
      };
    });
    return snapshot;
  }

  private async requireMemory(id: StableId): Promise<MemoryRecord> {
    const memory = await this.getMemory(id);
    if (!memory) {
      throw new Error('Die Erinnerung wurde nicht gefunden.');
    }
    return memory;
  }
}

export function createMemoryRepository(
  db: SQLiteDatabase,
  dependencies: MemoryRepositoryDependencies,
): MemoryRepository {
  return new SQLiteMemoryRepository(db, dependencies);
}
