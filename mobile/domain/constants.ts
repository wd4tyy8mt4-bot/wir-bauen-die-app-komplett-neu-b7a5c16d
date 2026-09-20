import type {
  InitialTypeDefinition,
  MemoryConflictStatus,
  MemoryRelationType,
  MemoryStatus,
  MemoryTemporalMode,
  MemoryType,
  PrivacyClassification,
  SyncState,
  TypeCatalogKey,
} from './model';

export const PRIVACY_CLASSIFICATIONS: Record<PrivacyClassification, PrivacyClassification> = {
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
  PERSONAL: 'PERSONAL',
  HIGHLY_SENSITIVE: 'HIGHLY_SENSITIVE',
  PROTECTED: 'PROTECTED',
};

export const SYNC_STATES: Record<Uppercase<SyncState>, SyncState> = {
  LOCAL_ONLY: 'local_only',
  PENDING: 'pending',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  ERROR: 'error',
};

export const TYPE_CATALOG_KEYS = {
  ENTITY: 'entity_type',
  EVENT: 'event_type',
  SOURCE: 'source_type',
  RELATIONSHIP: 'relationship_type',
  ALIAS: 'alias_kind',
} as const satisfies Record<string, TypeCatalogKey>;

export const DEFAULT_PRIVACY_CLASSIFICATION: PrivacyClassification =
  PRIVACY_CLASSIFICATIONS.PRIVATE;
export const DEFAULT_SYNC_STATE: SyncState = SYNC_STATES.LOCAL_ONLY;
export const DEFAULT_MEMORY_TYPE: MemoryType = 'UNKNOWN';
export const DEFAULT_MEMORY_STATUS: MemoryStatus = 'UNCONFIRMED';
export const DEFAULT_MEMORY_RELATION_TYPE: MemoryRelationType = 'RELATED_TO';
export const DEFAULT_MEMORY_CONFLICT_STATUS: MemoryConflictStatus = 'OPEN';
export const DEFAULT_MEMORY_TEMPORAL_MODE: MemoryTemporalMode = 'UNKNOWN';
export const UNKNOWN_ENTITY_TYPE = 'unknown.entity';
export const UNKNOWN_EVENT_TYPE = 'unknown.event';
export const UNKNOWN_SOURCE_TYPE = 'unknown.source';
export const UNKNOWN_RELATIONSHIP_TYPE = 'unknown.relationship';

export const INITIAL_ENTITY_TYPES: ReadonlyArray<InitialTypeDefinition> = [
  { key: UNKNOWN_ENTITY_TYPE, label: 'Unbekannt' },
  { key: 'person', label: 'Person' },
  { key: 'organization', label: 'Organisation' },
  { key: 'place', label: 'Ort' },
  { key: 'object', label: 'Objekt' },
  { key: 'device', label: 'Gerät' },
  { key: 'vehicle', label: 'Fahrzeug' },
  { key: 'document', label: 'Dokument' },
  { key: 'file', label: 'Datei' },
  { key: 'photo', label: 'Foto' },
  { key: 'video', label: 'Video' },
  { key: 'audio', label: 'Audio' },
  { key: 'event', label: 'Ereignis' },
  { key: 'appointment', label: 'Termin' },
  { key: 'task', label: 'Aufgabe' },
  { key: 'project', label: 'Projekt' },
  { key: 'problem', label: 'Problem' },
  { key: 'contract', label: 'Vertrag' },
  { key: 'invoice', label: 'Rechnung' },
  { key: 'transaction', label: 'Transaktion' },
  { key: 'service', label: 'Service' },
  { key: 'relationship', label: 'Beziehung' },
  { key: 'information', label: 'Information' },
  { key: 'note', label: 'Notiz' },
  { key: 'decision', label: 'Entscheidung' },
  { key: 'commitment', label: 'Zusage' },
  { key: 'source', label: 'Quelle' },
];

export const INITIAL_EVENT_TYPES: ReadonlyArray<InitialTypeDefinition> = [
  { key: UNKNOWN_EVENT_TYPE, label: 'Unbekanntes Ereignis' },
  { key: 'conversation', label: 'Gespräch' },
  { key: 'purchase', label: 'Kauf' },
  { key: 'repair', label: 'Reparatur' },
  { key: 'appointment', label: 'Termin' },
  { key: 'travel', label: 'Reise' },
  { key: 'work', label: 'Arbeit' },
  { key: 'decision', label: 'Entscheidung' },
  { key: 'commitment', label: 'Zusage' },
  { key: 'problem', label: 'Problem' },
  { key: 'information', label: 'Wichtige Information' },
];

export const INITIAL_SOURCE_TYPES: ReadonlyArray<InitialTypeDefinition> = [
  { key: UNKNOWN_SOURCE_TYPE, label: 'Unbekannte Quelle' },
  { key: 'user_input', label: 'Benutzereingabe' },
  { key: 'document', label: 'Dokument' },
  { key: 'photo', label: 'Foto' },
  { key: 'video', label: 'Video' },
  { key: 'audio', label: 'Audio' },
  { key: 'web', label: 'Web' },
  { key: 'ai_inference', label: 'KI-Inferenz' },
  { key: 'import', label: 'Import' },
];

export const INITIAL_RELATIONSHIP_TYPES: ReadonlyArray<InitialTypeDefinition> = [
  { key: UNKNOWN_RELATIONSHIP_TYPE, label: 'Unbekannte Beziehung' },
  { key: 'related_to', label: 'Steht in Beziehung zu' },
];

export const INITIAL_ALIAS_KINDS: ReadonlyArray<InitialTypeDefinition> = [
  { key: 'name', label: 'Name' },
  { key: 'nickname', label: 'Spitzname' },
  { key: 'personal_term', label: 'Persönlicher Begriff' },
  { key: 'abbreviation', label: 'Abkürzung' },
];
