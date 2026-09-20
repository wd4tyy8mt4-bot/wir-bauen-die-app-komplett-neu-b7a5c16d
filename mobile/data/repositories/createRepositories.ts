import type { SQLiteDatabase } from 'expo-sqlite';

import {
  CORE_EXPORT_SCHEMA_VERSION,
  UNKNOWN_ENTITY_TYPE,
  UNKNOWN_EVENT_TYPE,
  UNKNOWN_RELATIONSHIP_TYPE,
  UNKNOWN_SOURCE_TYPE,
} from '@/domain';
import type {
  AliasInput,
  AttributeInput,
  AttributeValueRecord,
  CoreExportBundle,
  EntityDetails,
  EntityDraft,
  EntityQuery,
  EntityRecord,
  EntityRefinementInput,
  EventInput,
  EventRecord,
  JsonObject,
  JsonValue,
  PersonalAlias,
  PrivacyClassification,
  PrivacyDescriptor,
  PrivacyReclassificationInput,
  RecordProvenanceLink,
  RelationshipInput,
  RelationshipRecord,
  RelationshipTypeDefinition,
  RelationshipTypeInput,
  Repositories,
  SourceInput,
  SourceRecord,
  StableId,
  VocabularyTerm,
  VocabularyTermInput,
} from '@/domain';
import { createAIProposalRepository } from './createAIProposalRepository';
import { createMemoryRepository } from './createMemoryRepository';

import {
  assertConfidence,
  assertJsonObject,
  assertNonEmpty,
  createPrivacyDescriptor,
  createStableId,
  createSyncMetadata,
  normalizeAlias,
  normalizeOpenType,
  nowIso,
  validateAttributeValue,
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

interface EntityRow extends BaseRow {
  type_key: string;
  title: string;
  description: string | null;
  status: string | null;
  metadata_json: string;
  is_placeholder: number;
  resolved_entity_id: string | null;
}

interface AttributeRow extends BaseRow {
  entity_id: string;
  definition_id: string | null;
  key: string;
  value_type: string;
  text_value: string | null;
  number_value: number | null;
  boolean_value: number | null;
  datetime_value: string | null;
  json_value: string | null;
  entity_reference_id: string | null;
  term_reference_id: string | null;
  ordinal: number;
  status: string | null;
  metadata_json: string;
}

interface RelationshipRow extends BaseRow {
  type_key: string;
  type_definition_id: string | null;
  source_entity_id: string;
  target_entity_id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  valid_from: string | null;
  valid_to: string | null;
  metadata_json: string;
}

interface RelationshipTypeRow extends BaseRow {
  key: string;
  label: string;
  inverse_key: string | null;
  description: string | null;
  constraints_json: string;
  metadata_json: string;
}

interface AliasRow extends BaseRow {
  entity_id: string;
  value: string;
  normalized_value: string;
  kind: string;
  language: string | null;
  is_preferred: number;
  metadata_json: string;
}

interface EventRow extends BaseRow {
  type_key: string;
  title: string;
  description: string | null;
  status: string | null;
  occurred_at: string | null;
  ended_at: string | null;
  actor_entity_id: string | null;
  payload_json: string;
  metadata_json: string;
}

interface SourceRow extends BaseRow {
  type_key: string;
  title: string | null;
  uri: string | null;
  captured_at: string;
  observed_at: string | null;
  content_entity_id: string | null;
  originating_entity_id: string | null;
  source_device_id: string | null;
  checksum: string | null;
  is_ai_inference: number;
  is_user_confirmed: number;
  confidence: number | null;
  metadata_json: string;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unbekannter JSON-Fehler';
    throw new Error(`Beschädigte JSON-Daten in der lokalen Datenbank: ${message}`);
  }
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
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

function mapEntity(row: EntityRow): EntityRecord {
  return {
    ...mapBase(row),
    type: row.type_key,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status ?? undefined,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
    isPlaceholder: row.is_placeholder === 1,
    resolvedEntityId: row.resolved_entity_id ?? undefined,
  };
}

function requiredAttributeValue<T>(value: T | null, valueType: string): T {
  if (value === null) {
    throw new Error(`Attribut vom Typ „${valueType}“ enthält keinen gespeicherten Wert.`);
  }
  return value;
}

function readAttributeValue(row: AttributeRow): JsonValue {
  if (row.value_type === 'text') return requiredAttributeValue(row.text_value, row.value_type);
  if (row.value_type === 'number') return requiredAttributeValue(row.number_value, row.value_type);
  if (row.value_type === 'boolean') {
    return requiredAttributeValue(row.boolean_value, row.value_type) === 1;
  }
  if (row.value_type === 'datetime') {
    return requiredAttributeValue(row.datetime_value, row.value_type);
  }
  if (row.value_type === 'entity_reference') {
    return requiredAttributeValue(row.entity_reference_id, row.value_type);
  }
  if (row.value_type === 'term_reference') {
    return requiredAttributeValue(row.term_reference_id, row.value_type);
  }
  return parseJson<JsonValue>(requiredAttributeValue(row.json_value, row.value_type), null);
}

function mapAttribute(row: AttributeRow): AttributeValueRecord {
  return {
    ...mapBase(row),
    entityId: row.entity_id,
    definitionId: row.definition_id ?? undefined,
    key: row.key,
    valueType: row.value_type,
    value: readAttributeValue(row),
    ordinal: row.ordinal,
    status: row.status ?? undefined,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
  };
}

function mapRelationship(row: RelationshipRow): RelationshipRecord {
  return {
    ...mapBase(row),
    type: row.type_key,
    typeDefinitionId: row.type_definition_id ?? undefined,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    status: row.status ?? undefined,
    validFrom: row.valid_from ?? undefined,
    validTo: row.valid_to ?? undefined,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
  };
}

function mapRelationshipType(row: RelationshipTypeRow): RelationshipTypeDefinition {
  return {
    ...mapBase(row),
    key: row.key,
    label: row.label,
    inverseKey: row.inverse_key ?? undefined,
    description: row.description ?? undefined,
    constraints: parseJson<JsonObject>(row.constraints_json, {}),
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
  };
}

function mapAlias(row: AliasRow): PersonalAlias {
  return {
    ...mapBase(row),
    entityId: row.entity_id,
    value: row.value,
    normalizedValue: row.normalized_value,
    kind: row.kind,
    language: row.language ?? undefined,
    isPreferred: row.is_preferred === 1,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
  };
}

function mapEvent(row: EventRow, subjectEntityIds: string[], relationshipIds: string[]): EventRecord {
  return {
    ...mapBase(row),
    type: row.type_key,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status ?? undefined,
    occurredAt: row.occurred_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    actorEntityId: row.actor_entity_id ?? undefined,
    subjectEntityIds,
    relationshipIds,
    payload: parseJson<JsonObject>(row.payload_json, {}),
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
  };
}

function mapSource(row: SourceRow): SourceRecord {
  return {
    ...mapBase(row),
    type: row.type_key,
    title: row.title ?? undefined,
    uri: row.uri ?? undefined,
    capturedAt: row.captured_at,
    observedAt: row.observed_at ?? undefined,
    contentEntityId: row.content_entity_id ?? undefined,
    originatingEntityId: row.originating_entity_id ?? undefined,
    deviceId: row.source_device_id ?? undefined,
    checksum: row.checksum ?? undefined,
    isAiInference: row.is_ai_inference === 1,
    isUserConfirmed: row.is_user_confirmed === 1,
    confidence: row.confidence ?? undefined,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
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
  recordId: string,
  sourceIds: StableId[] = [],
): Promise<void> {
  const timestamp = nowIso();
  for (const [ordinal, sourceId] of sourceIds.entries()) {
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

class SQLiteRepositoryCore {
  constructor(private readonly db: SQLiteDatabase) {}

  private async getProvenanceIds(recordId: StableId): Promise<StableId[]> {
    const rows = await this.db.getAllAsync<{ source_id: string }>(
      `SELECT DISTINCT source_id FROM record_provenance_links
       WHERE record_id = ? ORDER BY ordinal, created_at`,
      recordId,
    );
    return rows.map((row) => row.source_id);
  }

  private async hydrateProvenance<T extends { id: StableId; provenanceIds: StableId[] }>(
    record: T,
  ): Promise<T> {
    record.provenanceIds = await this.getProvenanceIds(record.id);
    return record;
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

  async findProvenance(recordId: StableId): Promise<RecordProvenanceLink[]> {
    const rows = await this.db.getAllAsync<{
      record_id: string;
      source_id: string;
      role: string;
      ordinal: number;
      note: string | null;
      created_at: string;
    }>(
      `SELECT record_id, source_id, role, ordinal, note, created_at
       FROM record_provenance_links
       WHERE record_id = ?
       ORDER BY ordinal, created_at, role`,
      recordId,
    );
    return rows.map((row) => ({
      recordId: row.record_id,
      sourceId: row.source_id,
      role: row.role,
      ordinal: row.ordinal,
      note: row.note ?? undefined,
      createdAt: row.created_at,
    }));
  }

  async captureUnknownText(input: {
    text: string;
    title: string;
    capturedAt?: string;
    captureMode?: 'text' | 'voice';
    upstreamSourceIds?: StableId[];
  }): Promise<{ entity: EntityRecord; source: SourceRecord }> {
    const timestamp = nowIso();
    const capturedAt = input.capturedAt ?? timestamp;
    const sourceId = createStableId('source');
    const entityId = createStableId('entity');
    const text = assertNonEmpty(input.text, 'Information');
    const title = assertNonEmpty(input.title, 'Titel');
    const classification: PrivacyClassification = 'PRIVATE';
    const captureMode = input.captureMode ?? 'text';
    const upstreamSourceIds = input.upstreamSourceIds ?? [];
    const sourceMetadata: JsonObject = captureMode === 'voice'
      ? {
        originalText: text,
        captureMode,
        upstreamAudioSourceId: upstreamSourceIds[0] ?? null,
      }
      : { originalText: text };
    const entityMetadata: JsonObject = {
      captureMode,
      refinementState: 'unclassified',
    };

    await this.db.withTransactionAsync(async () => {
      await insertBaseRecord(this.db, sourceId, 'source', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO sources
          (id, type_key, title, captured_at, is_ai_inference, is_user_confirmed,
           metadata_json)
         VALUES (?, 'user_input', 'Direkte Eingabe', ?, 0, 1, ?)`,
        sourceId,
        capturedAt,
        JSON.stringify(sourceMetadata),
      );
      await insertProvenanceLinks(this.db, sourceId, upstreamSourceIds);

      await insertBaseRecord(this.db, entityId, 'entity', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO entities
          (id, type_key, title, description, metadata_json, is_placeholder)
         VALUES (?, ?, ?, ?, ?, 1)`,
        entityId,
        UNKNOWN_ENTITY_TYPE,
        title,
        text,
        JSON.stringify(entityMetadata),
      );
      await insertProvenanceLinks(this.db, entityId, [sourceId]);
    });

    return {
      source: {
        id: sourceId,
        type: 'user_input',
        title: 'Direkte Eingabe',
        capturedAt,
        isAiInference: false,
        isUserConfirmed: true,
        metadata: sourceMetadata,
        createdAt: timestamp,
        updatedAt: timestamp,
        privacy: createPrivacyDescriptor(classification, timestamp),
        sync: createSyncMetadata(),
        provenanceIds: upstreamSourceIds,
      },
      entity: {
        id: entityId,
        type: UNKNOWN_ENTITY_TYPE,
        title,
        description: text,
        metadata: entityMetadata,
        isPlaceholder: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        privacy: createPrivacyDescriptor(classification, timestamp),
        sync: createSyncMetadata(),
        provenanceIds: [sourceId],
      },
    };
  }

  async createEntity(draft: EntityDraft): Promise<EntityRecord> {
    const timestamp = nowIso();
    const id = draft.id ?? createStableId('entity');
    const type = normalizeOpenType(draft.type ?? UNKNOWN_ENTITY_TYPE, UNKNOWN_ENTITY_TYPE);
    const title = assertNonEmpty(draft.title, 'Titel');
    const metadata = assertJsonObject(draft.metadata ?? {});
    const classification = draft.privacyClassification ?? 'PRIVATE';

    await this.db.withTransactionAsync(async () => {
      await insertBaseRecord(this.db, id, 'entity', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO entities
          (id, type_key, title, description, status, metadata_json, is_placeholder, resolved_entity_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        type,
        title,
        draft.description?.trim() || null,
        draft.status ?? null,
        JSON.stringify(metadata),
        draft.isPlaceholder || type === UNKNOWN_ENTITY_TYPE ? 1 : 0,
        draft.resolvedEntityId ?? null,
      );
      await insertProvenanceLinks(this.db, id, draft.provenanceIds);
    });

    const created = await this.getEntityById(id);
    if (!created) {
      throw new Error('Die Information konnte nicht gespeichert werden.');
    }
    return created;
  }

  async getEntityById(id: StableId): Promise<EntityRecord | null> {
    const row = await this.db.getFirstAsync<EntityRow>(
      `SELECT ${BASE_SELECT},
        e.type_key, e.title, e.description, e.status, e.metadata_json,
        e.is_placeholder, e.resolved_entity_id
       FROM entities e
       JOIN records r ON r.id = e.id
       JOIN record_privacy p ON p.record_id = r.id
       WHERE e.id = ? AND r.deleted_at IS NULL`,
      id,
    );
    if (!row) {
      return null;
    }
    const entity = mapEntity(row);
    entity.provenanceIds = await this.getProvenanceIds(entity.id);
    return entity;
  }

  async refineEntity(id: StableId, input: EntityRefinementInput): Promise<EntityRecord> {
    const existing = await this.getEntityById(id);
    if (!existing) {
      throw new Error('Die zu präzisierende Entität wurde nicht gefunden.');
    }

    const timestamp = nowIso();
    const type = normalizeOpenType(input.type, UNKNOWN_ENTITY_TYPE);
    const title = input.title === undefined ? existing.title : assertNonEmpty(input.title, 'Titel');
    const metadata = input.metadata === undefined ? existing.metadata : assertJsonObject(input.metadata);
    const isPlaceholder = input.isPlaceholder ?? type === UNKNOWN_ENTITY_TYPE;

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE entities
         SET type_key = ?, title = ?, description = ?, status = ?, metadata_json = ?,
             is_placeholder = ?
         WHERE id = ?`,
        type,
        title,
        input.description === undefined ? existing.description ?? null : input.description.trim() || null,
        input.status === undefined ? existing.status ?? null : input.status,
        JSON.stringify(metadata),
        isPlaceholder ? 1 : 0,
        id,
      );
      await this.touchRecord(id, timestamp);
    });

    const refined = await this.getEntityById(id);
    if (!refined) {
      throw new Error('Die Entität konnte nach der Präzisierung nicht geladen werden.');
    }
    return refined;
  }

  async getEntityDetails(id: StableId): Promise<EntityDetails | null> {
    const entity = await this.getEntityById(id);
    if (!entity) return null;

    const [attributes, aliases, relationships, events, sources, provenance] = await Promise.all([
      this.findAttributes(id),
      this.findAliasesForEntity(id),
      this.findRelationships(id),
      this.findEvents(id),
      this.findSources(id),
      this.findProvenance(id),
    ]);
    return { entity, attributes, aliases, relationships, events, sources, provenance };
  }

  async searchEntities(query: EntityQuery = {}): Promise<EntityRecord[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (!query.includeDeleted) {
      where.push('r.deleted_at IS NULL');
    }
    if (query.status) {
      where.push('e.status = ?');
      params.push(query.status);
    }
    if (query.types?.length) {
      where.push(`e.type_key IN (${query.types.map(() => '?').join(', ')})`);
      params.push(...query.types);
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      where.push(`(
        e.title LIKE ? COLLATE NOCASE OR
        e.description LIKE ? COLLATE NOCASE OR
        EXISTS (
          SELECT 1 FROM aliases a
          WHERE a.entity_id = e.id AND a.normalized_value LIKE ? COLLATE NOCASE
        ) OR
        EXISTS (
          SELECT 1 FROM attribute_values av
          WHERE av.entity_id = e.id AND av.text_value LIKE ? COLLATE NOCASE
        )
      )`);
      params.push(term, term, `%${normalizeAlias(query.search)}%`, term);
    }

    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    params.push(limit);
    const rows = await this.db.getAllAsync<EntityRow>(
      `SELECT ${BASE_SELECT},
        e.type_key, e.title, e.description, e.status, e.metadata_json,
        e.is_placeholder, e.resolved_entity_id
       FROM entities e
       JOIN records r ON r.id = e.id
       JOIN record_privacy p ON p.record_id = r.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.updated_at DESC
       LIMIT ?`,
      ...params,
    );
    return Promise.all(
      rows.map(async (row) => {
        const entity = mapEntity(row);
        entity.provenanceIds = await this.getProvenanceIds(entity.id);
        return entity;
      }),
    );
  }

  async addAttribute(entityId: StableId, input: AttributeInput): Promise<AttributeValueRecord> {
    validateAttributeValue(input.valueType, input.value);
    const timestamp = nowIso();
    const id = input.id ?? createStableId('attribute');
    const key = normalizeOpenType(assertNonEmpty(input.key, 'Attributschlüssel'), 'attribute');
    const metadata = assertJsonObject(input.metadata ?? {});
    const classification = input.privacyClassification ?? 'PRIVATE';

    let textValue: string | null = null;
    let numberValue: number | null = null;
    let booleanValue: number | null = null;
    let datetimeValue: string | null = null;
    let jsonValue: string | null = null;
    let entityReferenceId: string | null = null;
    let termReferenceId: string | null = null;

    if (input.valueType === 'text') textValue = input.value as string;
    else if (input.valueType === 'number') numberValue = input.value as number;
    else if (input.valueType === 'boolean') booleanValue = input.value ? 1 : 0;
    else if (input.valueType === 'datetime') datetimeValue = input.value as string;
    else if (input.valueType === 'entity_reference') entityReferenceId = input.value as string;
    else if (input.valueType === 'term_reference') termReferenceId = input.value as string;
    else jsonValue = JSON.stringify(input.value);

    await this.db.withTransactionAsync(async () => {
      await insertBaseRecord(this.db, id, 'attribute_value', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO attribute_values
          (id, entity_id, definition_id, key, value_type, text_value, number_value,
           boolean_value, datetime_value, json_value, entity_reference_id,
           term_reference_id, ordinal, status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        entityId,
        input.definitionId ?? null,
        key,
        input.valueType,
        textValue,
        numberValue,
        booleanValue,
        datetimeValue,
        jsonValue,
        entityReferenceId,
        termReferenceId,
        input.ordinal ?? 0,
        input.status ?? null,
        JSON.stringify(metadata),
      );
      await insertProvenanceLinks(this.db, id, input.provenanceIds);
    });

    return {
      id,
      entityId,
      definitionId: input.definitionId,
      key,
      valueType: input.valueType,
      value: input.value,
      ordinal: input.ordinal ?? 0,
      status: input.status,
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      privacy: createPrivacyDescriptor(classification, timestamp),
      sync: createSyncMetadata(),
      provenanceIds: input.provenanceIds ?? [],
    };
  }

  async findAttributes(entityId: StableId): Promise<AttributeValueRecord[]> {
    const rows = await this.db.getAllAsync<AttributeRow>(
      `SELECT ${BASE_SELECT}, av.entity_id, av.definition_id, av.key, av.value_type,
        av.text_value, av.number_value, av.boolean_value, av.datetime_value, av.json_value,
        av.entity_reference_id, av.term_reference_id, av.ordinal, av.status, av.metadata_json
       FROM attribute_values av
       JOIN records r ON r.id = av.id
       JOIN record_privacy p ON p.record_id = r.id
       WHERE av.entity_id = ? AND r.deleted_at IS NULL
       ORDER BY av.key, av.ordinal, r.created_at`,
      entityId,
    );
    return Promise.all(rows.map((row) => this.hydrateProvenance(mapAttribute(row))));
  }

  async createRelationship(input: RelationshipInput): Promise<RelationshipRecord> {
    const timestamp = nowIso();
    const id = input.id ?? createStableId('relationship');
    const type = normalizeOpenType(input.type, UNKNOWN_RELATIONSHIP_TYPE);
    const metadata = assertJsonObject(input.metadata ?? {});
    const classification = input.privacyClassification ?? 'PRIVATE';

    await this.db.withTransactionAsync(async () => {
      await insertBaseRecord(this.db, id, 'relationship', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO relationships
          (id, type_key, type_definition_id, source_entity_id, target_entity_id, title, description,
           status, valid_from, valid_to, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        type,
        input.typeDefinitionId ?? null,
        input.sourceEntityId,
        input.targetEntityId,
        input.title ?? null,
        input.description ?? null,
        input.status ?? null,
        input.validFrom ?? null,
        input.validTo ?? null,
        JSON.stringify(metadata),
      );
      await insertProvenanceLinks(this.db, id, input.provenanceIds);
    });

    return {
      id,
      type,
      typeDefinitionId: input.typeDefinitionId,
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      title: input.title,
      description: input.description,
      status: input.status,
      validFrom: input.validFrom,
      validTo: input.validTo,
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      privacy: createPrivacyDescriptor(classification, timestamp),
      sync: createSyncMetadata(),
      provenanceIds: input.provenanceIds ?? [],
    };
  }

  async findRelationships(entityId: StableId): Promise<RelationshipRecord[]> {
    const rows = await this.db.getAllAsync<RelationshipRow>(
      `SELECT ${BASE_SELECT}, rel.type_key, rel.type_definition_id,
        rel.source_entity_id, rel.target_entity_id,
        rel.title, rel.description, rel.status, rel.valid_from, rel.valid_to, rel.metadata_json
       FROM relationships rel
       JOIN records r ON r.id = rel.id
       JOIN record_privacy p ON p.record_id = r.id
       WHERE (rel.source_entity_id = ? OR rel.target_entity_id = ?) AND r.deleted_at IS NULL
       ORDER BY r.updated_at DESC`,
      entityId,
      entityId,
    );
    return Promise.all(rows.map((row) => this.hydrateProvenance(mapRelationship(row))));
  }

  async createRelationshipType(input: RelationshipTypeInput): Promise<RelationshipTypeDefinition> {
    const timestamp = nowIso();
    const id = input.id ?? createStableId('relationship_type');
    const key = normalizeOpenType(assertNonEmpty(input.key, 'Beziehungstyp'), UNKNOWN_RELATIONSHIP_TYPE);
    const label = assertNonEmpty(input.label, 'Bezeichnung');
    const constraints = assertJsonObject(input.constraints ?? {});
    const metadata = assertJsonObject(input.metadata ?? {});
    const classification = input.privacyClassification ?? 'PRIVATE';

    await this.db.withTransactionAsync(async () => {
      await insertBaseRecord(this.db, id, 'relationship_type', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO relationship_types
          (id, key, label, inverse_key, description, constraints_json, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        key,
        label,
        input.inverseKey ? normalizeOpenType(input.inverseKey, UNKNOWN_RELATIONSHIP_TYPE) : null,
        input.description ?? null,
        JSON.stringify(constraints),
        JSON.stringify(metadata),
      );
      await insertProvenanceLinks(this.db, id, input.provenanceIds);
    });

    const rows = await this.listRelationshipTypes();
    const created = rows.find((item) => item.id === id);
    if (!created) throw new Error('Der Beziehungstyp konnte nicht gespeichert werden.');
    return created;
  }

  async listRelationshipTypes(): Promise<RelationshipTypeDefinition[]> {
    const rows = await this.db.getAllAsync<RelationshipTypeRow>(
      `SELECT ${BASE_SELECT}, rt.key, rt.label, rt.inverse_key, rt.description,
        rt.constraints_json, rt.metadata_json
       FROM relationship_types rt
       JOIN records r ON r.id = rt.id
       JOIN record_privacy p ON p.record_id = r.id
       WHERE r.deleted_at IS NULL
       ORDER BY rt.label COLLATE NOCASE`,
    );
    return Promise.all(rows.map((row) => this.hydrateProvenance(mapRelationshipType(row))));
  }

  async createEvent(input: EventInput): Promise<EventRecord> {
    const timestamp = nowIso();
    const id = input.id ?? createStableId('event');
    const type = normalizeOpenType(input.type, UNKNOWN_EVENT_TYPE);
    const title = assertNonEmpty(input.title, 'Ereignistitel');
    const payload = assertJsonObject(input.payload ?? {});
    const metadata = assertJsonObject(input.metadata ?? {});
    const classification = input.privacyClassification ?? 'PRIVATE';
    const subjectIds = input.subjectEntityIds ?? [];
    const relationshipIds = input.relationshipIds ?? [];

    await this.db.withTransactionAsync(async () => {
      await insertBaseRecord(this.db, id, 'event', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO events
          (id, type_key, title, description, status, occurred_at, ended_at,
           actor_entity_id, payload_json, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        type,
        title,
        input.description ?? null,
        input.status ?? null,
        input.occurredAt ?? null,
        input.endedAt ?? null,
        input.actorEntityId ?? null,
        JSON.stringify(payload),
        JSON.stringify(metadata),
      );
      for (const [ordinal, entityId] of subjectIds.entries()) {
        await this.db.runAsync(
          'INSERT INTO event_subjects (event_id, entity_id, ordinal) VALUES (?, ?, ?)',
          id,
          entityId,
          ordinal,
        );
      }
      for (const [ordinal, relationshipId] of relationshipIds.entries()) {
        await this.db.runAsync(
          'INSERT INTO event_relationships (event_id, relationship_id, ordinal) VALUES (?, ?, ?)',
          id,
          relationshipId,
          ordinal,
        );
      }
      await insertProvenanceLinks(this.db, id, input.provenanceIds);
    });

    return {
      id,
      type,
      title,
      description: input.description,
      status: input.status,
      occurredAt: input.occurredAt,
      endedAt: input.endedAt,
      actorEntityId: input.actorEntityId,
      subjectEntityIds: subjectIds,
      relationshipIds,
      payload,
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      privacy: createPrivacyDescriptor(classification, timestamp),
      sync: createSyncMetadata(),
      provenanceIds: input.provenanceIds ?? [],
    };
  }

  async findEvents(entityId: StableId): Promise<EventRecord[]> {
    const rows = await this.db.getAllAsync<EventRow>(
      `SELECT DISTINCT ${BASE_SELECT}, ev.type_key, ev.title, ev.description, ev.status,
        ev.occurred_at, ev.ended_at, ev.actor_entity_id, ev.payload_json, ev.metadata_json
       FROM events ev
       JOIN records r ON r.id = ev.id
       JOIN record_privacy p ON p.record_id = r.id
       LEFT JOIN event_subjects es ON es.event_id = ev.id
       LEFT JOIN event_relationships er ON er.event_id = ev.id
       LEFT JOIN relationships linked_rel ON linked_rel.id = er.relationship_id
       WHERE (
         ev.actor_entity_id = ? OR es.entity_id = ? OR
         linked_rel.source_entity_id = ? OR linked_rel.target_entity_id = ?
       ) AND r.deleted_at IS NULL
       ORDER BY COALESCE(ev.occurred_at, r.created_at) DESC`,
      entityId,
      entityId,
      entityId,
      entityId,
    );

    return Promise.all(
      rows.map(async (row) => {
        const subjects = await this.db.getAllAsync<{ entity_id: string }>(
          'SELECT entity_id FROM event_subjects WHERE event_id = ? ORDER BY ordinal',
          row.id,
        );
        const relationships = await this.db.getAllAsync<{ relationship_id: string }>(
          'SELECT relationship_id FROM event_relationships WHERE event_id = ? ORDER BY ordinal',
          row.id,
        );
        return this.hydrateProvenance(
          mapEvent(
            row,
            subjects.map((item) => item.entity_id),
            relationships.map((item) => item.relationship_id),
          ),
        );
      }),
    );
  }

  async createSource(input: SourceInput): Promise<SourceRecord> {
    const timestamp = nowIso();
    const id = input.id ?? createStableId('source');
    const type = normalizeOpenType(input.type, UNKNOWN_SOURCE_TYPE);
    const capturedAt = input.capturedAt ?? timestamp;
    const metadata = assertJsonObject(input.metadata ?? {});
    const confidence = assertConfidence(input.confidence);
    const classification = input.privacyClassification ?? 'PRIVATE';

    await this.db.withTransactionAsync(async () => {
      await insertBaseRecord(this.db, id, 'source', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO sources
          (id, type_key, title, uri, captured_at, observed_at, content_entity_id,
           originating_entity_id, source_device_id, checksum, is_ai_inference,
           is_user_confirmed, confidence, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        type,
        input.title ?? null,
        input.uri ?? null,
        capturedAt,
        input.observedAt ?? null,
        input.contentEntityId ?? null,
        input.originatingEntityId ?? null,
        input.deviceId ?? null,
        input.checksum ?? null,
        input.isAiInference ? 1 : 0,
        input.isUserConfirmed ? 1 : 0,
        confidence ?? null,
        JSON.stringify(metadata),
      );
      await insertProvenanceLinks(this.db, id, input.provenanceIds);
    });

    return {
      id,
      type,
      title: input.title,
      uri: input.uri,
      capturedAt,
      observedAt: input.observedAt,
      contentEntityId: input.contentEntityId,
      originatingEntityId: input.originatingEntityId,
      deviceId: input.deviceId,
      checksum: input.checksum,
      isAiInference: input.isAiInference ?? false,
      isUserConfirmed: input.isUserConfirmed ?? false,
      confidence,
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      privacy: createPrivacyDescriptor(classification, timestamp),
      sync: createSyncMetadata(),
      provenanceIds: input.provenanceIds ?? [],
    };
  }

  async linkSource(recordId: StableId, sourceId: StableId, role = 'evidence'): Promise<void> {
    const timestamp = nowIso();
    await this.db.withTransactionAsync(async () => {
      const result = await this.db.runAsync(
        `INSERT INTO record_provenance_links
          (record_id, source_id, role, ordinal, created_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(record_id, source_id, role) DO NOTHING`,
        recordId,
        sourceId,
        normalizeOpenType(role, 'evidence'),
        timestamp,
      );
      if (result.changes === 1) {
        await this.touchRecord(recordId, timestamp);
      }
    });
  }

  async findSources(recordId: StableId): Promise<SourceRecord[]> {
    const rows = await this.db.getAllAsync<SourceRow>(
      `SELECT DISTINCT ${BASE_SELECT}, s.type_key, s.title, s.uri, s.captured_at, s.observed_at,
        s.content_entity_id, s.originating_entity_id, s.source_device_id, s.checksum,
        s.is_ai_inference, s.is_user_confirmed, s.confidence, s.metadata_json
       FROM record_provenance_links l
       JOIN sources s ON s.id = l.source_id
       JOIN records r ON r.id = s.id
       JOIN record_privacy p ON p.record_id = r.id
       WHERE l.record_id = ? AND r.deleted_at IS NULL
       ORDER BY l.ordinal, l.created_at`,
      recordId,
    );
    return Promise.all(rows.map((row) => this.hydrateProvenance(mapSource(row))));
  }

  async addVocabularyTerm(input: VocabularyTermInput): Promise<VocabularyTerm> {
    const vocabulary = await this.db.getFirstAsync<{ id: string }>(
      'SELECT id FROM vocabularies WHERE key = ?',
      input.vocabularyKey,
    );
    if (!vocabulary) {
      throw new Error(`Der Typkatalog „${input.vocabularyKey}“ wurde nicht gefunden.`);
    }

    const timestamp = nowIso();
    const id = input.id ?? createStableId('term');
    const code = normalizeOpenType(assertNonEmpty(input.code, 'Typschlüssel'), 'custom.type');
    const label = assertNonEmpty(input.label, 'Bezeichnung');
    const metadata = assertJsonObject(input.metadata ?? {});
    const classification = input.privacyClassification ?? 'PRIVATE';

    await this.db.withTransactionAsync(async () => {
      await insertBaseRecord(this.db, id, 'vocabulary_term', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO vocabulary_terms
          (id, vocabulary_id, code, label, description, parent_term_id, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        vocabulary.id,
        code,
        label,
        input.description ?? null,
        input.parentTermId ?? null,
        JSON.stringify(metadata),
      );
      await insertProvenanceLinks(this.db, id, input.provenanceIds);
    });

    const terms = await this.listTerms(input.vocabularyKey);
    const created = terms.find((term) => term.id === id);
    if (!created) throw new Error('Der neue Typ konnte nicht gespeichert werden.');
    return created;
  }

  async listTerms(vocabularyKey: string): Promise<VocabularyTerm[]> {
    const rows = await this.db.getAllAsync<
      BaseRow & {
        vocabulary_id: string;
        code: string;
        label: string;
        description: string | null;
        parent_term_id: string | null;
        metadata_json: string;
      }
    >(
      `SELECT ${BASE_SELECT}, t.vocabulary_id, t.code, t.label, t.description,
        t.parent_term_id, t.metadata_json
       FROM vocabulary_terms t
       JOIN vocabularies v ON v.id = t.vocabulary_id
       JOIN records r ON r.id = t.id
       JOIN record_privacy p ON p.record_id = r.id
       WHERE v.key = ? AND r.deleted_at IS NULL
       ORDER BY t.label COLLATE NOCASE`,
      vocabularyKey,
    );
    return Promise.all(
      rows.map((row) =>
        this.hydrateProvenance({
          ...mapBase(row),
          vocabularyId: row.vocabulary_id,
          code: row.code,
          label: row.label,
          description: row.description ?? undefined,
          parentTermId: row.parent_term_id ?? undefined,
          metadata: parseJson<JsonObject>(row.metadata_json, {}),
        }),
      ),
    );
  }

  async createAlias(input: AliasInput): Promise<PersonalAlias> {
    const timestamp = nowIso();
    const id = input.id ?? createStableId('alias');
    const value = assertNonEmpty(input.value, 'Alias');
    const normalizedValue = normalizeAlias(value);
    const kind = normalizeOpenType(input.kind ?? 'name', 'name');
    const metadata = assertJsonObject(input.metadata ?? {});
    const classification = input.privacyClassification ?? 'PRIVATE';

    await this.db.withTransactionAsync(async () => {
      await insertBaseRecord(this.db, id, 'alias', timestamp, classification);
      await this.db.runAsync(
        `INSERT INTO aliases
          (id, entity_id, value, normalized_value, kind, language, is_preferred, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.entityId,
        value,
        normalizedValue,
        kind,
        input.language ?? null,
        input.isPreferred ? 1 : 0,
        JSON.stringify(metadata),
      );
      await insertProvenanceLinks(this.db, id, input.provenanceIds);
    });

    return {
      id,
      entityId: input.entityId,
      value,
      normalizedValue,
      kind,
      language: input.language,
      isPreferred: input.isPreferred ?? false,
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      privacy: createPrivacyDescriptor(classification, timestamp),
      sync: createSyncMetadata(),
      provenanceIds: input.provenanceIds ?? [],
    };
  }

  async findAliasEntityIds(value: string): Promise<StableId[]> {
    const rows = await this.db.getAllAsync<{ entity_id: string }>(
      `SELECT DISTINCT a.entity_id
       FROM aliases a
       JOIN records alias_record ON alias_record.id = a.id
       JOIN records entity_record ON entity_record.id = a.entity_id
       WHERE a.normalized_value = ? COLLATE NOCASE
         AND alias_record.deleted_at IS NULL
         AND entity_record.deleted_at IS NULL`,
      normalizeAlias(value),
    );
    return rows.map((row) => row.entity_id);
  }

  async findAliasesForEntity(entityId: StableId): Promise<PersonalAlias[]> {
    const rows = await this.db.getAllAsync<AliasRow>(
      `SELECT ${BASE_SELECT}, a.entity_id, a.value, a.normalized_value, a.kind,
        a.language, a.is_preferred, a.metadata_json
       FROM aliases a
       JOIN records r ON r.id = a.id
       JOIN record_privacy p ON p.record_id = r.id
       WHERE a.entity_id = ? AND r.deleted_at IS NULL
       ORDER BY a.is_preferred DESC, a.value COLLATE NOCASE`,
      entityId,
    );
    return Promise.all(rows.map((row) => this.hydrateProvenance(mapAlias(row))));
  }

  async reclassifyPrivacy(
    recordId: StableId,
    input: PrivacyReclassificationInput,
  ): Promise<PrivacyDescriptor> {
    const classifiedAt = input.classifiedAt ?? nowIso();
    const classification = createPrivacyDescriptor(input.classification, classifiedAt).classification;
    const handlingRules = input.handlingRules ?? [];

    await this.db.withTransactionAsync(async () => {
      const result = await this.db.runAsync(
        `UPDATE record_privacy
         SET classification = ?, reason = ?, classified_at = ?, classified_by = ?,
             handling_rules_json = ?
         WHERE record_id = ?`,
        classification,
        input.reason ?? null,
        classifiedAt,
        input.classifiedBy ?? null,
        JSON.stringify(handlingRules),
        recordId,
      );
      if (result.changes !== 1) {
        throw new Error('Der Datensatz für die Datenschutzklassifikation wurde nicht gefunden.');
      }
      await this.touchRecord(recordId, classifiedAt);
    });

    return {
      classification,
      reason: input.reason,
      classifiedAt,
      classifiedBy: input.classifiedBy,
      handlingRules,
    };
  }

  async buildCoreBundle(): Promise<CoreExportBundle> {
    const tableNames = [
      'schema_migrations',
      'records',
      'record_privacy',
      'entities',
      'attribute_definitions',
      'attribute_values',
      'relationship_types',
      'relationships',
      'events',
      'event_subjects',
      'event_relationships',
      'sources',
      'memories',
      'memory_entities',
      'memory_events',
      'memory_relationships',
      'memory_relations',
      'vocabularies',
      'vocabulary_terms',
      'aliases',
      'record_provenance_links',
      'ai_extractions',
      'ai_action_proposals',
    ] as const;
    const tables: Record<string, JsonObject[]> = {};

    await this.db.withTransactionAsync(async () => {
      for (const tableName of tableNames) {
        const rows = await this.db.getAllAsync<Record<string, unknown>>(
          `SELECT * FROM ${tableName}`,
        );
        tables[tableName] = rows.map(toJsonObject);
      }
    });

    const version = await this.db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (!version) throw new Error('Die Datenbankversion konnte nicht exportiert werden.');

    return {
      schemaVersion: CORE_EXPORT_SCHEMA_VERSION,
      databaseVersion: version.user_version,
      exportedAt: nowIso(),
      tables,
    };
  }
}

export function createRepositories(db: SQLiteDatabase): Repositories {
  const core = new SQLiteRepositoryCore(db);
  const memories = createMemoryRepository(db, {
    getEntity: (id) => core.getEntityById(id),
    findEvents: (entityId) => core.findEvents(entityId),
    findRelationships: (entityId) => core.findRelationships(entityId),
    findAliases: (entityId) => core.findAliasesForEntity(entityId),
    findSources: (recordId) => core.findSources(recordId),
    findProvenance: (recordId) => core.findProvenance(recordId),
  });
  const aiProposals = createAIProposalRepository(db);
  return {
    entities: {
      create: (draft) => core.createEntity(draft),
      getById: (id) => core.getEntityById(id),
      getDetails: (id) => core.getEntityDetails(id),
      search: (query) => core.searchEntities(query),
      refine: (id, input) => core.refineEntity(id, input),
      addAttribute: (entityId, input) => core.addAttribute(entityId, input),
      findAttributes: (entityId) => core.findAttributes(entityId),
    },
    relationships: {
      create: (input) => core.createRelationship(input),
      findForEntity: (entityId) => core.findRelationships(entityId),
      createType: (input) => core.createRelationshipType(input),
      listTypes: () => core.listRelationshipTypes(),
    },
    events: {
      create: (input) => core.createEvent(input),
      findForEntity: (entityId) => core.findEvents(entityId),
    },
    sources: {
      create: (input) => core.createSource(input),
      linkToRecord: (recordId, sourceId, role) => core.linkSource(recordId, sourceId, role),
      findForRecord: (recordId) => core.findSources(recordId),
      findProvenance: (recordId) => core.findProvenance(recordId),
    },
    vocabularies: {
      addTerm: (input) => core.addVocabularyTerm(input),
      listTerms: (vocabularyKey) => core.listTerms(vocabularyKey),
    },
    aliases: {
      create: (input) => core.createAlias(input),
      findEntityIds: (value) => core.findAliasEntityIds(value),
      findForEntity: (entityId) => core.findAliasesForEntity(entityId),
    },
    memories,
    privacy: {
      reclassify: (recordId, input) => core.reclassifyPrivacy(recordId, input),
    },
    exports: {
      buildCoreBundle: () => core.buildCoreBundle(),
    },
    captures: {
      captureUnknownText: (input) => core.captureUnknownText(input),
    },
    aiProposals,
  };
}
