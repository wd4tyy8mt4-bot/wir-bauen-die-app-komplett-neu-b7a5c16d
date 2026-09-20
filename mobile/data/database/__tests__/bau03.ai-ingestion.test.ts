import { validateAIResponse } from '@/application/aiValidation';
import { ingestNaturalLanguage } from '@/application/ingestion';
import type { AiOrchestrationPort } from '@/application/ports';
import { initializeDatabase } from '@/data/database/initialize';
import { createRepositories } from '@/data/repositories/createRepositories';
import type { AIResponse } from '@/domain';
import { createTestDatabase } from '@/test/sqliteTestDatabase';

function responseFor(text: string): AIResponse {
  const provenance = {
    source_kind: 'user_input',
    source_reference: 'raw-source',
    evidence_text: text,
    evidence_start: 0,
    evidence_end: text.length,
    provider_key: 'fake-local',
    provider_version: 'test.1',
    generated_at: '2025-03-01T10:00:00.000Z',
  };

  return {
    request_id: 'request_bau03',
    extraction: {
      language: 'de',
      summary: 'Kühlschrank in der Küche',
      items: [
        {
          local_id: 'entity_fridge',
          kind: 'entity',
          type_key: 'household.appliance',
          title: 'Kühlschrank',
          metadata: {},
          confidence: { score: 0.94 },
          provenance,
        },
        {
          local_id: 'entity_kitchen',
          kind: 'entity',
          type_key: 'place',
          title: 'Küche',
          metadata: {},
          confidence: { score: 0.88 },
          provenance,
        },
        {
          local_id: 'relationship_location',
          kind: 'relationship',
          type_key: 'located_in',
          title: 'Standort',
          source_local_id: 'entity_fridge',
          target_local_id: 'entity_kitchen',
          metadata: {},
          confidence: { score: 0.9 },
          provenance,
        },
        {
          local_id: 'memory_capture',
          kind: 'memory',
          type_key: 'natural_language_capture',
          content: text,
          source_local_id: 'entity_fridge',
          metadata: { entity_local_ids: ['entity_fridge', 'entity_kitchen'] },
          confidence: { score: 0.82 },
          provenance,
        },
      ],
    },
    proposals: [],
    provider_provenance: provenance,
    validation_warnings: [],
  };
}

describe('BAU-03 Natural Language AI Ingestion', () => {
  it('preserves raw input and stores AI proposals as inferred and unconfirmed', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    const repositories = createRepositories(db);
    const text = 'Der Kühlschrank steht in der Küche.';
    const ai: AiOrchestrationPort = {
      async interpret() {
        return responseFor(text);
      },
    };

    try {
      expect(() => validateAIResponse(text, responseFor(text))).not.toThrow();
      const result = await ingestNaturalLanguage(repositories, ai, { text });

      expect(result.interpretationStatus).toBe('applied');
      expect(result.entity.type).toBe('household.appliance');
      expect(result.entity.isPlaceholder).toBe(false);

      const sources = await repositories.sources.findForRecord(result.entity.id);
      expect(sources.some((source) => source.type === 'user_input' && source.isUserConfirmed)).toBe(true);
      expect(sources.some((source) => source.type === 'ai_inference' && !source.isUserConfirmed)).toBe(true);

      const memories = await repositories.memories.listMemoriesForEntity(result.entity.id);
      expect(memories).toHaveLength(1);
      expect(memories[0]).toMatchObject({
        content: text,
        status: 'INFERRED',
        userConfirmed: false,
      });

      const relationships = await repositories.relationships.findForEntity(result.entity.id);
      expect(relationships).toHaveLength(1);
      expect(relationships[0]?.type).toBe('located_in');
    } finally {
      await db.closeAsync();
    }
  });

  it('keeps the raw capture when the AI provider is unavailable', async () => {
    const db = await createTestDatabase();
    await initializeDatabase(db);
    const repositories = createRepositories(db);
    const ai: AiOrchestrationPort = {
      async interpret() {
        throw new Error('offline');
      },
    };

    try {
      const result = await ingestNaturalLanguage(repositories, ai, {
        text: 'Ich weiß noch nicht, was das ist.',
      });

      expect(result.interpretationStatus).toBe('local_capture_only');
      expect(result.entity.type).toBe('unknown.entity');
      expect(result.entity.isPlaceholder).toBe(true);
      expect(await repositories.memories.listMemoriesForEntity(result.entity.id)).toEqual([]);
      const sources = await repositories.sources.findForRecord(result.entity.id);
      expect(sources).toHaveLength(1);
      expect(sources[0]?.isAiInference).toBe(false);
    } finally {
      await db.closeAsync();
    }
  });
});
