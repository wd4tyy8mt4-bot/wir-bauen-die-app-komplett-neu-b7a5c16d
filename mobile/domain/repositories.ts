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
  EntityMemorySnapshot,
  EventInput,
  EventRecord,
  MemoryInput,
  MemoryQuery,
  MemoryRecord,
  MemoryRelationRecord,
  MemoryRevisionInput,
  MemoryUpdateInput,
  PersonalAlias,
  PrivacyDescriptor,
  PrivacyReclassificationInput,
  RecordProvenanceLink,
  RelationshipInput,
  RelationshipRecord,
  RelationshipTypeDefinition,
  RelationshipTypeInput,
  SourceInput,
  SemanticMemorySearchRequest,
  SemanticMemorySearchResult,
  SourceRecord,
  StableId,
  VocabularyTerm,
  VocabularyTermInput,
} from './model';
import type {
  AIProposalReview,
  CorrectAIActionProposalInput,
  PersistAIResponseInput,
  PersistedAIActionProposal,
} from './ai';

export interface EntityRepository {
  create(draft: EntityDraft): Promise<EntityRecord>;
  getById(id: StableId): Promise<EntityRecord | null>;
  getDetails(id: StableId): Promise<EntityDetails | null>;
  search(query?: EntityQuery): Promise<EntityRecord[]>;
  refine(id: StableId, input: EntityRefinementInput): Promise<EntityRecord>;
  addAttribute(entityId: StableId, input: AttributeInput): Promise<AttributeValueRecord>;
  findAttributes(entityId: StableId): Promise<AttributeValueRecord[]>;
}

export interface RelationshipRepository {
  create(input: RelationshipInput): Promise<RelationshipRecord>;
  findForEntity(entityId: StableId): Promise<RelationshipRecord[]>;
  createType(input: RelationshipTypeInput): Promise<RelationshipTypeDefinition>;
  listTypes(): Promise<RelationshipTypeDefinition[]>;
}

export interface EventRepository {
  create(input: EventInput): Promise<EventRecord>;
  findForEntity(entityId: StableId): Promise<EventRecord[]>;
}

export interface SourceRepository {
  create(input: SourceInput): Promise<SourceRecord>;
  linkToRecord(recordId: StableId, sourceId: StableId, role?: string): Promise<void>;
  findForRecord(recordId: StableId): Promise<SourceRecord[]>;
  findProvenance(recordId: StableId): Promise<RecordProvenanceLink[]>;
}

export interface VocabularyRepository {
  addTerm(input: VocabularyTermInput): Promise<VocabularyTerm>;
  listTerms(vocabularyKey: string): Promise<VocabularyTerm[]>;
}

export interface AliasRepository {
  create(input: AliasInput): Promise<PersonalAlias>;
  findEntityIds(value: string): Promise<StableId[]>;
  findForEntity(entityId: StableId): Promise<PersonalAlias[]>;
}

export interface MemoryRepository {
  createMemory(input: MemoryInput): Promise<MemoryRecord>;
  getMemory(id: StableId): Promise<MemoryRecord | null>;
  updateMemory(id: StableId, input: MemoryUpdateInput): Promise<MemoryRecord>;
  confirmMemory(id: StableId, verifiedAt?: string): Promise<MemoryRecord>;
  markAsUncertain(id: StableId): Promise<MemoryRecord>;
  markAsInferred(id: StableId): Promise<MemoryRecord>;
  markAsTemporary(id: StableId): Promise<MemoryRecord>;
  makePersistent(id: StableId): Promise<MemoryRecord>;
  attachSource(memoryId: StableId, sourceId: StableId, role?: string): Promise<MemoryRecord>;
  attachEntity(memoryId: StableId, entityId: StableId): Promise<MemoryRecord>;
  attachEvent(memoryId: StableId, eventId: StableId): Promise<MemoryRecord>;
  attachRelationship(memoryId: StableId, relationshipId: StableId): Promise<MemoryRecord>;
  detachEntity(memoryId: StableId, entityId: StableId): Promise<MemoryRecord>;
  moveEntityAttachment(
    memoryId: StableId,
    fromEntityId: StableId,
    toEntityId: StableId,
  ): Promise<MemoryRecord>;
  createRevision(previousMemoryId: StableId, input: MemoryRevisionInput): Promise<MemoryRecord>;
  listRelations(memoryId: StableId): Promise<MemoryRelationRecord[]>;
  listMemoriesForEntity(entityId: StableId): Promise<MemoryRecord[]>;
  listMemoriesByStatus(status: string): Promise<MemoryRecord[]>;
  listMemoriesByType(type: string): Promise<MemoryRecord[]>;
  searchMemories(query: MemoryQuery): Promise<MemoryRecord[]>;
  buildEntitySnapshot(entityId: StableId): Promise<EntityMemorySnapshot | null>;
}

export interface AIProposalRepository {
  persistResponse(input: PersistAIResponseInput): Promise<AIProposalReview>;
  setResolvedRecord(
    proposalId: StableId,
    resolvedRecordId: StableId,
  ): Promise<PersistedAIActionProposal>;
  listPendingReviews(): Promise<AIProposalReview[]>;
  getReview(extractionId: StableId): Promise<AIProposalReview | null>;
  confirm(proposalId: StableId): Promise<PersistedAIActionProposal>;
  correct(
    proposalId: StableId,
    input: CorrectAIActionProposalInput,
  ): Promise<PersistedAIActionProposal>;
  reject(proposalId: StableId, decisionNote?: string): Promise<PersistedAIActionProposal>;
}

export interface SemanticMemorySearchAdapter {
  search(request: SemanticMemorySearchRequest): Promise<SemanticMemorySearchResult[]>;
}

export interface PrivacyRepository {
  reclassify(
    recordId: StableId,
    input: PrivacyReclassificationInput,
  ): Promise<PrivacyDescriptor>;
}

export interface ExportRepository {
  buildCoreBundle(): Promise<CoreExportBundle>;
}

export interface CaptureUnknownTextInput {
  text: string;
  title: string;
  capturedAt?: string;
  captureMode?: 'text' | 'voice';
  upstreamSourceIds?: StableId[];
}

export interface CaptureRepository {
  captureUnknownText(
    input: CaptureUnknownTextInput,
  ): Promise<{ entity: EntityRecord; source: SourceRecord }>;
}

export interface Repositories {
  entities: EntityRepository;
  relationships: RelationshipRepository;
  events: EventRepository;
  sources: SourceRepository;
  vocabularies: VocabularyRepository;
  aliases: AliasRepository;
  memories: MemoryRepository;
  privacy: PrivacyRepository;
  exports: ExportRepository;
  captures: CaptureRepository;
  aiProposals: AIProposalRepository;
}
