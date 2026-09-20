import type {
  AIProposalReview,
  CoreExportBundle,
  CorrectAIActionProposalInput,
  EntityDetails,
  EntityRecord,
  IngestNaturalLanguageInput,
  IngestNaturalLanguageResult,
  IsoTimestamp,
  MemoryRepository,
  PersistedAIActionProposal,
  Repositories,
  SourceRecord,
  StableId,
  VoiceAudioSourceInput,
} from '@/domain';

import { createStableId } from '@/domain';

import { validateCorrectedAIProposal } from './aiValidation';
import { ingestNaturalLanguage } from './ingestion';
import type { ExtensionPorts } from './ports';

export interface CaptureTextInput {
  text: string;
  capturedAt?: IsoTimestamp;
}

export interface CaptureTextResult {
  entity: EntityRecord;
  source: SourceRecord;
}

export type CaptureVoiceAudioInput = VoiceAudioSourceInput;

export interface CaptureVoiceAudioResult {
  source: SourceRecord;
}

export interface ApplicationServices {
  captureText(input: CaptureTextInput): Promise<CaptureTextResult>;
  captureVoiceAudio(input: CaptureVoiceAudioInput): Promise<CaptureVoiceAudioResult>;
  ingestNaturalLanguage(input: IngestNaturalLanguageInput): Promise<IngestNaturalLanguageResult>;
  search(text: string, limit?: number): Promise<EntityRecord[]>;
  listRecent(limit?: number): Promise<EntityRecord[]>;
  getEntityDetails(id: StableId): Promise<EntityDetails | null>;
  buildCoreExport(): Promise<CoreExportBundle>;
  listPendingReviews(): Promise<AIProposalReview[]>;
  getReview(reviewId: StableId): Promise<AIProposalReview | null>;
  confirmProposal(proposalId: StableId): Promise<PersistedAIActionProposal>;
  correctProposal(
    proposalId: StableId,
    input: CorrectAIActionProposalInput,
  ): Promise<PersistedAIActionProposal>;
  rejectProposal(proposalId: StableId, decisionNote?: string): Promise<PersistedAIActionProposal>;
  readonly memories: MemoryRepository;
  readonly extensions: ExtensionPorts;
}

function titleFromText(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() || text;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

export function createApplicationServices(
  repositories: Repositories,
  extensions: ExtensionPorts = {},
): ApplicationServices {
  let voiceCaptureSequence = 0;
  return {
    async captureText(input) {
      const text = input.text.trim();
      if (!text) {
        throw new Error('Bitte gib zuerst eine Information ein.');
      }

      return repositories.captures.captureUnknownText({
        text,
        title: titleFromText(text),
        capturedAt: input.capturedAt,
      });
    },

    async captureVoiceAudio(input) {
      const transcript = input.transcript?.trim();
      voiceCaptureSequence += 1;
      const source = await repositories.sources.create({
        id: createStableId(`audio_source_${voiceCaptureSequence}`),
        type: 'audio',
        title: 'Sprachaufnahme',
        uri: input.uri,
        capturedAt: input.capturedAt,
        isAiInference: false,
        isUserConfirmed: true,
        metadata: {
          captureMode: 'voice',
          durationMs: input.durationMs ?? null,
          mimeType: input.mimeType ?? 'audio/m4a',
          transcriptionStatus: input.transcriptionStatus,
          transcriptionProvider: input.transcriptionProvider,
          transcript: transcript || null,
          transcriptAvailable: Boolean(transcript),
          audioAvailability: 'available',
          provenance: {
            createdBy: 'user',
            channel: 'voice',
            originalAudioAvailable: true,
          },
          deletionState: {
            audioDeletedAt: null,
            transcriptDeletedAt: null,
            sourceDeletedAt: null,
          },
          errorCode: input.errorCode ?? null,
          ...input.metadata,
        },
        privacyClassification: input.privacyClassification ?? 'PRIVATE',
      });
      return { source };
    },

    ingestNaturalLanguage(input) {
      return ingestNaturalLanguage(repositories, extensions.ai, input);
    },

    search(text, limit = 30) {
      return repositories.entities.search({ search: text, limit });
    },

    listRecent(limit = 8) {
      return repositories.entities.search({ limit });
    },

    getEntityDetails(id) {
      return repositories.entities.getDetails(id);
    },

    buildCoreExport() {
      return repositories.exports.buildCoreBundle();
    },

    listPendingReviews() {
      return repositories.aiProposals.listPendingReviews();
    },

    getReview(reviewId) {
      return repositories.aiProposals.getReview(reviewId);
    },

    confirmProposal(proposalId) {
      return repositories.aiProposals.confirm(proposalId);
    },

    async correctProposal(proposalId, input) {
      const reviews = await repositories.aiProposals.listPendingReviews();
      const review = reviews.find((candidate) =>
        candidate.proposals.some((proposal) => proposal.id === proposalId),
      );
      const current = review?.proposals.find((proposal) => proposal.id === proposalId);
      if (!review || !current) {
        throw new Error('Der offene AI-Vorschlag wurde nicht gefunden.');
      }
      validateCorrectedAIProposal(review.originalText, current, input.proposal);
      return repositories.aiProposals.correct(proposalId, input);
    },

    rejectProposal(proposalId, decisionNote) {
      return repositories.aiProposals.reject(proposalId, decisionNote);
    },

    memories: repositories.memories,
    extensions,
  };
}
