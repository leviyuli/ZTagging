import type { TaxonomyProposal } from './taxonomy';
import type { WarningRecord } from './warnings';
/** The manager receives display data only. Credentials never belong in a snapshot. */
export type ManagerPage = 'overview' | 'connection' | 'build' | 'cleanup' | 'assignment' | 'vocabulary' | 'existing-tags' | 'review' | 'library' | 'activity' | 'settings';
export type Scope = 'pilot' | 'selected' | 'collections' | 'library';
export type BuildMode = 'extend' | 'replace';
export interface DisplayTag {
  builtin?: 'no_tag';
  retained?: boolean;
  id: string;
  name: string;
  fullName?: string;
  description: string;
  facet: 'system' | 'component' | 'phenomenon' | 'method';
  aliases: string[];
  inclusions: string[];
  exclusions: string[];
  examples: string[];
  custom: boolean;
  status: 'draft' | 'approved';
  broaderIds: string[];
  relatedIds?: string[];
  matchingMode?: 'manual' | 'suggest' | 'auto';
  coverage?: number;
  currentlyTaggedCount?: number;
  representativePaperIds?: string[];
}
export interface DisplayTaxonomyProposal extends Omit<TaxonomyProposal, 'tags'> {
  tags: DisplayTag[];
  decisionConflicts?: string[];
  unresolvedMerges?: { fromId: string; toReference: string; reason: string }[];
}
export interface DisplayPaper {
  id: string;
  title: string;
  abstract?: string;
  keywords?: string[];
  summary?: string;
  tags?: string[];
  evidenceStatus?: string;
}
export interface DisplaySuggestion {
  id: string;
  runId?: string;
  decisionOrigin?: 'automatic' | 'researcher';
  paperId: string;
  tagId: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  status: 'pending' | 'accepted' | 'rejected';
  evidence: { text: string; source: string }[];
  locked?: boolean;
  applied?: boolean;
  operation?: 'add' | 'remove';
}
export interface DisplayCleanup {
  id: string;
  from: string;
  to: string;
  reason: string;
  affectedCount: number;
  manualCount: number;
}
export interface DisplayHistory {
  id: string;
  date: string;
  label: string;
  count: number;
  canUndo: boolean;
  status?: string;
}
export interface DisplayJob {
  id: string;
  title?: string;
  status: string;
  error?: string;
}
export interface DisplayTagQuestion {
  id: string;
  title: string;
  description: string;
  paperIds: string[];
  choices: { id: string; label: string; description: string }[];
}
/** Human decisions and prepared tags; source identities stay in the preparation module. */
export interface DisplayTagPreparation {
  id: string;
  verificationScope?: 'representative' | 'exhaustive';
  status: 'checking' | 'questions' | 'ready' | 'failed';
  tags: DisplayTag[];
  questions: DisplayTagQuestion[];
  canApply: boolean;
  scopeCount: number;
  targetCount: number;
  error?: string;
}
export interface ManagerSettings {
  provider: 'api' | 'chatgpt' | 'deepseek';
  model: string;
  autoAssign: boolean;
  budgetUSD: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  maxOutputTokens: number;
  coreConceptLimit?: number;
  extensionTagTarget?: number;
}
export interface DisplayAssignmentReview {
  id: string;
  label?: string;
  status: 'running' | 'paused' | 'ready' | 'finished';
  scopeCount: number;
  analysisComplete: boolean;
  canFinish: boolean;
  highAccepted: number;
  needsReview: number;
  lowRejected: number;
  acceptedIds: string[];
  bulkAcceptCount?: number;
  bulkAcceptIds?: string[];
  needsChoiceCount?: number;
  report?: { topics: { id: string; name: string; paperIds: string[]; reason?: string; resolved?: boolean }[]; paperIds: string[] };
}
export interface ManagerSnapshot {
  pluginVersion?: string;
  workflow?: {
    buildMode: BuildMode;
    buildScope: Scope;
    buildPaperCount: number;
    assignmentScope: Scope;
    assignmentPaperCount: number;
    assignedPaperCount: number;
    assignmentPilotReady?: boolean;
    assignmentTagShelfId?: string;
  };
  navigation?: { status: 'starting' | 'ready' | 'unavailable' | 'hidden'; mode?: 'tags' | 'collections'; message?: string };
  assignmentReview?: DisplayAssignmentReview;
  assignmentReviews?: DisplayAssignmentReview[];
  tagShelves?: { id: string; name: string; kind: 'generated' | 'user' | 'existing'; tagIds: string[]; count: number; nativeNames?: { name: string; paperCount: number; tagId?: string; protected?: boolean }[] }[];
  diyComparison?: {
    id: string;
    status: 'ready' | 'queued' | 'running' | 'paused';
    message?: string;
    pairs: { id: string; diyId: string; diyName: string; targetId: string; targetName: string; relation: 'equivalent' | 'broader' | 'narrower' | 'related' | 'distinct' | 'uncertain'; reason: string; conflict?: boolean }[];
    preview?: { id: string; changes: { paperId: string; title: string; before: string[]; after: string[] }[]; mergeCount: number; overrideCount: number };
  };
  existingTags?: {
    id: string;
    applied: boolean;
    status: 'ready' | 'queued' | 'running' | 'paused';
    message?: string;
    rows: { id: string; name: string; kept?: boolean; protected?: boolean; locked?: boolean; status: 'match' | 'choice' | 'unmatched'; meaning?: string; meaningInferred?: boolean; facet?: DisplayTag['facet']; targetNames: string[]; paperIds: string[]; manualCount: number; affectedCount: number; reason: string; diyQuestion?: string; assignments?: { paperId: string; status: 'match' | 'choice' | 'unmatched'; targetNames: string[]; targetIds: string[]; reason: string; conflict?: boolean; meaning?: string }[] }[];
    preview?: { id: string; changes: { paperId: string; title: string; before: string[]; after: string[] }[] };
    keepPreview?: { id: string; removedNames: string[]; paperCount: number; overrideCount: number; changes: { paperId: string; title: string; before: string[]; after: string[] }[] };
  };
  paperAttention?: { papers: { id: string; title: string; status: 'usable' | 'needsInformation' | 'failed' | 'skipped' | 'excluded'; message: string; phase: string; queued?: boolean; canDismiss?: boolean; canLookupMetadata: boolean; canRecheck: boolean; canRetry: boolean; canSkip: boolean }[]; queued: number };
  paperExclusionPreview?: { id: string; exclude: boolean; changes: { paperId: string; title: string; before: string[]; after: string[] }[] };
  metadataPreview?: { paperId: string; itemID: number; status: string; message: string; identifier?: string; changes: { field: string; before: string; after: string }[]; id: string };
  vocabularyVersion: number;
  pilotReviewed: boolean;
  taxonomyReady?: boolean;
  taxonomyProposal?: DisplayTaxonomyProposal;
  tagPreparation?: DisplayTagPreparation;
  analyzedPaperCount?: number;
  taxonomyArchives?: { id: string; date: string; version: number; reason: string; count: number }[];
  tags: DisplayTag[];
  papers: DisplayPaper[];
  suggestions: DisplaySuggestion[];
  cleanup: DisplayCleanup[];
  history: DisplayHistory[];
  neighbors: Record<string, { paperId: string; score: number }[]>;
  queue: {
    taskLabel?: string;
    canUseFasterBuild?: boolean;
    switchingToFasterBuild?: boolean;
    kind?: 'rebuild' | 'tag';
    phase?: 'reading' | 'organizing' | 'choosing' | 'mapping' | 'checking' | 'ready';
    phaseProgress?: { completed: number; total: number; label: string };
    selection?: {
      failed?: boolean;
      verificationScope?: 'representative' | 'exhaustive';
      tagsPrepared?: number;
      tagsTotal?: number;
      examplesChecked?: number;
      examplesTotal?: number;
      sourceCompleted: number;
      sourceTotal: number;
      completedRequests: number;
      queuedRequests: number;
      correctionsUsed: number;
      correctionAllowance: number;
      semanticRepairsUsed?: number;
      semanticRepairAllowance?: number;
      mappingCorrectionsUsed?: number;
      mappingCorrectionAllowance?: number;
    };
    needsInformation?: number;
    skipped?: number;
    provider?: ManagerSettings['provider'];
    status: 'idle' | 'running' | 'paused';
    total: number;
    completed: number;
    failed: number;
    message?: string;
    spentUSD?: number;
    estimatedUSD?: number;
    estimatePending?: boolean;
    jobs?: DisplayJob[];
    consolidation?: {
      phase: string;
      correctionAttempts: number;
      issues: string[];
      canRegenerate: boolean;
      rawResponses?: { label: string; response: string }[];
    };
  };
  settings: ManagerSettings;
  models: string[];
  connection: {
    apiKeyStored: boolean;
    deepseekKeyStored?: boolean;
    chatgptSignedIn: boolean;
    accountLabel?: string;
    verified?: boolean;
    credentialStorage?: string;
    accounts?: { id: string; label: string }[];
    selectedAccountId?: string;
  };
  warnings?: WarningRecord[];
}
export interface ManagerAPI {
  snapshot(): Promise<ManagerSnapshot>;
  invoke(action: string, payload?: any): Promise<any>;
  subscribe(listener: () => void): () => void;
}
