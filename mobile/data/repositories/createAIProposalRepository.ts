import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  AIActionProposal,
  AIProposalRepository,
  AIProposalReview,
  AIProposalReviewStatus,
  CorrectAIActionProposalInput,
  JsonObject,
  JsonValue,
  PersistAIResponseInput,
  PersistedAIActionProposal,
  PersistedAIExtraction,
  StableId,
} from '@/domain';
import {
  createStableId,
  normalizeAlias,
  normalizeMemoryType,
  nowIso,
} from '@/domain';

interface ExtractionRow {
  id: string;
  request_id: string;
  source_id: string;
  input_entity_id: string;
  extraction_json: string;
  provider_provenance_json: string;
  validation_warnings_json: string;
  created_at: string;
}

interface AttributeRevisionTarget {
  previousRecordId: StableId;
  previousProposalId?: StableId;
}

interface ProposalRow {
  id: string;
  extraction_id: string;
  proposal_json: string;
  status: AIProposalReviewStatus;
  resolved_record_id: string | null;
  corrected_proposal_json: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error('Beschädigte AI-Review-Daten in der lokalen Datenbank.');
  }
}

function mapExtraction(row: ExtractionRow): PersistedAIExtraction {
  return {
    id: row.id,
    requestId: row.request_id,
    sourceId: row.source_id,
    inputEntityId: row.input_entity_id,
    extraction: parseJson(row.extraction_json, { items: [], language: 'de' }),
    providerProvenance: parseJson(row.provider_provenance_json, {
      source_kind: 'ai_inference',
      evidence_text: '',
      evidence_start: 0,
      evidence_end: 0,
      provider_key: 'unknown',
      provider_version: 'unknown',
      generated_at: row.created_at,
    }),
    validationWarnings: parseJson<string[]>(row.validation_warnings_json, []),
    createdAt: row.created_at,
  };
}

function mapProposal(row: ProposalRow): PersistedAIActionProposal {
  return {
    id: row.id,
    extractionId: row.extraction_id,
    proposal: parseJson<AIActionProposal>(row.proposal_json, {} as AIActionProposal),
    status: row.status,
    resolvedRecordId: row.resolved_record_id ?? undefined,
    correctedProposal: row.corrected_proposal_json
      ? parseJson<AIActionProposal>(row.corrected_proposal_json, {} as AIActionProposal)
      : undefined,
    decisionNote: row.decision_note ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function reviewMetadata(metadata: JsonObject, decision: AIProposalReviewStatus): JsonObject {
  return {
    ...metadata,
    aiReviewDecision: decision,
    requiresUserConfirmation: false,
  };
}

function valueColumns(value: JsonValue): {
  valueType: string;
  textValue: string | null;
  numberValue: number | null;
  booleanValue: number | null;
  jsonValue: string | null;
} {
  if (typeof value === 'string') {
    return { valueType: 'text', textValue: value, numberValue: null, booleanValue: null, jsonValue: null };
  }
  if (typeof value === 'number') {
    return { valueType: 'number', textValue: null, numberValue: value, booleanValue: null, jsonValue: null };
  }
  if (typeof value === 'boolean') {
    return { valueType: 'boolean', textValue: null, numberValue: null, booleanValue: value ? 1 : 0, jsonValue: null };
  }
  return {
    valueType: 'json',
    textValue: null,
    numberValue: null,
    booleanValue: null,
    jsonValue: JSON.stringify(value),
  };
}

class SQLiteAIProposalRepository implements AIProposalRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async persistResponse(input: PersistAIResponseInput): Promise<AIProposalReview> {
    const extractionId = createStableId('ai_extraction');
    const timestamp = nowIso();

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO ai_extractions (
          id, request_id, source_id, input_entity_id, language, summary,
          extraction_json, provider_provenance_json, validation_warnings_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        extractionId,
        input.response.request_id,
        input.sourceId,
        input.inputEntityId,
        input.response.extraction.language,
        input.response.extraction.summary ?? null,
        JSON.stringify(input.response.extraction),
        JSON.stringify(input.response.provider_provenance),
        JSON.stringify(input.response.validation_warnings),
        timestamp,
      );

      for (const proposal of input.response.proposals) {
        await this.db.runAsync(
          `INSERT INTO ai_action_proposals (
            id, extraction_id, proposal_id, action, target_kind, type_key,
            proposal_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
          `${extractionId}_${proposal.proposal_id}`,
          extractionId,
          proposal.proposal_id,
          proposal.action,
          proposal.target_kind,
          proposal.type_key,
          JSON.stringify(proposal),
          timestamp,
          timestamp,
        );
      }
    });

    const review = await this.getReview(extractionId);
    if (!review) {
      throw new Error('Die AI-Review-Daten konnten nicht gespeichert werden.');
    }
    return review;
  }

  async setResolvedRecord(
    proposalId: StableId,
    resolvedRecordId: StableId,
  ): Promise<PersistedAIActionProposal> {
    const timestamp = nowIso();
    const result = await this.db.runAsync(
      `UPDATE ai_action_proposals
       SET resolved_record_id = ?, updated_at = ?
       WHERE id = ? AND status = 'PENDING'`,
      resolvedRecordId,
      timestamp,
      proposalId,
    );
    if (result.changes !== 1) {
      throw new Error('Der AI-Vorschlag wurde nicht gefunden oder bereits entschieden.');
    }
    return this.requireProposal(proposalId);
  }

  async listPendingReviews(): Promise<AIProposalReview[]> {
    const rows = await this.db.getAllAsync<ExtractionRow>(
      `SELECT e.* FROM ai_extractions e
       WHERE EXISTS (
         SELECT 1 FROM ai_action_proposals p
         WHERE p.extraction_id = e.id AND p.status = 'PENDING'
       )
       ORDER BY e.created_at DESC`,
    );
    return Promise.all(rows.map((row) => this.buildReview(row)));
  }

  async getReview(extractionId: StableId): Promise<AIProposalReview | null> {
    const row = await this.db.getFirstAsync<ExtractionRow>(
      'SELECT * FROM ai_extractions WHERE id = ?',
      extractionId,
    );
    return row ? this.buildReview(row) : null;
  }

  async confirm(proposalId: StableId): Promise<PersistedAIActionProposal> {
    return this.decide(proposalId, 'CONFIRMED');
  }

  async correct(
    proposalId: StableId,
    input: CorrectAIActionProposalInput,
  ): Promise<PersistedAIActionProposal> {
    return this.decide(proposalId, 'CORRECTED', input.proposal, input.decisionNote);
  }

  async reject(proposalId: StableId, decisionNote?: string): Promise<PersistedAIActionProposal> {
    return this.decide(proposalId, 'REJECTED', undefined, decisionNote);
  }

  private async decide(
    proposalId: StableId,
    decision: AIProposalReviewStatus,
    correctedProposal?: AIActionProposal,
    decisionNote?: string,
  ): Promise<PersistedAIActionProposal> {
    const current = await this.requireProposal(proposalId);
    if (current.status !== 'PENDING') {
      throw new Error('Dieser AI-Vorschlag wurde bereits entschieden.');
    }

    const effectiveProposal = correctedProposal ?? current.proposal;
    const resolvedRecordId = current.resolvedRecordId
      ?? await this.findExistingEntity(effectiveProposal);
    if (!resolvedRecordId) {
      throw new Error('Der vorgeschlagene Datensatz konnte nicht zugeordnet werden.');
    }

    const revisionTarget = await this.resolveAttributeRevision(current, effectiveProposal);
    const timestamp = nowIso();
    await this.db.withTransactionAsync(async () => {
      await this.applyDecisionToRecord(resolvedRecordId, effectiveProposal, decision, timestamp);
      if (revisionTarget) {
        await this.applyRevisionDecision(
          resolvedRecordId,
          revisionTarget,
          decision,
          timestamp,
        );
      }
      const result = await this.db.runAsync(
        `UPDATE ai_action_proposals SET
          status = ?, corrected_proposal_json = ?, decision_note = ?, decided_at = ?,
          updated_at = ?, resolved_record_id = ?
         WHERE id = ? AND status = 'PENDING'`,
        decision,
        correctedProposal ? JSON.stringify(correctedProposal) : null,
        decisionNote ?? null,
        timestamp,
        timestamp,
        resolvedRecordId,
        proposalId,
      );
      if (result.changes !== 1) {
        throw new Error('Der AI-Vorschlag wurde zwischenzeitlich bereits entschieden.');
      }
      await this.touchRecord(resolvedRecordId, timestamp);
      await this.updateLinkedRevisionMemories(resolvedRecordId, decision, timestamp);
    });

    return this.requireProposal(proposalId);
  }

  private async resolveAttributeRevision(
    current: PersistedAIActionProposal,
    proposal: AIActionProposal,
  ): Promise<AttributeRevisionTarget | undefined> {
    if (proposal.target_kind !== 'attribute') return undefined;
    const metadata = proposal.payload.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || metadata.revision_status !== 'current_claim') {
      return undefined;
    }
    if (typeof metadata.revises_record_id === 'string') {
      return { previousRecordId: metadata.revises_record_id };
    }
    if (typeof metadata.revises_local_id !== 'string') return undefined;

    const sibling = await this.db.getFirstAsync<ProposalRow>(
      `SELECT * FROM ai_action_proposals
       WHERE extraction_id = ? AND proposal_id = ?`,
      current.extractionId,
      `proposal_${metadata.revises_local_id}`,
    );
    if (!sibling?.resolved_record_id) return undefined;
    return {
      previousRecordId: sibling.resolved_record_id,
      previousProposalId: sibling.id,
    };
  }

  private async applyRevisionDecision(
    currentRecordId: StableId,
    target: AttributeRevisionTarget,
    decision: AIProposalReviewStatus,
    timestamp: string,
  ): Promise<void> {
    const accepted = decision === 'CONFIRMED' || decision === 'CORRECTED';
    if (!accepted && !target.previousProposalId) return;

    const previousMetadata = await this.metadataFor(
      'attribute_values',
      target.previousRecordId,
    );
    await this.db.runAsync(
      `UPDATE attribute_values SET status = ?, metadata_json = ? WHERE id = ?`,
      accepted ? 'SUPERSEDED' : 'AI_REJECTED',
      JSON.stringify({
        ...previousMetadata,
        revisionStatus: accepted ? 'superseded' : 'unchanged',
        ...(accepted ? { supersededByRecordId: currentRecordId } : {}),
        requiresUserConfirmation: false,
        aiReviewDecision: accepted ? decision : 'REJECTED',
      }),
      target.previousRecordId,
    );
    await this.touchRecord(target.previousRecordId, timestamp);

    if (target.previousProposalId) {
      const siblingDecision = accepted ? 'CONFIRMED' : 'REJECTED';
      await this.db.runAsync(
        `UPDATE ai_action_proposals SET status = ?, decision_note = ?, decided_at = ?,
          updated_at = ? WHERE id = ? AND status = 'PENDING'`,
        siblingDecision,
        accepted
          ? 'Durch die bestätigte Korrektur als frühere Angabe bewahrt.'
          : 'Gemeinsam mit der Korrektur verworfen.',
        timestamp,
        timestamp,
        target.previousProposalId,
      );
    }
  }

  private async updateLinkedRevisionMemories(
    attributeRecordId: StableId,
    decision: AIProposalReviewStatus,
    timestamp: string,
  ): Promise<void> {
    const rows = await this.db.getAllAsync<{ id: string; metadata_json: string }>(
      `SELECT m.id, m.metadata_json
       FROM memories m
       JOIN records r ON r.id = m.id
       WHERE r.deleted_at IS NULL`,
    );
    for (const row of rows) {
      const metadata = parseJson<JsonObject>(row.metadata_json, {});
      if (metadata.linkedAttributeRecordId !== attributeRecordId
        || metadata.revisionStatus !== 'current_claim') {
        continue;
      }
      const confirmed = decision === 'CONFIRMED' || decision === 'CORRECTED';
      await this.db.runAsync(
        `UPDATE memories SET status = ?, user_confirmed = ?, verified_at = ?,
          metadata_json = ? WHERE id = ?`,
        confirmed ? 'CONFIRMED' : 'UNCONFIRMED',
        confirmed ? 1 : 0,
        confirmed ? timestamp : null,
        JSON.stringify(reviewMetadata(metadata, decision)),
        row.id,
      );
      await this.touchRecord(row.id, timestamp);
    }
  }

  private async buildReview(row: ExtractionRow): Promise<AIProposalReview> {
    const [proposalRows, source] = await Promise.all([
      this.db.getAllAsync<ProposalRow>(
        `SELECT * FROM ai_action_proposals
         WHERE extraction_id = ? ORDER BY created_at, rowid`,
        row.id,
      ),
      this.db.getFirstAsync<{ metadata_json: string }>(
        'SELECT metadata_json FROM sources WHERE id = ?',
        row.source_id,
      ),
    ]);
    const sourceMetadata = parseJson<JsonObject>(source?.metadata_json ?? null, {});
    const originalText = typeof sourceMetadata.originalText === 'string'
      ? sourceMetadata.originalText
      : '';
    return {
      extraction: mapExtraction(row),
      proposals: proposalRows.map(mapProposal),
      originalText,
    };
  }

  private async requireProposal(id: StableId): Promise<PersistedAIActionProposal> {
    const row = await this.db.getFirstAsync<ProposalRow>(
      'SELECT * FROM ai_action_proposals WHERE id = ?',
      id,
    );
    if (!row) {
      throw new Error('Der AI-Vorschlag wurde nicht gefunden.');
    }
    return mapProposal(row);
  }

  private async findExistingEntity(proposal: AIActionProposal): Promise<StableId | undefined> {
    if (proposal.target_kind !== 'entity') {
      return undefined;
    }
    const title = proposal.payload.title;
    if (typeof title !== 'string' || !title.trim()) {
      return undefined;
    }
    const normalized = normalizeAlias(title);
    const row = await this.db.getFirstAsync<{ id: string }>(
      `SELECT e.id FROM entities e
       JOIN records r ON r.id = e.id AND r.deleted_at IS NULL
       LEFT JOIN aliases a ON a.entity_id = e.id
       WHERE lower(trim(e.title)) = ? OR a.normalized_value = ?
       ORDER BY r.updated_at DESC LIMIT 1`,
      normalized,
      normalized,
    );
    return row?.id;
  }

  private async metadataFor(table: string, id: StableId): Promise<JsonObject> {
    const allowedTables = new Set([
      'entities',
      'attribute_values',
      'relationships',
      'events',
      'aliases',
      'memories',
    ]);
    if (!allowedTables.has(table)) {
      throw new Error('Ungültige Review-Zieltabelle.');
    }
    const row = await this.db.getFirstAsync<{ metadata_json: string }>(
      `SELECT metadata_json FROM ${table} WHERE id = ?`,
      id,
    );
    if (!row) {
      throw new Error('Der vorgeschlagene Datensatz wurde nicht gefunden.');
    }
    return parseJson<JsonObject>(row.metadata_json, {});
  }

  private async applyDecisionToRecord(
    recordId: StableId,
    proposal: AIActionProposal,
    decision: AIProposalReviewStatus,
    timestamp: string,
  ): Promise<void> {
    const confirmed = decision === 'CONFIRMED' || decision === 'CORRECTED';
    const payload = proposal.payload;

    if (proposal.target_kind === 'entity') {
      const metadata = reviewMetadata(await this.metadataFor('entities', recordId), decision);
      await this.db.runAsync(
        `UPDATE entities SET type_key = ?, title = COALESCE(?, title),
          description = COALESCE(?, description), status = ?, metadata_json = ?,
          is_placeholder = ? WHERE id = ?`,
        proposal.type_key,
        typeof payload.title === 'string' ? payload.title.trim() : null,
        typeof payload.content === 'string' ? payload.content : null,
        confirmed ? 'CONFIRMED' : 'AI_REJECTED',
        JSON.stringify(metadata),
        proposal.type_key === 'unknown.entity' ? 1 : 0,
        recordId,
      );
      return;
    }

    if (proposal.target_kind === 'attribute') {
      const metadata = reviewMetadata(await this.metadataFor('attribute_values', recordId), decision);
      const value = payload.value;
      if (value !== undefined) {
        const columns = valueColumns(value);
        await this.db.runAsync(
          `UPDATE attribute_values SET key = ?, value_type = ?, text_value = ?,
            number_value = ?, boolean_value = ?, datetime_value = NULL, json_value = ?,
            entity_reference_id = NULL, term_reference_id = NULL, status = ?, metadata_json = ?
           WHERE id = ?`,
          proposal.type_key,
          columns.valueType,
          columns.textValue,
          columns.numberValue,
          columns.booleanValue,
          columns.jsonValue,
          confirmed ? 'CONFIRMED' : 'AI_REJECTED',
          JSON.stringify(metadata),
          recordId,
        );
      } else {
        await this.db.runAsync(
          'UPDATE attribute_values SET key = ?, status = ?, metadata_json = ? WHERE id = ?',
          proposal.type_key,
          confirmed ? 'CONFIRMED' : 'AI_REJECTED',
          JSON.stringify(metadata),
          recordId,
        );
      }
      return;
    }

    if (proposal.target_kind === 'relationship') {
      const metadata = reviewMetadata(await this.metadataFor('relationships', recordId), decision);
      await this.db.runAsync(
        `UPDATE relationships SET type_key = ?, title = COALESCE(?, title),
          description = COALESCE(?, description), status = ?, metadata_json = ? WHERE id = ?`,
        proposal.type_key,
        typeof payload.title === 'string' ? payload.title : null,
        typeof payload.content === 'string' ? payload.content : null,
        confirmed ? 'CONFIRMED' : 'AI_REJECTED',
        JSON.stringify(metadata),
        recordId,
      );
      return;
    }

    if (proposal.target_kind === 'event') {
      const metadata = reviewMetadata(await this.metadataFor('events', recordId), decision);
      const eventPayload = payload.value && typeof payload.value === 'object' && !Array.isArray(payload.value)
        ? payload.value
        : undefined;
      await this.db.runAsync(
        `UPDATE events SET type_key = ?, title = COALESCE(?, title),
          description = COALESCE(?, description), status = ?,
          payload_json = COALESCE(?, payload_json), metadata_json = ? WHERE id = ?`,
        proposal.type_key,
        typeof payload.title === 'string' ? payload.title : null,
        typeof payload.content === 'string' ? payload.content : null,
        confirmed ? 'CONFIRMED' : 'AI_REJECTED',
        eventPayload ? JSON.stringify(eventPayload) : null,
        JSON.stringify(metadata),
        recordId,
      );
      return;
    }

    if (proposal.target_kind === 'memory') {
      const metadata = reviewMetadata(await this.metadataFor('memories', recordId), decision);
      await this.db.runAsync(
        `UPDATE memories SET content = COALESCE(?, content), type_key = ?, status = ?,
          user_confirmed = ?, verified_at = ?, is_temporary = 0, metadata_json = ? WHERE id = ?`,
        typeof payload.content === 'string' ? payload.content : null,
        normalizeMemoryType(proposal.type_key),
        confirmed ? 'CONFIRMED' : 'UNCONFIRMED',
        confirmed ? 1 : 0,
        confirmed ? timestamp : null,
        JSON.stringify(metadata),
        recordId,
      );
      return;
    }

    const metadata = reviewMetadata(await this.metadataFor('aliases', recordId), decision);
    const value = payload.value;
    await this.db.runAsync(
      `UPDATE aliases SET value = COALESCE(?, value), normalized_value = COALESCE(?, normalized_value),
        kind = ?, metadata_json = ? WHERE id = ?`,
      typeof value === 'string' ? value.trim() : null,
      typeof value === 'string' ? normalizeAlias(value) : null,
      proposal.type_key,
      JSON.stringify(metadata),
      recordId,
    );
  }

  private async touchRecord(recordId: StableId, timestamp: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE records SET updated_at = ?, local_revision = local_revision + 1,
        sync_state = 'pending' WHERE id = ? AND deleted_at IS NULL`,
      timestamp,
      recordId,
    );
  }
}

export function createAIProposalRepository(db: SQLiteDatabase): AIProposalRepository {
  return new SQLiteAIProposalRepository(db);
}
