import type { AiOrchestrationPort } from '@/application/ports';
import { createApplicationServices } from '@/application/services';
import { initializeDatabase } from '@/data/database/initialize';
import { createRepositories } from '@/data/repositories/createRepositories';
import type {
  AIActionProposal,
  AIProposalKind,
  AIProposalReview,
  AIResponse,
  JsonObject,
} from '@/domain';
import { createTestDatabase } from '@/test/sqliteTestDatabase';

const GENERATED_AT = '2025-03-02T10:00:00.000Z';

function responseFor(
  text: string,
  options: {
    entityType?: string;
    entityTitle?: string;
    memoryType?: string;
    includeAttribute?: boolean;
    includeMemory?: boolean;
  } = {},
): AIResponse {
  const {
    entityType = 'device',
    entityTitle = 'Kühlschrank',
    memoryType = 'FACT',
    includeAttribute = true,
    includeMemory = true,
  } = options;
  const provenance = {
    source_kind: 'user_input',
    source_reference: 'raw-source',
    evidence_text: text,
    evidence_start: 0,
    evidence_end: text.length,
    provider_key: 'fake-local',
    provider_version: 'test.1',
    generated_at: GENERATED_AT,
  };
  const entityItem = {
    local_id: 'entity_fridge',
    kind: 'entity' as const,
    type_key: entityType,
    title: entityTitle,
    metadata: {},
    confidence: { score: 0.95 },
    provenance,
  };
  const attributeItem = {
    local_id: 'attribute_brand',
    kind: 'attribute' as const,
    type_key: 'brand',
    value: 'Bosch',
    source_local_id: entityItem.local_id,
    metadata: {},
    confidence: { score: 0.9 },
    provenance,
  };
  const memoryItem = {
    local_id: 'memory_fact',
    kind: 'memory' as const,
    type_key: memoryType,
    content: text,
    source_local_id: entityItem.local_id,
    metadata: { entity_local_ids: [entityItem.local_id] },
    confidence: { score: 0.85 },
    provenance,
  };

  function proposal(
    localId: string,
    targetKind: AIProposalKind,
    typeKey: string,
    payload: JsonObject,
  ): AIActionProposal {
    return {
      proposal_id: `proposal_${localId}`,
      action: targetKind === 'entity' ? 'refine' : 'create',
      target_kind: targetKind,
      type_key: typeKey,
      payload,
      depends_on: targetKind === 'entity' ? [] : [entityItem.local_id],
      confidence: { score: 0.9 },
      provenance,
      requires_user_confirmation: true,
    };
  }

  return {
    request_id: 'request_review_integration',
    extraction: {
      language: 'de',
      summary: 'Kühlschrank-Information',
      items: [
        entityItem,
        ...(includeAttribute ? [attributeItem] : []),
        ...(includeMemory ? [memoryItem] : []),
      ],
    },
    proposals: [
      proposal(entityItem.local_id, 'entity', entityItem.type_key, { title: entityTitle }),
      ...(includeAttribute
        ? [proposal(attributeItem.local_id, 'attribute', attributeItem.type_key, {
          value: attributeItem.value,
        })]
        : []),
      ...(includeMemory
        ? [proposal(memoryItem.local_id, 'memory', memoryItem.type_key, {
          content: memoryItem.content,
        })]
        : []),
    ],
    provider_provenance: provenance,
    validation_warnings: [],
  };
}

function correctionResponse(
  text: string,
  options: { previousRecordId?: string } = {},
): AIResponse {
  const provenance = {
    source_kind: 'user_input',
    source_reference: 'correction-source',
    evidence_text: text,
    evidence_start: 0,
    evidence_end: text.length,
    provider_key: 'fake-local',
    provider_version: 'bau03.2.patch.test',
    generated_at: GENERATED_AT,
  };
  const entity = {
    local_id: 'entity_invoice',
    kind: 'entity' as const,
    type_key: 'document',
    title: 'Rechnung',
    metadata: {},
    confidence: { score: 0.93 },
    provenance,
  };
  const previous = {
    local_id: 'attribute_price_previous',
    kind: 'attribute' as const,
    type_key: 'price',
    value: { amount: '899', currency: 'EUR', approximate: true },
    source_local_id: entity.local_id,
    metadata: {
      revision_status: 'superseded_claim',
      relation_type: 'REVISES',
      superseded_by_local_id: 'attribute_price_current',
    },
    confidence: { score: 0.4 },
    provenance,
  };
  const currentMetadata: JsonObject = {
    revision_status: 'current_claim',
    relation_type: 'REVISES',
    user_confirmed: false,
    ...(options.previousRecordId
      ? {
        revises_record_id: options.previousRecordId,
        revises_value: previous.value,
      }
      : {
        revises_local_id: previous.local_id,
        revises_value: previous.value,
      }),
  };
  const current = {
    local_id: 'attribute_price_current',
    kind: 'attribute' as const,
    type_key: 'price',
    value: { amount: '879', currency: 'EUR', approximate: false },
    source_local_id: entity.local_id,
    metadata: currentMetadata,
    confidence: { score: 0.78 },
    provenance,
  };
  const entityProposal: AIActionProposal = {
    proposal_id: `proposal_${entity.local_id}`,
    action: 'create',
    target_kind: 'entity',
    type_key: entity.type_key,
    payload: { title: entity.title, metadata: entity.metadata },
    depends_on: [],
    confidence: entity.confidence,
    provenance,
    requires_user_confirmation: true,
  };
  const currentProposal: AIActionProposal = {
    proposal_id: `proposal_${current.local_id}`,
    action: 'refine',
    target_kind: 'attribute',
    type_key: current.type_key,
    payload: {
      value: current.value,
      source_local_id: current.source_local_id,
      metadata: current.metadata,
    },
    depends_on: [entity.local_id, previous.local_id],
    confidence: current.confidence,
    provenance,
    requires_user_confirmation: true,
  };
  const items = options.previousRecordId ? [entity, current] : [entity, current, previous];
  const proposals: AIActionProposal[] = [
    entityProposal,
    currentProposal,
    ...(!options.previousRecordId
      ? [{
        ...currentProposal,
        proposal_id: `proposal_${previous.local_id}`,
        action: 'create' as const,
        payload: {
          value: previous.value,
          source_local_id: previous.source_local_id,
          metadata: previous.metadata,
        },
        depends_on: [entity.local_id],
        confidence: previous.confidence,
      }]
      : []),
  ];
  return {
    request_id: 'request_price_correction',
    extraction: { language: 'de', summary: 'Preiskorrektur', items },
    proposals,
    provider_provenance: provenance,
    validation_warnings: [],
  };
}

async function createSubject(
  text = 'Der Kühlschrank von Bosch steht in der Küche.',
  response = responseFor(text),
) {
  const db = await createTestDatabase();
  await initializeDatabase(db);
  const repositories = createRepositories(db);
  const ai: AiOrchestrationPort = {
    async interpret() {
      return response;
    },
  };
  const services = createApplicationServices(repositories, { ai });
  const result = await services.ingestNaturalLanguage({ text });
  if (!result.reviewId) throw new Error(`Review wurde nicht gespeichert: ${result.warnings.join(' | ')}`);
  const review = await services.getReview(result.reviewId);
  if (!review) throw new Error('Review wurde nicht gefunden.');
  return { db, repositories, services, result, review };
}

function proposalByKind(review: AIProposalReview, kind: AIProposalKind) {
  const proposal = review.proposals.find((candidate) => candidate.proposal.target_kind === kind);
  if (!proposal) throw new Error(`Vorschlag ${kind} fehlt.`);
  return proposal;
}

describe('BAU-03.1 Review unbestätigter AI-Vorschläge', () => {
  it('zeigt die tatsächlich gespeicherten Vorschläge zusammen mit dem Original an', async () => {
    const subject = await createSubject();
    try {
      const pending = await subject.services.listPendingReviews();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        extraction: {
          id: subject.result.reviewId,
          requestId: 'request_review_integration',
          sourceId: subject.result.source.id,
        },
        originalText: 'Der Kühlschrank von Bosch steht in der Küche.',
      });
      expect(pending[0]?.proposals.map((item) => ({
        kind: item.proposal.target_kind,
        status: item.status,
      }))).toEqual([
        { kind: 'entity', status: 'PENDING' },
        { kind: 'attribute', status: 'PENDING' },
        { kind: 'memory', status: 'PENDING' },
      ]);
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('lässt AI_PROPOSED und INFERRED bis zur Entscheidung unbestätigt', async () => {
    const subject = await createSubject();
    try {
      const entity = await subject.repositories.entities.getById(subject.result.entity.id);
      const attributes = await subject.repositories.entities.findAttributes(subject.result.entity.id);
      const memories = await subject.repositories.memories.listMemoriesForEntity(subject.result.entity.id);
      expect(entity?.status).toBe('AI_PROPOSED');
      expect(attributes[0]?.status).toBe('AI_PROPOSED');
      expect(memories[0]).toMatchObject({ status: 'INFERRED', userConfirmed: false });
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('bestätigt einen Vorschlag und übernimmt ihn als bestätigte Information', async () => {
    const subject = await createSubject();
    try {
      const proposal = proposalByKind(subject.review, 'entity');
      const confirmed = await subject.services.confirmProposal(proposal.id);
      const entity = await subject.repositories.entities.getById(proposal.resolvedRecordId!);
      expect(confirmed.status).toBe('CONFIRMED');
      expect(entity).toMatchObject({
        title: 'Kühlschrank',
        type: 'device',
        status: 'CONFIRMED',
        metadata: {
          aiReviewDecision: 'CONFIRMED',
          requiresUserConfirmation: false,
        },
      });
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('übernimmt bei Korrektur den geänderten Wert', async () => {
    const subject = await createSubject();
    try {
      const proposal = proposalByKind(subject.review, 'attribute');
      const correctedProposal: AIActionProposal = {
        ...proposal.proposal,
        payload: { ...proposal.proposal.payload, value: 'Siemens' },
      };
      const corrected = await subject.services.correctProposal(proposal.id, {
        proposal: correctedProposal,
        decisionNote: 'Marke korrigiert.',
      });
      const attributes = await subject.repositories.entities.findAttributes(subject.result.entity.id);
      expect(corrected).toMatchObject({ status: 'CORRECTED', decisionNote: 'Marke korrigiert.' });
      expect(attributes[0]).toMatchObject({
        id: proposal.resolvedRecordId,
        value: 'Siemens',
        status: 'CONFIRMED',
        metadata: { aiReviewDecision: 'CORRECTED' },
      });
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('verwirft einen Vorschlag ohne ihn zu bestätigen', async () => {
    const subject = await createSubject();
    try {
      const proposal = proposalByKind(subject.review, 'memory');
      const rejected = await subject.services.rejectProposal(proposal.id, 'Nicht übernehmen.');
      const memory = await subject.repositories.memories.getMemory(proposal.resolvedRecordId!);
      expect(rejected).toMatchObject({ status: 'REJECTED', decisionNote: 'Nicht übernehmen.' });
      expect(memory).toMatchObject({
        status: 'UNCONFIRMED',
        userConfirmed: false,
        verifiedAt: undefined,
        metadata: { aiReviewDecision: 'REJECTED' },
      });
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('behält Originaltext und Provenance nach der Bestätigung vollständig bei', async () => {
    const subject = await createSubject();
    try {
      const proposal = proposalByKind(subject.review, 'entity');
      await subject.services.confirmProposal(proposal.id);
      const sources = await subject.repositories.sources.findForRecord(subject.result.entity.id);
      const provenance = await subject.repositories.sources.findProvenance(subject.result.entity.id);
      expect(sources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: subject.result.source.id,
          type: 'user_input',
          isUserConfirmed: true,
          metadata: { originalText: 'Der Kühlschrank von Bosch steht in der Küche.' },
        }),
        expect.objectContaining({ type: 'ai_inference', isUserConfirmed: false }),
      ]));
      expect(provenance).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: subject.result.source.id }),
      ]));
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('bestätigt UNKNOWN ohne erzwungene Kategorie', async () => {
    const text = 'Ich weiß noch nicht, was dieser Gegenstand ist.';
    const subject = await createSubject(text, responseFor(text, {
      entityType: 'unknown.entity',
      entityTitle: 'Unbekannter Gegenstand',
      includeAttribute: false,
      includeMemory: false,
    }));
    try {
      const proposal = proposalByKind(subject.review, 'entity');
      await subject.services.confirmProposal(proposal.id);
      const entity = await subject.repositories.entities.getById(proposal.resolvedRecordId!);
      expect(entity).toMatchObject({
        type: 'unknown.entity',
        title: 'Unbekannter Gegenstand',
        status: 'CONFIRMED',
        isPlaceholder: true,
      });
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('behält offene Memory-Typen nach der Bestätigung normalisiert bei', async () => {
    const text = 'Ich muss den Kühlschrank reinigen.';
    const subject = await createSubject(text, responseFor(text, {
      memoryType: 'obligation',
      includeAttribute: false,
    }));
    try {
      const proposal = proposalByKind(subject.review, 'memory');
      await subject.services.confirmProposal(proposal.id);
      const row = await subject.db.getFirstAsync<{
        type_key: string;
        status: string;
        user_confirmed: number;
      }>(
        `SELECT type_key, status, user_confirmed
           FROM memories
          WHERE id = ?`,
        proposal.resolvedRecordId!,
      );

      expect(row).toMatchObject({
        type_key: 'OBLIGATION',
        status: 'CONFIRMED',
        user_confirmed: 1,
      });
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('verknüpft eine bestätigte Preiskorrektur über die bestehende REVISES-Architektur', async () => {
    const text = 'Die Rechnung war doch 879 Euro, nicht 899 Euro.';
    const subject = await createSubject(text, correctionResponse(text));
    try {
      const priceProposals = subject.review.proposals.filter(
        ({ proposal }) => proposal.target_kind === 'attribute' && proposal.type_key === 'price',
      );
      const current = priceProposals.find(
        ({ proposal }) => proposal.payload.metadata
          && typeof proposal.payload.metadata === 'object'
          && !Array.isArray(proposal.payload.metadata)
          && proposal.payload.metadata.revision_status === 'current_claim',
      );
      const previous = priceProposals.find((proposal) => proposal.id !== current?.id);
      if (!current?.resolvedRecordId || !previous?.resolvedRecordId) {
        throw new Error('Preisrevision wurde nicht materialisiert.');
      }

      const before = await subject.repositories.memories.listMemoriesForEntity(subject.result.entity.id);
      const currentMemory = before.find(
        (memory) => memory.metadata.linkedAttributeRecordId === current.resolvedRecordId,
      );
      const previousMemory = before.find(
        (memory) => memory.metadata.linkedAttributeRecordId === previous.resolvedRecordId,
      );
      expect(currentMemory).toMatchObject({ status: 'INFERRED', userConfirmed: false });
      expect(previousMemory).toMatchObject({ status: 'INFERRED', userConfirmed: false });
      expect(await subject.repositories.memories.listRelations(currentMemory!.id)).toEqual([
        expect.objectContaining({
          fromMemoryId: currentMemory!.id,
          toMemoryId: previousMemory!.id,
          type: 'REVISES',
        }),
      ]);

      await subject.services.confirmProposal(current.id);
      const attributes = await subject.repositories.entities.findAttributes(subject.result.entity.id);
      expect(attributes.find((attribute) => attribute.id === current.resolvedRecordId)).toMatchObject({
        value: { amount: '879', currency: 'EUR', approximate: false },
        status: 'CONFIRMED',
      });
      expect(attributes.find((attribute) => attribute.id === previous.resolvedRecordId)).toMatchObject({
        value: { amount: '899', currency: 'EUR', approximate: true },
        status: 'SUPERSEDED',
      });
      expect(await subject.repositories.memories.getMemory(currentMemory!.id)).toMatchObject({
        status: 'CONFIRMED',
        userConfirmed: true,
      });
      const refreshedReview = await subject.services.getReview(subject.result.reviewId!);
      const previousDecision = refreshedReview?.proposals.find(
        (proposal) => proposal.id === previous.id,
      );
      expect(previousDecision?.status).toBe('CONFIRMED');
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('liefert genau einen relevanten früheren Preis als Kontext für Ich meinte', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    const repositories = createRepositories(db);
    const invoice = await repositories.entities.create({
      id: 'entity_invoice_context',
      type: 'document',
      title: 'Rechnung',
      status: 'CONFIRMED',
    });
    const source = await repositories.sources.create({
      id: 'source_previous_price',
      type: 'user_input',
      title: 'Frühere Preisangabe',
      isUserConfirmed: false,
    });
    const previous = await repositories.entities.addAttribute(invoice.id, {
      id: 'attribute_previous_price',
      key: 'price',
      valueType: 'json',
      value: { amount: '899', currency: 'EUR', approximate: true },
      status: 'AI_PROPOSED',
      provenanceIds: [source.id],
    });
    let interpretedRequest: Parameters<AiOrchestrationPort['interpret']>[0] | undefined;
    const text = 'Ich meinte 879 Euro.';
    const ai: AiOrchestrationPort = {
      async interpret(request) {
        interpretedRequest = request;
        return correctionResponse(text, { previousRecordId: previous.id });
      },
    };
    const services = createApplicationServices(repositories, { ai });
    try {
      const result = await services.ingestNaturalLanguage({
        text,
        contextEntityIds: [invoice.id],
      });
      expect(interpretedRequest?.context?.metadata?.recent_attributes).toEqual([
        {
          record_id: previous.id,
          type_key: 'price',
          value: { amount: '899', currency: 'EUR', approximate: true },
          source_reference: source.id,
          entity_record_id: invoice.id,
          entity_type: invoice.type,
          entity_title: invoice.title,
        },
      ]);
      expect(result.interpretationStatus).toBe('applied');
      const review = await services.getReview(result.reviewId!);
      const correction = review?.proposals.find(
        ({ proposal }) => proposal.target_kind === 'attribute',
      );
      expect(correction?.proposal.payload.metadata).toMatchObject({
        revision_status: 'current_claim',
        revises_record_id: previous.id,
        user_confirmed: false,
      });
    } finally {
      await db.closeAsync();
    }
  });

  it('verwendet eine vorhandene Entity-Identität ohne Duplikat', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    const repositories = createRepositories(db);
    const existing = await repositories.entities.create({
      id: 'entity_existing_fridge',
      type: 'device',
      title: 'Kühlschrank',
      status: 'CONFIRMED',
    });
    const text = 'Der Kühlschrank wurde erneut erwähnt.';
    const ai: AiOrchestrationPort = {
      async interpret() {
        return responseFor(text, {
          entityType: 'device',
          entityTitle: 'Kühlschrank',
          includeAttribute: false,
          includeMemory: false,
        });
      },
    };
    const services = createApplicationServices(repositories, { ai });
    try {
      const result = await services.ingestNaturalLanguage({ text });
      const review = await services.getReview(result.reviewId!);
      if (!review) throw new Error('Review fehlt.');
      const proposal = proposalByKind(review, 'entity');
      const matches = await repositories.entities.search({ search: 'Kühlschrank', types: ['device'] });
      expect(result.entity.id).toBe(existing.id);
      expect(proposal.resolvedRecordId).toBe(existing.id);
      expect(matches.filter((entity) => entity.type === 'device')).toHaveLength(1);
    } finally {
      await db.closeAsync();
    }
  });
});
