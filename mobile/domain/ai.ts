import type {
  EntityRecord,
  IsoTimestamp,
  JsonObject,
  JsonValue,
  SourceRecord,
  StableId,
  TranscriptionResponse,
} from './model';

export type AIProposalKind =
  | 'entity'
  | 'attribute'
  | 'relationship'
  | 'event'
  | 'memory'
  | 'alias';

export interface AIConfidence {
  score: number;
  rationale?: string;
}

export interface AIProvenance {
  source_kind: string;
  source_reference?: string;
  evidence_text: string;
  evidence_start: number;
  evidence_end: number;
  provider_key: string;
  provider_version: string;
  generated_at: IsoTimestamp;
}

export interface AIContext {
  language?: string;
  context_entity_ids?: StableId[];
  request_id?: string;
  source_reference?: string;
  metadata?: JsonObject;
}

export interface AIRequest {
  text: string;
  context?: AIContext;
}

export interface AIExtractionItem {
  local_id: string;
  kind: AIProposalKind;
  type_key: string;
  title?: string;
  content?: string;
  value?: JsonValue;
  source_local_id?: string;
  target_local_id?: string;
  metadata: JsonObject;
  confidence: AIConfidence;
  provenance: AIProvenance;
}

export interface AIExtraction {
  items: AIExtractionItem[];
  language: string;
  summary?: string;
}

export interface AIActionProposal {
  proposal_id: string;
  action: 'create' | 'refine' | 'link';
  target_kind: AIProposalKind;
  type_key: string;
  payload: JsonObject;
  depends_on: string[];
  confidence: AIConfidence;
  provenance: AIProvenance;
  requires_user_confirmation: boolean;
}

export interface AIResponse {
  request_id: string;
  extraction: AIExtraction;
  proposals: AIActionProposal[];
  provider_provenance: AIProvenance;
  validation_warnings: string[];
}

export type AIProposalReviewStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CORRECTED'
  | 'REJECTED';

export interface PersistedAIExtraction {
  id: StableId;
  requestId: string;
  sourceId: StableId;
  inputEntityId: StableId;
  extraction: AIExtraction;
  providerProvenance: AIProvenance;
  validationWarnings: string[];
  createdAt: IsoTimestamp;
}

export interface PersistedAIActionProposal {
  id: StableId;
  extractionId: StableId;
  proposal: AIActionProposal;
  status: AIProposalReviewStatus;
  resolvedRecordId?: StableId;
  correctedProposal?: AIActionProposal;
  decisionNote?: string;
  decidedAt?: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface AIProposalReview {
  extraction: PersistedAIExtraction;
  proposals: PersistedAIActionProposal[];
  originalText: string;
}

export interface PersistAIResponseInput {
  sourceId: StableId;
  inputEntityId: StableId;
  response: AIResponse;
}

export interface CorrectAIActionProposalInput {
  proposal: AIActionProposal;
  decisionNote?: string;
}

export interface IngestNaturalLanguageInput {
  text: string;
  capturedAt?: IsoTimestamp;
  contextEntityIds?: StableId[];
  voiceSourceId?: StableId;
  transcription?: TranscriptionResponse;
}

export interface IngestNaturalLanguageResult {
  entity: EntityRecord;
  source: SourceRecord;
  voiceAudioSource?: SourceRecord;
  interpretationStatus: 'applied' | 'partially_applied' | 'local_capture_only';
  createdRecordIds: StableId[];
  warnings: string[];
  reviewId?: StableId;
  pendingProposalCount: number;
}
