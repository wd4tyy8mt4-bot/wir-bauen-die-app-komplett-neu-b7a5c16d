export type StableId = string;
export type IsoTimestamp = string;
export type OpenType = string;
export type MemoryStatus =
  | 'CONFIRMED'
  | 'UNCONFIRMED'
  | 'INFERRED'
  | 'UNCERTAIN'
  | 'TEMPORARY'
  | (string & {});
export type MemoryType =
  | 'FACT'
  | 'NOTE'
  | 'PREFERENCE'
  | 'EXPERIENCE'
  | 'COMMITMENT'
  | 'DECISION'
  | 'GOAL'
  | 'PLAN'
  | 'OBSERVATION'
  | 'REMINDER_CONTEXT'
  | 'UNKNOWN'
  | (string & {});
export type MemoryRelationType =
  | 'REVISES'
  | 'SUPERSEDES'
  | 'CONTRADICTS'
  | 'SUPPORTS'
  | 'RELATED_TO'
  | (string & {});
export type MemoryConflictStatus =
  | 'OPEN'
  | 'RESOLVED'
  | 'DISMISSED'
  | (string & {});
export type MemoryTemporalMode =
  | 'UNKNOWN'
  | 'FROM'
  | 'UNTIL'
  | 'RANGE'
  | 'AT'
  | (string & {});
export type PrivacyClassification =
  | 'PUBLIC'
  | 'PRIVATE'
  | 'PERSONAL'
  | 'HIGHLY_SENSITIVE'
  | 'PROTECTED';
export type SyncState = 'local_only' | 'pending' | 'synced' | 'conflict' | 'error';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface InitialTypeDefinition {
  key: OpenType;
  label: string;
  description?: string;
}

export type TypeCatalogKey =
  | 'entity_type'
  | 'event_type'
  | 'source_type'
  | 'relationship_type'
  | 'alias_kind'
  | (string & {});

export interface RecordTimestamps {
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt?: IsoTimestamp | null;
}

export interface SyncMetadata {
  deviceId?: string;
  localRevision: number;
  remoteRevision?: string;
  syncState: SyncState;
  lastSyncedAt?: IsoTimestamp | null;
  conflictData?: JsonObject | null;
}

export interface PrivacyDescriptor {
  classification: PrivacyClassification;
  reason?: string;
  classifiedAt: IsoTimestamp;
  classifiedBy?: string;
  handlingRules?: string[];
}

export interface PersistedRecord extends RecordTimestamps {
  id: StableId;
  privacy: PrivacyDescriptor;
  sync: SyncMetadata;
  provenanceIds: StableId[];
}

export interface ProvenanceLink {
  sourceId: StableId;
  role: OpenType;
  ordinal: number;
  note?: string;
  createdAt: IsoTimestamp;
}

export interface RecordProvenanceLink extends ProvenanceLink {
  recordId: StableId;
}

export interface EntityRecord extends PersistedRecord {
  type: OpenType;
  title: string;
  description?: string;
  status?: string;
  metadata: JsonObject;
  isPlaceholder: boolean;
  resolvedEntityId?: StableId;
}

export interface EntityRefinementInput {
  type: OpenType;
  title?: string;
  description?: string;
  status?: string;
  metadata?: JsonObject;
  isPlaceholder?: boolean;
}

export type AttributeValueType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'json'
  | 'entity_reference'
  | 'term_reference'
  | (string & {});

export interface AttributeDefinition extends PersistedRecord {
  key: string;
  label: string;
  valueType: AttributeValueType;
  description?: string;
  cardinality: OpenType;
  constraints: JsonObject;
  metadata: JsonObject;
}

export interface AttributeValueRecord extends PersistedRecord {
  entityId: StableId;
  definitionId?: StableId;
  key: string;
  valueType: AttributeValueType;
  value: JsonValue;
  ordinal: number;
  status?: string;
  metadata: JsonObject;
}

export interface RelationshipTypeDefinition extends PersistedRecord {
  key: string;
  label: string;
  inverseKey?: string;
  description?: string;
  constraints: JsonObject;
  metadata: JsonObject;
}

export interface RelationshipTypeInput {
  id?: StableId;
  key: OpenType;
  label: string;
  inverseKey?: OpenType;
  description?: string;
  constraints?: JsonObject;
  metadata?: JsonObject;
  provenanceIds?: StableId[];
  privacyClassification?: PrivacyClassification;
}

export interface RelationshipRecord extends PersistedRecord {
  type: OpenType;
  typeDefinitionId?: StableId;
  sourceEntityId: StableId;
  targetEntityId: StableId;
  title?: string;
  description?: string;
  status?: string;
  validFrom?: IsoTimestamp;
  validTo?: IsoTimestamp;
  metadata: JsonObject;
}

export interface EventRecord extends PersistedRecord {
  type: OpenType;
  title: string;
  description?: string;
  status?: string;
  occurredAt?: IsoTimestamp;
  endedAt?: IsoTimestamp;
  actorEntityId?: StableId;
  subjectEntityIds: StableId[];
  relationshipIds: StableId[];
  payload: JsonObject;
  metadata: JsonObject;
}

export interface SourceRecord extends PersistedRecord {
  type: OpenType;
  title?: string;
  uri?: string;
  capturedAt: IsoTimestamp;
  observedAt?: IsoTimestamp;
  contentEntityId?: StableId;
  originatingEntityId?: StableId;
  deviceId?: string;
  checksum?: string;
  isAiInference: boolean;
  isUserConfirmed: boolean;
  confidence?: number;
  metadata: JsonObject;
}

export interface MemoryRecord extends PersistedRecord {
  content: string;
  type: MemoryType;
  status: MemoryStatus;
  confidence?: number;
  verifiedAt?: IsoTimestamp;
  lastAccessedAt?: IsoTimestamp;
  isTemporary: boolean;
  userConfirmed: boolean;
  validFrom?: IsoTimestamp;
  validTo?: IsoTimestamp;
  temporalMode: MemoryTemporalMode;
  entityIds: StableId[];
  eventIds: StableId[];
  relationshipIds: StableId[];
  metadata: JsonObject;
}

export interface MemoryRelationRecord extends PersistedRecord {
  fromMemoryId: StableId;
  toMemoryId: StableId;
  type: MemoryRelationType;
  conflictStatus?: MemoryConflictStatus;
  resolvedAt?: IsoTimestamp;
  note?: string;
  metadata: JsonObject;
}

export interface VocabularyRecord extends PersistedRecord {
  key: string;
  label: string;
  description?: string;
  metadata: JsonObject;
}

export interface VocabularyTerm extends PersistedRecord {
  vocabularyId: StableId;
  code: string;
  label: string;
  description?: string;
  parentTermId?: StableId;
  metadata: JsonObject;
}

export interface VocabularyTermInput {
  id?: StableId;
  vocabularyKey: TypeCatalogKey;
  code: OpenType;
  label: string;
  description?: string;
  parentTermId?: StableId;
  metadata?: JsonObject;
  provenanceIds?: StableId[];
  privacyClassification?: PrivacyClassification;
}

export interface PersonalAlias extends PersistedRecord {
  entityId: StableId;
  value: string;
  normalizedValue: string;
  kind: OpenType;
  language?: string;
  isPreferred: boolean;
  metadata: JsonObject;
}

export interface EntityDraft {
  id?: StableId;
  type?: OpenType;
  title: string;
  description?: string;
  status?: string;
  metadata?: JsonObject;
  privacyClassification?: PrivacyClassification;
  isPlaceholder?: boolean;
  resolvedEntityId?: StableId;
  provenanceIds?: StableId[];
}

export interface AttributeInput {
  id?: StableId;
  key: string;
  valueType: AttributeValueType;
  value: JsonValue;
  definitionId?: StableId;
  ordinal?: number;
  status?: string;
  metadata?: JsonObject;
  provenanceIds?: StableId[];
  privacyClassification?: PrivacyClassification;
}

export interface RelationshipInput {
  id?: StableId;
  type: OpenType;
  typeDefinitionId?: StableId;
  sourceEntityId: StableId;
  targetEntityId: StableId;
  title?: string;
  description?: string;
  status?: string;
  validFrom?: IsoTimestamp;
  validTo?: IsoTimestamp;
  metadata?: JsonObject;
  provenanceIds?: StableId[];
  privacyClassification?: PrivacyClassification;
}

export interface EventInput {
  id?: StableId;
  type: OpenType;
  title: string;
  description?: string;
  status?: string;
  occurredAt?: IsoTimestamp;
  endedAt?: IsoTimestamp;
  actorEntityId?: StableId;
  subjectEntityIds?: StableId[];
  relationshipIds?: StableId[];
  payload?: JsonObject;
  metadata?: JsonObject;
  provenanceIds?: StableId[];
  privacyClassification?: PrivacyClassification;
}

export type TranscriptionStatus = 'completed' | 'unavailable' | 'failed' | 'empty';

export interface VoiceAudioSourceInput {
  uri: string;
  capturedAt?: IsoTimestamp;
  durationMs?: number;
  mimeType?: string;
  transcriptionStatus: TranscriptionStatus;
  transcriptionProvider: string;
  transcript?: string;
  errorCode?: string;
  privacyClassification?: PrivacyClassification;
  metadata?: JsonObject;
}

export interface TranscriptionRequest {
  audioUri: string;
  locale: string;
  durationMs?: number;
}

export interface TranscriptionResponse {
  status: TranscriptionStatus;
  provider: string;
  transcript?: string;
  confidence?: number;
  errorCode?: string;
}

export interface SourceInput {
  id?: StableId;
  type: OpenType;
  title?: string;
  uri?: string;
  capturedAt?: IsoTimestamp;
  observedAt?: IsoTimestamp;
  contentEntityId?: StableId;
  originatingEntityId?: StableId;
  deviceId?: string;
  checksum?: string;
  isAiInference?: boolean;
  isUserConfirmed?: boolean;
  confidence?: number;
  metadata?: JsonObject;
  provenanceIds?: StableId[];
  privacyClassification?: PrivacyClassification;
}

export interface AliasInput {
  id?: StableId;
  entityId: StableId;
  value: string;
  kind?: OpenType;
  language?: string;
  isPreferred?: boolean;
  provenanceIds?: StableId[];
  metadata?: JsonObject;
  privacyClassification?: PrivacyClassification;
}

export interface MemoryInput {
  id?: StableId;
  content: string;
  type?: MemoryType;
  status?: MemoryStatus;
  confidence?: number;
  verifiedAt?: IsoTimestamp;
  lastAccessedAt?: IsoTimestamp;
  isTemporary?: boolean;
  userConfirmed?: boolean;
  validFrom?: IsoTimestamp;
  validTo?: IsoTimestamp;
  temporalMode?: MemoryTemporalMode;
  entityIds?: StableId[];
  eventIds?: StableId[];
  relationshipIds?: StableId[];
  metadata?: JsonObject;
  provenanceIds?: StableId[];
  privacyClassification?: PrivacyClassification;
}

export interface MemoryUpdateInput {
  content?: string;
  type?: MemoryType;
  status?: MemoryStatus;
  confidence?: number | null;
  verifiedAt?: IsoTimestamp | null;
  lastAccessedAt?: IsoTimestamp | null;
  isTemporary?: boolean;
  userConfirmed?: boolean;
  validFrom?: IsoTimestamp | null;
  validTo?: IsoTimestamp | null;
  temporalMode?: MemoryTemporalMode;
  metadata?: JsonObject;
}

export interface MemoryRevisionInput extends MemoryInput {
  relationType?: MemoryRelationType;
  conflictStatus?: MemoryConflictStatus;
  relationNote?: string;
  relationMetadata?: JsonObject;
}

export interface MemoryQuery {
  search?: string;
  entityId?: StableId;
  eventId?: StableId;
  relationshipId?: StableId;
  statuses?: MemoryStatus[];
  types?: MemoryType[];
  includeTemporary?: boolean;
  includeDeleted?: boolean;
  validAt?: IsoTimestamp;
  limit?: number;
}

export interface SemanticMemorySearchRequest {
  query: string;
  filters?: Omit<MemoryQuery, 'search'>;
}

export interface SemanticMemorySearchResult {
  memoryId: StableId;
  score: number;
  explanation?: string;
}

export interface PrivacyReclassificationInput {
  classification: PrivacyClassification;
  reason?: string;
  classifiedBy?: string;
  handlingRules?: string[];
  classifiedAt?: IsoTimestamp;
}

export interface EntityQuery {
  search?: string;
  types?: OpenType[];
  status?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export interface EntityDetails {
  entity: EntityRecord;
  attributes: AttributeValueRecord[];
  aliases: PersonalAlias[];
  relationships: RelationshipRecord[];
  events: EventRecord[];
  sources: SourceRecord[];
  provenance: RecordProvenanceLink[];
}

export interface EntityMemorySnapshot {
  entity: EntityRecord;
  confirmedMemories: MemoryRecord[];
  currentMemories: MemoryRecord[];
  unconfirmedMemories: MemoryRecord[];
  inferredMemories: MemoryRecord[];
  uncertainMemories: MemoryRecord[];
  temporaryMemories: MemoryRecord[];
  events: EventRecord[];
  relationships: RelationshipRecord[];
  aliases: PersonalAlias[];
  sources: SourceRecord[];
  memoryRelations: MemoryRelationRecord[];
  provenance: RecordProvenanceLink[];
  generatedAt: IsoTimestamp;
}

export const CORE_EXPORT_SCHEMA_VERSION = 1 as const;

export interface CoreExportBundle {
  schemaVersion: typeof CORE_EXPORT_SCHEMA_VERSION;
  databaseVersion: number;
  exportedAt: IsoTimestamp;
  tables: Record<string, JsonObject[]>;
}

export interface SyncRecordEnvelope {
  recordId: StableId;
  recordKind: OpenType;
  operation: 'upsert' | 'delete';
  localRevision: number;
  changedAt: IsoTimestamp;
  payload?: JsonObject;
}
