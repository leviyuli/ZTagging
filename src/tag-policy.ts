import type { Evidence, TagDefinition } from './core.ts';

export const NO_TAG_ID = 'smart-tags:no-tag';
export const NO_TAG_NAME = 'no_tag';
export const NO_TAG_ANALYSIS_INSTRUCTIONS = 'Additional response fields are {"noMatch":false,"noMatchReason":"explanation when outside the current vocabulary","noMatchEvidence":[{"source":"title|abstract|pdf","text":"exact supporting quote"}]}. Set noMatch=true only when noMatchPolicy.enabled is true, adequate paper evidence establishes the topic, and none of the supplied approved definitions is supported. This is an outside-vocabulary suggestion for researcher review, not a missing-evidence or processing-failure fallback. When context is missing, uncertain, unreadable, or still needs PDF evidence, keep noMatch=false and request that evidence. Do not put no_tag into suggestions or newTagCandidates. For a supported noMatch outcome return empty suggestions; separately retain meaningful uncovered topics and their supporting quotations for later review. Never infer noMatch from an empty response or the absence of metadata.';

export function getNoTagDefinition(): TagDefinition {
  return {
    id: NO_TAG_ID, name: NO_TAG_NAME, fullName: NO_TAG_NAME, builtin: 'no_tag',
    description: 'Outside the current tag list, or deliberately excluded by the researcher.',
    facet: 'phenomenon', custom: true, status: 'approved', matchingMode: 'manual',
    aliases: [], inclusions: ['An explicit reviewed outside-vocabulary decision or researcher opt-out.'],
    exclusions: ['Missing or unreadable evidence.', 'Failed or unfinished analysis.', 'A paper with a supported scientific match.'],
    examples: [], broaderIds: [], relatedIds: [],
  };
}

export function isNoTagDefinition(tag: Pick<TagDefinition, 'id' | 'name' | 'builtin'>): boolean {
  return tag.builtin === 'no_tag' || tag.id === NO_TAG_ID || tag.name === NO_TAG_NAME;
}

export function scientificDefinitions<T extends Pick<TagDefinition, 'id' | 'name' | 'builtin'>>(definitions: readonly T[]): T[] {
  return definitions.filter(tag => !isNoTagDefinition(tag));
}

export function isExcludedByNativeTag(tags: readonly (string | { tag: string })[]): boolean {
  return tags.some(tag => (typeof tag === 'string' ? tag : tag.tag) === NO_TAG_NAME);
}

export function hasAdequateNoTagEvidence(evidence: readonly Evidence[]): boolean {
  return evidence.some(entry => ['title', 'abstract', 'pdf'].includes(entry.source)
    && entry.text.length >= 16 && (entry.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 3);
}

export interface NoTagAssessment {
  noMatch?: boolean;
  needsPDF: boolean;
  matchedTagCount: number;
  evidence: readonly Evidence[];
  reason?: string;
  hasVocabulary: boolean;
  hasRejectedSuggestions?: boolean;
  enabled?: boolean;
}
export type NoTagDecisionReason = 'outsideVocabulary' | 'disabled' | 'noVocabulary' | 'notExplicit' | 'needsEvidence' | 'supportedMatch' | 'invalidSuggestions' | 'noExplanation' | 'insufficientPassage';

/** Evidence supplied here must already have passed exact-source validation. */
export function evaluateNoTag(input: NoTagAssessment): { eligible: boolean; reason: NoTagDecisionReason } {
  if (input.enabled === false) return { eligible: false, reason: 'disabled' };
  if (!input.hasVocabulary) return { eligible: false, reason: 'noVocabulary' };
  if (input.noMatch !== true) return { eligible: false, reason: 'notExplicit' };
  if (input.needsPDF) return { eligible: false, reason: 'needsEvidence' };
  if (input.matchedTagCount > 0) return { eligible: false, reason: 'supportedMatch' };
  if (input.hasRejectedSuggestions) return { eligible: false, reason: 'invalidSuggestions' };
  if (!input.reason?.trim()) return { eligible: false, reason: 'noExplanation' };
  if (!hasAdequateNoTagEvidence(input.evidence)) return { eligible: false, reason: 'insufficientPassage' };
  return { eligible: true, reason: 'outsideVocabulary' };
}
