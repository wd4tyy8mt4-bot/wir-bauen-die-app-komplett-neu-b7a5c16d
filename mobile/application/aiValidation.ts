import type { AIActionProposal, AIResponse, PersistedAIActionProposal } from '@/domain';

const VALID_KINDS = new Set([
  'entity',
  'attribute',
  'relationship',
  'event',
  'memory',
  'alias',
]);

function validateProposalProvenance(text: string, proposal: AIActionProposal): void {
  if (
    !proposal.proposal_id.trim()
    || !proposal.type_key.trim()
    || !VALID_KINDS.has(proposal.target_kind)
    || !['create', 'refine', 'link'].includes(proposal.action)
    || !Number.isFinite(proposal.confidence.score)
    || proposal.confidence.score < 0
    || proposal.confidence.score > 1
  ) {
    throw new Error('Der korrigierte AI-Vorschlag ist ungültig.');
  }
  const provenance = proposal.provenance;
  if (
    provenance.evidence_start < 0
    || provenance.evidence_end <= provenance.evidence_start
    || provenance.evidence_end > text.length
    || text.slice(provenance.evidence_start, provenance.evidence_end) !== provenance.evidence_text
  ) {
    throw new Error('Der korrigierte AI-Vorschlag hat keinen gültigen Quellenbeleg.');
  }
  if (!proposal.requires_user_confirmation) {
    throw new Error('Ein AI-Vorschlag darf nicht automatisch bestätigt werden.');
  }
}

export function validateAIResponse(text: string, response: AIResponse): void {
  if (!response.request_id.trim()) {
    throw new Error('Die KI-Antwort enthält keine gültige Anfrage-ID.');
  }

  const items = new Map(response.extraction.items.map((item) => [item.local_id, item]));
  if (items.size !== response.extraction.items.length) {
    throw new Error('Die KI-Antwort enthält doppelte lokale IDs.');
  }

  for (const item of response.extraction.items) {
    if (!VALID_KINDS.has(item.kind) || !item.type_key.trim()) {
      throw new Error('Die KI-Antwort enthält einen ungültigen Vorschlag.');
    }
    if (!Number.isFinite(item.confidence.score) || item.confidence.score < 0 || item.confidence.score > 1) {
      throw new Error('Die KI-Antwort enthält eine ungültige Konfidenz.');
    }
    const provenance = item.provenance;
    if (
      provenance.evidence_start < 0 ||
      provenance.evidence_end <= provenance.evidence_start ||
      provenance.evidence_end > text.length ||
      text.slice(provenance.evidence_start, provenance.evidence_end) !== provenance.evidence_text
    ) {
      throw new Error('Die KI-Antwort enthält ungültige Quellenbelege.');
    }
    for (const reference of [item.source_local_id, item.target_local_id]) {
      if (reference && items.get(reference)?.kind !== 'entity') {
        throw new Error('Die KI-Antwort verweist auf eine unbekannte Entität.');
      }
    }
    if (item.kind === 'relationship' && (!item.source_local_id || !item.target_local_id)) {
      throw new Error('Eine vorgeschlagene Beziehung ist unvollständig.');
    }
    if ((item.kind === 'attribute' || item.kind === 'alias') && !item.source_local_id) {
      throw new Error('Ein vorgeschlagener Wert hat keine zugehörige Entität.');
    }
  }

  for (const proposal of response.proposals) {
    validateProposalProvenance(text, proposal);
  }
}

export function validateCorrectedAIProposal(
  originalText: string,
  current: PersistedAIActionProposal,
  corrected: AIActionProposal,
): void {
  validateProposalProvenance(originalText, corrected);
  if (
    corrected.proposal_id !== current.proposal.proposal_id
    || corrected.target_kind !== current.proposal.target_kind
  ) {
    throw new Error('Art und Identität eines AI-Vorschlags dürfen bei der Korrektur nicht wechseln.');
  }
  for (const key of ['title', 'content'] as const) {
    const value = corrected.payload[key];
    if (value !== undefined && typeof value !== 'string') {
      throw new Error('Korrigierte Textwerte müssen als Text angegeben werden.');
    }
  }
  if (
    corrected.target_kind === 'alias'
    && corrected.payload.value !== undefined
    && (typeof corrected.payload.value !== 'string' || !corrected.payload.value.trim())
  ) {
    throw new Error('Ein korrigierter Alias darf nicht leer sein.');
  }
}
