import * as Crypto from 'expo-crypto';

import {
  DEFAULT_MEMORY_CONFLICT_STATUS,
  DEFAULT_MEMORY_RELATION_TYPE,
  DEFAULT_MEMORY_STATUS,
  DEFAULT_MEMORY_TEMPORAL_MODE,
  DEFAULT_MEMORY_TYPE,
  DEFAULT_PRIVACY_CLASSIFICATION,
  DEFAULT_SYNC_STATE,
  PRIVACY_CLASSIFICATIONS,
} from './constants';
import type {
  AttributeValueType,
  IsoTimestamp,
  JsonObject,
  JsonValue,
  MemoryConflictStatus,
  MemoryRelationType,
  MemoryStatus,
  MemoryTemporalMode,
  MemoryType,
  PrivacyClassification,
  PrivacyDescriptor,
  StableId,
  SyncMetadata,
} from './model';

export const BUILT_IN_ATTRIBUTE_VALUE_TYPES = [
  'text',
  'number',
  'boolean',
  'datetime',
  'json',
  'entity_reference',
  'term_reference',
] as const;

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

export function createStableId(prefix = 'rec'): StableId {
  return `${normalizeOpenType(prefix, 'rec')}_${Crypto.randomUUID()}`;
}

export function normalizeOpenType(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '.');
  return normalized || fallback;
}

export function normalizeAlias(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ');
}

function normalizeMemoryOpenValue(value: string, fallback: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9._-]+/g, '_');
  return normalized || fallback;
}

export function normalizeMemoryType(value = DEFAULT_MEMORY_TYPE): MemoryType {
  return normalizeMemoryOpenValue(value, DEFAULT_MEMORY_TYPE) as MemoryType;
}

export function normalizeMemoryStatus(value = DEFAULT_MEMORY_STATUS): MemoryStatus {
  return normalizeMemoryOpenValue(value, DEFAULT_MEMORY_STATUS) as MemoryStatus;
}

export function normalizeMemoryRelationType(
  value = DEFAULT_MEMORY_RELATION_TYPE,
): MemoryRelationType {
  return normalizeMemoryOpenValue(value, DEFAULT_MEMORY_RELATION_TYPE) as MemoryRelationType;
}

export function normalizeMemoryConflictStatus(
  value = DEFAULT_MEMORY_CONFLICT_STATUS,
): MemoryConflictStatus {
  return normalizeMemoryOpenValue(value, DEFAULT_MEMORY_CONFLICT_STATUS) as MemoryConflictStatus;
}

export function normalizeMemoryTemporalMode(
  value = DEFAULT_MEMORY_TEMPORAL_MODE,
): MemoryTemporalMode {
  return normalizeMemoryOpenValue(value, DEFAULT_MEMORY_TEMPORAL_MODE) as MemoryTemporalMode;
}

export function assertTemporalRange(
  validFrom?: IsoTimestamp | null,
  validTo?: IsoTimestamp | null,
): void {
  if (validFrom && Number.isNaN(Date.parse(validFrom))) {
    throw new Error('validFrom muss ein gültiger ISO-Zeitstempel sein.');
  }
  if (validTo && Number.isNaN(Date.parse(validTo))) {
    throw new Error('validTo muss ein gültiger ISO-Zeitstempel sein.');
  }
  if (validFrom && validTo && Date.parse(validTo) < Date.parse(validFrom)) {
    throw new Error('validTo darf nicht vor validFrom liegen.');
  }
}

export function assertNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} darf nicht leer sein.`);
  }
  return trimmed;
}

export function assertConfidence(confidence?: number): number | undefined {
  if (confidence === undefined) {
    return undefined;
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('Konfidenz muss zwischen 0 und 1 liegen.');
  }
  return confidence;
}

export function assertPrivacyClassification(value: string): PrivacyClassification {
  const validValues = Object.values(PRIVACY_CLASSIFICATIONS) as string[];
  if (!validValues.includes(value)) {
    throw new Error(`Unbekannte Datenschutzklassifikation „${value}“.`);
  }
  return value as PrivacyClassification;
}

export function createPrivacyDescriptor(
  classification: PrivacyClassification = DEFAULT_PRIVACY_CLASSIFICATION,
  timestamp = nowIso(),
): PrivacyDescriptor {
  return {
    classification: assertPrivacyClassification(classification),
    classifiedAt: timestamp,
  };
}

export function createSyncMetadata(deviceId?: string): SyncMetadata {
  return {
    deviceId,
    localRevision: 1,
    syncState: DEFAULT_SYNC_STATE,
  };
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return typeof value !== 'number' || Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

export function assertJsonObject(value: unknown): JsonObject {
  if (!isJsonValue(value) || Array.isArray(value) || value === null || typeof value !== 'object') {
    throw new Error('Metadaten müssen ein gültiges JSON-Objekt sein.');
  }
  return value;
}

export function validateAttributeValue(type: AttributeValueType, value: JsonValue): void {
  if (!isJsonValue(value)) {
    throw new Error('Attributwert muss gültiges JSON sein.');
  }

  const builtInType = (BUILT_IN_ATTRIBUTE_VALUE_TYPES as readonly string[]).includes(type);
  const valid =
    (type === 'text' && typeof value === 'string') ||
    (type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (type === 'boolean' && typeof value === 'boolean') ||
    (type === 'datetime' && typeof value === 'string' && !Number.isNaN(Date.parse(value))) ||
    ((type === 'entity_reference' || type === 'term_reference') &&
      typeof value === 'string' &&
      value.trim().length > 0) ||
    type === 'json' ||
    !builtInType;

  if (!valid) {
    throw new Error(`Ungültiger Wert für Attributtyp „${type}“.`);
  }
}
