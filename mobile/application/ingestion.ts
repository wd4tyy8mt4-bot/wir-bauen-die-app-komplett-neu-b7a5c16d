import { createStableId, normalizeAlias } from '@/domain';
import { UNKNOWN_ENTITY_TYPE } from '@/domain/constants';
import type { AiOrchestrationPort } from './ports';
import type {
  AIExtractionItem,
  AIProposalReview,
  AttributeValueType,
  EntityRecord,
  IngestNaturalLanguageInput,
  IngestNaturalLanguageResult,
  JsonObject,
  JsonValue,
  PersistedAIActionProposal,
  Repositories,
  StableId,
} from '@/domain';

import { validateAIResponse } from './aiValidation';

function titleFromText(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() || text;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

function attributeValueType(value: JsonValue): AttributeValueType {
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'json';
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function recentPriceContext(
  repositories: Repositories,
  capturedEntityId: StableId,
  contextEntityIds?: StableId[],
): Promise<JsonObject[]> {
  const candidateEntities = contextEntityIds?.length
    ? await Promise.all(contextEntityIds.map((id) => repositories.entities.getById(id)))
    : await repositories.entities.search({ limit: 8 });
  const entityIds = candidateEntities
    .filter((entity): entity is EntityRecord => Boolean(entity && entity.id !== capturedEntityId))
    .map((entity) => entity.id);
  const candidateDetails = await Promise.all(
    entityIds.map(async (entityId) => ({
      entity: await repositories.entities.getById(entityId),
      attributes: await repositories.entities.findAttributes(entityId),
    })),
  );
  const prices = candidateDetails.flatMap(({ entity, attributes }) =>
    attributes
      .filter((attribute) =>
        attribute.key === 'price'
        && attribute.status !== 'AI_REJECTED'
        && isJsonObject(attribute.value)
        && typeof attribute.value.amount === 'string'
        && typeof attribute.value.currency === 'string',
      )
      .map((attribute) => ({ attribute, entity })),
  );
  if (prices.length !== 1) return [];

  const { attribute: price, entity } = prices[0];
  const sources = await repositories.sources.findForRecord(price.id);
  return [{
    record_id: price.id,
    type_key: price.key,
    value: price.value,
    source_reference: sources.find((source) => source.type === 'user_input')?.id
      ?? sources[0]?.id
      ?? null,
    entity_record_id: entity?.id ?? null,
    entity_type: entity?.type ?? null,
    entity_title: entity?.title ?? null,
  }];
}

function factContent(typeKey: string, value: JsonValue): string {
  if (isJsonObject(value)
    && typeof value.amount === 'string'
    && typeof value.currency === 'string') {
    return `${typeKey}: ${value.amount} ${value.currency}`;
  }
  return `${typeKey}: ${typeof value === 'string' ? value : JSON.stringify(value)}`;
}

function referencedEntityIds(item: AIExtractionItem): string[] {
  const ids = new Set<string>();
  if (item.source_local_id) ids.add(item.source_local_id);
  if (item.target_local_id) ids.add(item.target_local_id);
  const metadataIds = item.metadata.entity_local_ids;
  if (Array.isArray(metadataIds)) {
    for (const id of metadataIds) {
      if (typeof id === 'string') ids.add(id);
    }
  }
  return [...ids];
}

function proposalForItem(
  review: AIProposalReview,
  item: AIExtractionItem,
): PersistedAIActionProposal | undefined {
  const matches = review.proposals.filter(({ proposal }) =>
    proposal.proposal_id === item.local_id
    || proposal.proposal_id === `proposal_${item.local_id}`
    || proposal.payload.local_id === item.local_id,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

async function setResolvedItemRecord(
  repositories: Repositories,
  proposalRowsByItemId: Map<string, PersistedAIActionProposal | undefined>,
  item: AIExtractionItem,
  recordId: StableId,
): Promise<void> {
  const row = proposalRowsByItemId.get(item.local_id);
  if (row) {
    await repositories.aiProposals.setResolvedRecord(row.id, recordId);
  }
}

async function findExactEntityIdentity(
  repositories: Repositories,
  item: AIExtractionItem,
): Promise<EntityRecord | undefined> {
  const title = item.title?.trim();
  if (!title) return undefined;

  const normalizedTitle = normalizeAlias(title);
  const [aliasIds, searched] = await Promise.all([
    repositories.aliases.findEntityIds(title),
    repositories.entities.search({ search: title, types: [item.type_key], limit: 200 }),
  ]);
  const candidateIds = new Set(aliasIds);
  for (const entity of searched) {
    if (entity.type === item.type_key && normalizeAlias(entity.title) === normalizedTitle) {
      candidateIds.add(entity.id);
    }
  }
  if (candidateIds.size !== 1) return undefined;

  const id = [...candidateIds][0];
  if (!id) return undefined;
  const entity = await repositories.entities.getById(id);
  return entity?.type === item.type_key ? entity : undefined;
}

export async function ingestNaturalLanguage(
  repositories: Repositories,
  ai: AiOrchestrationPort | undefined,
  input: IngestNaturalLanguageInput,
): Promise<IngestNaturalLanguageResult> {
  const text = input.text.trim();
  if (!text) {
    throw new Error('Bitte gib zuerst eine Information ein.');
  }

  const captured = await repositories.captures.captureUnknownText({
    text,
    title: titleFromText(text),
    capturedAt: input.capturedAt,
    captureMode: input.voiceSourceId ? 'voice' : 'text',
    upstreamSourceIds: input.voiceSourceId ? [input.voiceSourceId] : undefined,
  });
  const voiceAudioSource = input.voiceSourceId
    ? (await repositories.sources.findForRecord(captured.source.id))
      .find((source) => source.id === input.voiceSourceId)
    : undefined;
  const initialRecordIds = [
    captured.entity.id,
    captured.source.id,
    ...(voiceAudioSource ? [voiceAudioSource.id] : []),
  ];

  if (!ai) {
    return {
      ...captured,
      voiceAudioSource,
      interpretationStatus: 'local_capture_only',
      createdRecordIds: initialRecordIds,
      warnings: ['Die Rohinformation wurde sicher gespeichert; eine Interpretation war nicht verfügbar.'],
      pendingProposalCount: 0,
    };
  }

  let response;
  try {
    const priceContext = await recentPriceContext(
      repositories,
      captured.entity.id,
      input.contextEntityIds,
    );
    response = await ai.interpret({
      text,
      context: {
        language: 'de',
        context_entity_ids: input.contextEntityIds,
        source_reference: captured.source.id,
        metadata: {
          captured_entity_id: captured.entity.id,
          ...(priceContext.length === 1 ? { recent_attributes: priceContext } : {}),
          ...(voiceAudioSource ? {
            capture_mode: 'voice',
            voice_audio_source_id: voiceAudioSource.id,
            transcription_provider: input.transcription?.provider ?? null,
            transcription_status: input.transcription?.status ?? null,
          } : {}),
        },
      },
    });
    validateAIResponse(text, response);
  } catch {
    return {
      ...captured,
      voiceAudioSource,
      interpretationStatus: 'local_capture_only',
      createdRecordIds: initialRecordIds,
      warnings: ['Die Rohinformation wurde gespeichert. Die Interpretation konnte nicht angewendet werden.'],
      pendingProposalCount: 0,
    };
  }

  let review: AIProposalReview;
  try {
    review = await repositories.aiProposals.persistResponse({
      sourceId: captured.source.id,
      inputEntityId: captured.entity.id,
      response,
    });
  } catch {
    return {
      ...captured,
      voiceAudioSource,
      interpretationStatus: 'local_capture_only',
      createdRecordIds: initialRecordIds,
      warnings: ['Die Rohinformation wurde gespeichert. Die AI-Prüfdaten konnten nicht gespeichert werden.'],
      pendingProposalCount: 0,
    };
  }

  const pendingProposalCount = review.proposals.filter(
    (proposal) => proposal.status === 'PENDING',
  ).length;
  const proposalRowsByItemId = new Map(
    response.extraction.items.map((item) => [item.local_id, proposalForItem(review, item)]),
  );
  const createdRecordIds: StableId[] = [...initialRecordIds];
  const warnings = [...response.validation_warnings];
  const entityIds = new Map<string, StableId>();
  const attributeRecordIds = new Map<string, StableId>();
  let resultEntity = captured.entity;

  try {
    const scores = response.extraction.items.map((item) => item.confidence.score);
    const averageConfidence = scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : undefined;
    const aiSource = await repositories.sources.create({
      id: createStableId('ai_source'),
      type: 'ai_inference',
      title: 'Lokale AI-Interpretation',
      capturedAt: response.provider_provenance.generated_at,
      isAiInference: true,
      isUserConfirmed: false,
      confidence: averageConfidence,
      metadata: {
        requestId: response.request_id,
        providerKey: response.provider_provenance.provider_key,
        providerVersion: response.provider_provenance.provider_version,
        summary: response.extraction.summary ?? null,
      },
      provenanceIds: [captured.source.id],
      privacyClassification: captured.source.privacy.classification,
    });
    createdRecordIds.push(aiSource.id);
    const provenanceIds = [captured.source.id, aiSource.id];

    const entityItems = response.extraction.items.filter((item) => item.kind === 'entity');
    const primaryEntity = entityItems[0];
    if (primaryEntity) {
      const existingEntity = await findExactEntityIdentity(repositories, primaryEntity);
      if (existingEntity) {
        resultEntity = existingEntity;
        await repositories.sources.linkToRecord(existingEntity.id, captured.source.id, 'user_input');
        await repositories.sources.linkToRecord(existingEntity.id, aiSource.id, 'ai_inference');
      } else {
        resultEntity = await repositories.entities.refine(captured.entity.id, {
          type: primaryEntity.type_key,
          title: primaryEntity.title ?? captured.entity.title,
          description: captured.entity.description,
          status: 'AI_PROPOSED',
          metadata: {
            ...captured.entity.metadata,
            aiProposalLocalId: primaryEntity.local_id,
            aiConfidence: primaryEntity.confidence.score,
            refinementState: primaryEntity.type_key === UNKNOWN_ENTITY_TYPE
              ? 'unclassified'
              : 'proposed',
          },
          isPlaceholder: primaryEntity.type_key === UNKNOWN_ENTITY_TYPE,
        });
        await repositories.sources.linkToRecord(resultEntity.id, aiSource.id, 'ai_inference');
      }
      entityIds.set(primaryEntity.local_id, resultEntity.id);
      await setResolvedItemRecord(repositories, proposalRowsByItemId, primaryEntity, resultEntity.id);
    }

    for (const item of entityItems.slice(primaryEntity ? 1 : 0)) {
      const existingEntity = await findExactEntityIdentity(repositories, item);
      if (existingEntity) {
        entityIds.set(item.local_id, existingEntity.id);
        await repositories.sources.linkToRecord(existingEntity.id, captured.source.id, 'user_input');
        await repositories.sources.linkToRecord(existingEntity.id, aiSource.id, 'ai_inference');
        await setResolvedItemRecord(repositories, proposalRowsByItemId, item, existingEntity.id);
        continue;
      }

      const entity = await repositories.entities.create({
        id: createStableId(`ai_entity_${entityIds.size}`),
        type: item.type_key,
        title: item.title ?? 'Unbenannte Entität',
        description: item.content,
        status: 'AI_PROPOSED',
        metadata: {
          ...item.metadata,
          aiProposalLocalId: item.local_id,
          aiConfidence: item.confidence.score,
        },
        isPlaceholder: item.type_key === UNKNOWN_ENTITY_TYPE,
        provenanceIds,
        privacyClassification: captured.entity.privacy.classification,
      });
      entityIds.set(item.local_id, entity.id);
      createdRecordIds.push(entity.id);
      await setResolvedItemRecord(repositories, proposalRowsByItemId, item, entity.id);
    }

    for (const item of response.extraction.items) {
      if (item.kind === 'entity') continue;
      const sourceEntityId = item.source_local_id
        ? entityIds.get(item.source_local_id)
        : undefined;
      const targetEntityId = item.target_local_id
        ? entityIds.get(item.target_local_id)
        : undefined;

      if (item.kind === 'attribute') {
        if (!sourceEntityId || item.value === undefined) {
          warnings.push(`Attribut ${item.local_id} konnte nicht zugeordnet werden.`);
          continue;
        }
        const attribute = await repositories.entities.addAttribute(sourceEntityId, {
          id: createStableId(`ai_attribute_${createdRecordIds.length}`),
          key: item.type_key,
          valueType: attributeValueType(item.value),
          value: item.value,
          status: 'AI_PROPOSED',
          metadata: { ...item.metadata, aiConfidence: item.confidence.score },
          provenanceIds,
          privacyClassification: captured.entity.privacy.classification,
        });
        createdRecordIds.push(attribute.id);
        attributeRecordIds.set(item.local_id, attribute.id);
        await setResolvedItemRecord(repositories, proposalRowsByItemId, item, attribute.id);
        continue;
      }

      if (item.kind === 'alias') {
        if (!sourceEntityId || typeof item.value !== 'string') {
          warnings.push(`Alias ${item.local_id} konnte nicht zugeordnet werden.`);
          continue;
        }
        const alias = await repositories.aliases.create({
          id: createStableId(`ai_alias_${createdRecordIds.length}`),
          entityId: sourceEntityId,
          value: item.value,
          kind: item.type_key,
          provenanceIds,
          metadata: { ...item.metadata, aiConfidence: item.confidence.score },
          privacyClassification: captured.entity.privacy.classification,
        });
        createdRecordIds.push(alias.id);
        await setResolvedItemRecord(repositories, proposalRowsByItemId, item, alias.id);
        continue;
      }

      if (item.kind === 'relationship') {
        if (!sourceEntityId || !targetEntityId) {
          warnings.push(`Beziehung ${item.local_id} konnte nicht zugeordnet werden.`);
          continue;
        }
        const relationship = await repositories.relationships.create({
          id: createStableId(`ai_relationship_${createdRecordIds.length}`),
          type: item.type_key,
          sourceEntityId,
          targetEntityId,
          title: item.title,
          description: item.content,
          status: 'AI_PROPOSED',
          metadata: { ...item.metadata, aiConfidence: item.confidence.score },
          provenanceIds,
          privacyClassification: captured.entity.privacy.classification,
        });
        createdRecordIds.push(relationship.id);
        await setResolvedItemRecord(repositories, proposalRowsByItemId, item, relationship.id);
        continue;
      }

      if (item.kind === 'event') {
        const event = await repositories.events.create({
          id: createStableId(`ai_event_${createdRecordIds.length}`),
          type: item.type_key,
          title: item.title ?? titleFromText(item.content ?? text),
          description: item.content,
          status: 'AI_PROPOSED',
          actorEntityId: sourceEntityId,
          subjectEntityIds: referencedEntityIds(item)
            .map((localId) => entityIds.get(localId))
            .filter((id): id is StableId => Boolean(id)),
          payload: item.value && typeof item.value === 'object' && !Array.isArray(item.value)
            ? item.value as JsonObject
            : item.value === undefined
              ? {}
              : { value: item.value },
          metadata: { ...item.metadata, aiConfidence: item.confidence.score },
          provenanceIds,
          privacyClassification: captured.entity.privacy.classification,
        });
        createdRecordIds.push(event.id);
        await setResolvedItemRecord(repositories, proposalRowsByItemId, item, event.id);
        continue;
      }

      if (item.kind === 'memory') {
        const memory = await repositories.memories.createMemory({
          id: createStableId(`ai_memory_${createdRecordIds.length}`),
          content: item.content ?? text,
          type: item.type_key,
          status: 'INFERRED',
          confidence: item.confidence.score,
          userConfirmed: false,
          entityIds: referencedEntityIds(item)
            .map((localId) => entityIds.get(localId))
            .filter((id): id is StableId => Boolean(id)),
          metadata: {
            ...item.metadata,
            aiProposalLocalId: item.local_id,
            requiresUserConfirmation: true,
          },
          provenanceIds,
          privacyClassification: captured.entity.privacy.classification,
        });
        createdRecordIds.push(memory.id);
        await setResolvedItemRecord(repositories, proposalRowsByItemId, item, memory.id);
      }
    }

    for (const item of response.extraction.items) {
      if (item.kind !== 'attribute' || item.metadata.revision_status !== 'current_claim') {
        continue;
      }
      const currentAttributeId = attributeRecordIds.get(item.local_id);
      const previousLocalId = typeof item.metadata.revises_local_id === 'string'
        ? item.metadata.revises_local_id
        : undefined;
      const previousAttributeId = previousLocalId
        ? attributeRecordIds.get(previousLocalId)
        : typeof item.metadata.revises_record_id === 'string'
          ? item.metadata.revises_record_id
          : undefined;
      const previousItem = previousLocalId
        ? response.extraction.items.find((candidate) => candidate.local_id === previousLocalId)
        : undefined;
      const previousValue = previousItem?.value ?? item.metadata.revises_value;
      const currentEntityId = item.source_local_id
        ? entityIds.get(item.source_local_id)
        : undefined;
      if (!currentAttributeId || !previousAttributeId || item.value === undefined
        || previousValue === undefined) {
        warnings.push(`Revision ${item.local_id} konnte nicht vollständig verknüpft werden.`);
        continue;
      }

      const previousSources = await repositories.sources.findForRecord(previousAttributeId);
      const previousMemory = await repositories.memories.createMemory({
        id: createStableId(`ai_revision_previous_${createdRecordIds.length}`),
        content: factContent(item.type_key, previousValue),
        type: 'FACT',
        status: 'INFERRED',
        confidence: previousItem?.confidence.score,
        userConfirmed: false,
        entityIds: currentEntityId ? [currentEntityId] : [],
        metadata: {
          revisionStatus: 'superseded_claim',
          linkedAttributeRecordId: previousAttributeId,
          aiProposalLocalId: previousLocalId ?? null,
        },
        provenanceIds: previousSources.map((source) => source.id),
        privacyClassification: captured.entity.privacy.classification,
      });
      const currentMemory = await repositories.memories.createRevision(previousMemory.id, {
        id: createStableId(`ai_revision_current_${createdRecordIds.length + 1}`),
        content: factContent(item.type_key, item.value),
        type: 'FACT',
        status: 'INFERRED',
        confidence: item.confidence.score,
        userConfirmed: false,
        entityIds: currentEntityId ? [currentEntityId] : [],
        relationType: 'REVISES',
        relationNote: 'Durch lokale semantische Korrekturerkennung vorgeschlagen.',
        relationMetadata: {
          previousAttributeRecordId: previousAttributeId,
          currentAttributeRecordId: currentAttributeId,
          revisionGroup: item.metadata.revision_group ?? null,
          requiresUserConfirmation: true,
        },
        metadata: {
          revisionStatus: 'current_claim',
          linkedAttributeRecordId: currentAttributeId,
          previousAttributeRecordId: previousAttributeId,
          aiProposalLocalId: item.local_id,
          requiresUserConfirmation: true,
        },
        provenanceIds,
        privacyClassification: captured.entity.privacy.classification,
      });
      createdRecordIds.push(previousMemory.id, currentMemory.id);
    }

    return {
      entity: resultEntity,
      source: captured.source,
      voiceAudioSource,
      interpretationStatus: 'applied',
      createdRecordIds,
      warnings,
      reviewId: review.extraction.id,
      pendingProposalCount,
    };
  } catch {
    return {
      entity: resultEntity,
      source: captured.source,
      voiceAudioSource,
      interpretationStatus: createdRecordIds.length > initialRecordIds.length
        ? 'partially_applied'
        : 'local_capture_only',
      createdRecordIds,
      warnings: [
        ...warnings,
        'Die Rohinformation wurde gespeichert; einige Vorschläge konnten nicht vollständig übernommen werden.',
      ],
      reviewId: review.extraction.id,
      pendingProposalCount,
    };
  }
}
