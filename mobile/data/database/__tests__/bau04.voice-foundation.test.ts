import type { AiOrchestrationPort, TranscriptionProvider } from '@/application/ports';
import { createApplicationServices } from '@/application/services';
import { initializeDatabase } from '@/data/database/initialize';
import { createRepositories } from '@/data/repositories/createRepositories';
import type { AIActionProposal, AIResponse, JsonObject } from '@/domain';
import { createTestDatabase } from '@/test/sqliteTestDatabase';

const GENERATED_AT = '2025-04-01T09:00:00.000Z';

function simpleResponse(text: string): AIResponse {
  const provenance = {
    source_kind: 'user_input',
    source_reference: 'voice-transcript',
    evidence_text: text,
    evidence_start: 0,
    evidence_end: text.length,
    provider_key: 'fake-local',
    provider_version: 'bau04.test',
    generated_at: GENERATED_AT,
  };
  return {
    request_id: 'voice_request',
    extraction: {
      language: 'de',
      summary: 'Voice-Test',
      items: [{
        local_id: 'entity_fridge',
        kind: 'entity',
        type_key: 'device',
        title: 'Kühlschrank',
        metadata: {},
        confidence: { score: 0.92 },
        provenance,
      }],
    },
    proposals: [{
      proposal_id: 'proposal_entity_fridge',
      action: 'refine',
      target_kind: 'entity',
      type_key: 'device',
      payload: { title: 'Kühlschrank' },
      depends_on: [],
      confidence: { score: 0.92 },
      provenance,
      requires_user_confirmation: true,
    }],
    provider_provenance: provenance,
    validation_warnings: [],
  };
}

function revisionResponse(text: string): AIResponse {
  const provenance = {
    source_kind: 'user_input',
    source_reference: 'voice-correction',
    evidence_text: text,
    evidence_start: 0,
    evidence_end: text.length,
    provider_key: 'fake-local',
    provider_version: 'bau04.revision.test',
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
    local_id: 'price_previous',
    kind: 'attribute' as const,
    type_key: 'price',
    value: { amount: '899', currency: 'EUR', approximate: true },
    source_local_id: entity.local_id,
    metadata: {
      revision_status: 'superseded_claim',
      superseded_by_local_id: 'price_current',
      relation_type: 'REVISES',
    },
    confidence: { score: 0.4 },
    provenance,
  };
  const current = {
    local_id: 'price_current',
    kind: 'attribute' as const,
    type_key: 'price',
    value: { amount: '879', currency: 'EUR', approximate: false },
    source_local_id: entity.local_id,
    metadata: {
      revision_status: 'current_claim',
      revises_local_id: previous.local_id,
      revises_value: previous.value,
      relation_type: 'REVISES',
      user_confirmed: false,
    },
    confidence: { score: 0.8 },
    provenance,
  };
  const proposal = (
    localId: string,
    action: AIActionProposal['action'],
    payload: JsonObject,
  ): AIActionProposal => ({
    proposal_id: `proposal_${localId}`,
    action,
    target_kind: localId === entity.local_id ? 'entity' : 'attribute',
    type_key: localId === entity.local_id ? entity.type_key : 'price',
    payload,
    depends_on: localId === entity.local_id ? [] : [entity.local_id],
    confidence: { score: 0.8 },
    provenance,
    requires_user_confirmation: true,
  });
  return {
    request_id: 'voice_revision_request',
    extraction: { language: 'de', summary: 'Preiskorrektur', items: [entity, current, previous] },
    proposals: [
      proposal(entity.local_id, 'refine', { title: entity.title }),
      proposal(current.local_id, 'refine', {
        value: current.value,
        source_local_id: entity.local_id,
        metadata: current.metadata,
      }),
      proposal(previous.local_id, 'create', {
        value: previous.value,
        source_local_id: entity.local_id,
        metadata: previous.metadata,
      }),
    ],
    provider_provenance: provenance,
    validation_warnings: [],
  };
}

async function createSubject(ai?: AiOrchestrationPort) {
  const db = await createTestDatabase();
  await initializeDatabase(db);
  const repositories = createRepositories(db);
  const services = createApplicationServices(repositories, { ai });
  return { db, repositories, services };
}

describe('BAU-04 Voice Foundation', () => {
  it('wandelt Audio providerunabhängig in ein Transkript um und speichert eine private Audio-Source', async () => {
    const subject = await createSubject();
    const provider: TranscriptionProvider = {
      key: 'test_on_device',
      async transcribe(request) {
        expect(request.audioUri).toBe('file:///voice.m4a');
        return {
          status: 'completed',
          provider: 'test_on_device',
          transcript: 'Das ist unser neuer Kühlschrank.',
          confidence: 0.91,
        };
      },
    };
    try {
      const transcription = await provider.transcribe({
        audioUri: 'file:///voice.m4a',
        locale: 'de-DE',
        durationMs: 2400,
      });
      const capture = await subject.services.captureVoiceAudio({
        uri: 'file:///voice.m4a',
        durationMs: 2400,
        transcriptionStatus: transcription.status,
        transcriptionProvider: transcription.provider,
        transcript: transcription.transcript,
      });
      expect(capture.source).toMatchObject({
        type: 'audio',
        uri: 'file:///voice.m4a',
        privacy: { classification: 'PRIVATE' },
        metadata: {
          durationMs: 2400,
          transcriptionStatus: 'completed',
          transcriptionProvider: 'test_on_device',
          transcript: 'Das ist unser neuer Kühlschrank.',
          audioAvailability: 'available',
        },
      });
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('führt das Transkript durch denselben Orchestrator und erhält die Audio-Provenienz', async () => {
    const text = 'Das ist unser neuer Kühlschrank.';
    let receivedText: string | undefined;
    const subject = await createSubject({
      async interpret(request) {
        receivedText = request.text;
        return simpleResponse(text);
      },
    });
    try {
      const audio = await subject.services.captureVoiceAudio({
        uri: 'file:///voice.m4a',
        durationMs: 2200,
        transcriptionStatus: 'completed',
        transcriptionProvider: 'test_on_device',
        transcript: text,
      });
      const result = await subject.services.ingestNaturalLanguage({
        text,
        voiceSourceId: audio.source.id,
        transcription: {
          status: 'completed',
          provider: 'test_on_device',
          transcript: text,
        },
      });

      expect(receivedText).toBe(text);
      expect(result.voiceAudioSource?.id).toBe(audio.source.id);
      expect(result.source.provenanceIds).toEqual([audio.source.id]);
      expect(result.entity.metadata.captureMode).toBe('voice');
      expect(await subject.repositories.sources.findForRecord(result.source.id)).toEqual([
        expect.objectContaining({ id: audio.source.id, type: 'audio', uri: 'file:///voice.m4a' }),
      ]);
      const extractedSources = await subject.repositories.sources.findForRecord(result.entity.id);
      expect(extractedSources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: result.source.id,
          type: 'user_input',
          provenanceIds: [audio.source.id],
        }),
        expect.objectContaining({ type: 'ai_inference' }),
      ]));
      const review = await subject.services.getReview(result.reviewId!);
      expect(review?.originalText).toBe(text);
      expect(review?.proposals.every((item) => item.status === 'PENDING')).toBe(true);
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('behält Audio bei fehlgeschlagener oder leerer Transkription ohne Faktenübernahme', async () => {
    const subject = await createSubject();
    try {
      const failed = await subject.services.captureVoiceAudio({
        uri: 'file:///failed.m4a',
        transcriptionStatus: 'failed',
        transcriptionProvider: 'ios_on_device_speech',
        errorCode: 'recognition_failed',
      });
      const empty = await subject.services.captureVoiceAudio({
        uri: 'file:///empty.m4a',
        transcriptionStatus: 'empty',
        transcriptionProvider: 'ios_on_device_speech',
      });
      expect(failed.source.uri).toBe('file:///failed.m4a');
      expect(failed.source.metadata).toMatchObject({
        transcriptionStatus: 'failed',
        transcriptAvailable: false,
        errorCode: 'recognition_failed',
      });
      expect(empty.source.metadata).toMatchObject({
        transcriptionStatus: 'empty',
        transcript: null,
      });
      await expect(subject.services.ingestNaturalLanguage({
        text: '',
        voiceSourceId: empty.source.id,
      })).rejects.toThrow('Bitte gib zuerst eine Information ein.');
      const audioRows = await subject.db.getAllAsync<{ id: string }>(
        `SELECT id FROM sources WHERE type_key = 'audio' ORDER BY id`,
      );
      expect(audioRows).toHaveLength(2);
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('erhält Privacy und lässt die bestehende Textpipeline unverändert', async () => {
    const text = 'Eine normale Texteingabe bleibt unverändert.';
    const subject = await createSubject({ async interpret() { return simpleResponse(text); } });
    try {
      const sensitive = await subject.services.captureVoiceAudio({
        uri: 'file:///sensitive.m4a',
        transcriptionStatus: 'unavailable',
        transcriptionProvider: 'none',
        privacyClassification: 'HIGHLY_SENSITIVE',
      });
      expect(sensitive.source.privacy.classification).toBe('HIGHLY_SENSITIVE');

      const result = await subject.services.ingestNaturalLanguage({ text });
      expect(result.voiceAudioSource).toBeUndefined();
      expect(result.source.provenanceIds).toEqual([]);
      expect(result.entity.metadata.captureMode).toBe('text');
      expect(result.source.metadata).toEqual({ originalText: text });
    } finally {
      await subject.db.closeAsync();
    }
  });

  it('wendet bestehende REVISES- und SUPERSEDES-Logik auch auf Voice-Informationen an', async () => {
    const text = 'Die Rechnung war doch 879 Euro, nicht 899 Euro.';
    const subject = await createSubject({ async interpret() { return revisionResponse(text); } });
    try {
      const audio = await subject.services.captureVoiceAudio({
        uri: 'file:///correction.m4a',
        transcriptionStatus: 'completed',
        transcriptionProvider: 'test_on_device',
        transcript: text,
      });
      const result = await subject.services.ingestNaturalLanguage({
        text,
        voiceSourceId: audio.source.id,
        transcription: { status: 'completed', provider: 'test_on_device', transcript: text },
      });
      const review = await subject.services.getReview(result.reviewId!);
      const current = review?.proposals.find(({ proposal }) =>
        proposal.target_kind === 'attribute'
        && proposal.payload.metadata
        && typeof proposal.payload.metadata === 'object'
        && !Array.isArray(proposal.payload.metadata)
        && proposal.payload.metadata.revision_status === 'current_claim',
      );
      if (!current) throw new Error('Voice-Korrekturvorschlag fehlt.');
      await subject.services.confirmProposal(current.id);

      const attributes = await subject.repositories.entities.findAttributes(result.entity.id);
      expect(attributes.find((item) => item.value && typeof item.value === 'object'
        && !Array.isArray(item.value) && item.value.amount === '879')).toMatchObject({ status: 'CONFIRMED' });
      expect(attributes.find((item) => item.value && typeof item.value === 'object'
        && !Array.isArray(item.value) && item.value.amount === '899')).toMatchObject({ status: 'SUPERSEDED' });
      const memories = await subject.repositories.memories.listMemoriesForEntity(result.entity.id);
      const currentMemory = memories.find((memory) => memory.metadata.revisionStatus === 'current_claim');
      expect(await subject.repositories.memories.listRelations(currentMemory!.id)).toEqual([
        expect.objectContaining({ type: 'REVISES' }),
      ]);
    } finally {
      await subject.db.closeAsync();
    }
  });
});
