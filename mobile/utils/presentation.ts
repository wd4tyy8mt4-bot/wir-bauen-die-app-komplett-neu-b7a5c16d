import type { EntityRecord } from '@/domain';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  task: 'Aufgabe',
  person: 'Person',
  organization: 'Organisation',
  organisation: 'Organisation',
  place: 'Ort',
  location: 'Ort',
  event: 'Ereignis',
  document: 'Dokument',
  memory: 'Erinnerung',
  information: 'Information',
  object: 'Gegenstand',
  device: 'Gerät',
  obligation: 'Verpflichtung',
  note: 'Notiz',
  entity: 'Eintrag',
  unknown: 'Information',
  'unknown.entity': 'Information',
};

const ENTITY_STATUS_LABELS: Record<string, string> = {
  AI_PROPOSED: 'Von deiner KI erkannt',
  CONFIRMED: 'Bestätigt',
  CORRECTED: 'Aktualisiert',
  INFERRED: 'Aus deinen Angaben erkannt',
  PENDING: 'Wartet auf Prüfung',
  TEMPORARY: 'Vorläufig gemerkt',
  UNCERTAIN: 'Bitte noch einmal prüfen',
  UNCONFIRMED: 'Noch nicht bestätigt',
};

const ATTRIBUTE_LABELS: Record<string, string> = {
  name: 'Name',
  title: 'Titel',
  description: 'Beschreibung',
  date: 'Datum',
  time: 'Uhrzeit',
  datetime: 'Zeitpunkt',
  start: 'Beginn',
  end: 'Ende',
  deadline: 'Fällig am',
  due_date: 'Fällig am',
  occurred_at: 'Zeitpunkt',
  location: 'Ort',
  address: 'Adresse',
  email: 'E-Mail',
  phone: 'Telefon',
  telephone: 'Telefon',
  website: 'Webseite',
  url: 'Webseite',
  role: 'Rolle',
  company: 'Organisation',
  organization: 'Organisation',
  organisation: 'Organisation',
  note: 'Notiz',
  notes: 'Notizen',
  category: 'Kategorie',
  amount: 'Betrag',
  currency: 'Währung',
  price: 'Preis',
  quantity: 'Anzahl',
  status: 'Status',
  priority: 'Priorität',
  birthday: 'Geburtstag',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  CONTAINS: 'Enthält',
  CONTRADICTS: 'Widerspricht',
  CREATED_BY: 'Erstellt von',
  LOCATED_AT: 'Befindet sich bei',
  MENTIONS: 'Erwähnt',
  PART_OF: 'Gehört zu',
  RELATED_TO: 'Steht in Verbindung mit',
  REVISES: 'Aktualisiert',
  WORKS_AT: 'Arbeitet bei',
};

const SOURCE_LABELS: Record<string, string> = {
  audio: 'Sprachaufnahme',
  voice: 'Sprachaufnahme',
  user_input: 'Eigene Eingabe',
  document: 'Dokument',
  text: 'Textnotiz',
  note: 'Notiz',
  import: 'Import',
  ai_inference: 'Aus deinen Angaben abgeleitet',
};

const ALIAS_LABELS: Record<string, string> = {
  alias: 'Weitere Bezeichnung',
  alternate: 'Alternativer Name',
  nickname: 'Spitzname',
  short_name: 'Kurzname',
  former_name: 'Frühere Bezeichnung',
  abbreviation: 'Abkürzung',
};

function normalizeCode(value: string): string {
  return value.trim().replace(/[.\s-]+/g, '_');
}

export function formatEntityType(type?: string): string {
  if (!type) return 'Information';
  return ENTITY_TYPE_LABELS[type.toLowerCase()] ?? 'Information';
}

export function formatEntityStatus(status?: string): string | undefined {
  if (!status) return undefined;
  return ENTITY_STATUS_LABELS[status.toUpperCase()] ?? 'Gespeichert';
}

export function formatAttributeLabel(key?: string, fallbackIndex?: number): string {
  if (!key) return fallbackIndex === undefined ? 'Weitere Angabe' : `Angabe ${fallbackIndex + 1}`;
  return ATTRIBUTE_LABELS[normalizeCode(key).toLowerCase()]
    ?? (fallbackIndex === undefined ? 'Weitere Angabe' : `Angabe ${fallbackIndex + 1}`);
}

export function formatRelationshipType(type?: string): string {
  if (!type) return 'Verbindung';
  return RELATIONSHIP_LABELS[normalizeCode(type).toUpperCase()] ?? 'Verbindung';
}

export function formatSourceType(type?: string): string {
  if (!type) return 'Quelle';
  return SOURCE_LABELS[normalizeCode(type).toLowerCase()] ?? 'Quelle';
}

export function formatAliasKind(kind?: string): string {
  if (!kind) return 'Weitere Bezeichnung';
  return ALIAS_LABELS[normalizeCode(kind).toLowerCase()] ?? 'Weitere Bezeichnung';
}

export function isVisibleKnowledge(entity: EntityRecord): boolean {
  const status = entity.status?.toUpperCase();
  return status !== 'AI_REJECTED' && status !== 'REJECTED';
}
