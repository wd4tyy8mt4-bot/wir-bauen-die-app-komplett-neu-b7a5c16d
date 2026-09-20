import type {
  AIRequest,
  AIResponse,
  CoreExportBundle,
  EntityRecord,
  JsonObject,
  StableId,
  SyncRecordEnvelope,
  TranscriptionRequest,
  TranscriptionResponse,
} from '@/domain';

export interface SyncPort {
  pushPendingChanges(): Promise<void>;
  pullRemoteChanges(): Promise<void>;
}

export interface SyncBoundaryPort extends SyncPort {
  collectPendingChanges(): Promise<SyncRecordEnvelope[]>;
  pushChanges(changes: SyncRecordEnvelope[]): Promise<{
    acceptedRecordIds: StableId[];
    conflictedRecordIds: StableId[];
  }>;
  pullChanges(cursor?: string): Promise<{ changes: SyncRecordEnvelope[]; cursor?: string }>;
  applyRemoteChanges(changes: SyncRecordEnvelope[]): Promise<void>;
}

export interface AiOrchestrationPort {
  interpret(request: AIRequest): Promise<AIResponse>;
}

export interface TranscriptionProvider {
  readonly key: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>;
}

export interface ExternalServicesPort {
  execute(serviceKey: string, payload: JsonObject): Promise<JsonObject>;
}

export interface ExportPort {
  exportRecords(entityIds?: StableId[]): Promise<{ uri: string; recordCount: number }>;
}

export interface StableExportPort extends ExportPort {
  buildBundle(): Promise<CoreExportBundle>;
}

export interface DynamicFeatureDefinition {
  key: string;
  title: string;
  description?: string;
  requiredEntityTypes?: string[];
}

export interface DynamicFeaturePort {
  listAvailableFeatures(context?: EntityRecord[]): Promise<DynamicFeatureDefinition[]>;
}

export interface ExtensionPorts {
  readonly sync?: SyncPort;
  readonly syncBoundary?: SyncBoundaryPort;
  readonly ai?: AiOrchestrationPort;
  readonly transcription?: TranscriptionProvider;
  readonly externalServices?: ExternalServicesPort;
  readonly exports?: ExportPort;
  readonly stableExports?: StableExportPort;
  readonly dynamicFeatures?: DynamicFeaturePort;
}
