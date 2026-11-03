import type { TaxonomyProposal } from './taxonomy';
import type { WarningRecord } from './warnings';
import type {ConceptFilter} from './concept-filter';
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
  nativeBindingExclusions?: Record<string,string[]>;
}
export interface DisplayTaxonomyProposal extends Omit<TaxonomyProposal, 'tags'> {
  tags: DisplayTag[];
  decisionConflicts?: string[];
  unresolvedMerges?: { fromId: string; toReference: string; reason: string }[];
}
export interface DisplayPaper {
  matchedTagIds?: string[];
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
  reviewId?: string;
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
  reviewId?: string;
  title: string;
  description: string;
  paperIds: string[];
  choices: { id: string; label: string; description: string }[];
}
/** Human decisions and prepared tags; source identities stay in the preparation module. */
export interface DisplayTagPreparation {
  id: string;
  lastChangeId?: string;
  processingPolicy?: 'auto-clear';
  savedCount?: number;
  shelfId?: string;
  verificationScope?: 'representative' | 'exhaustive';
  status: 'checking' | 'questions' | 'ready' | 'failed';
  tags: DisplayTag[];
  detailTags?: DisplayTag[];
  questions: DisplayTagQuestion[];
  canApply: boolean;
  needsRefresh?: boolean;
  scopeCount: number;
  targetCount: number;
  error?: string;
}
export interface DisplayBuildResult {
  requiresChangeReview?: boolean;
  runId: string;
  status: 'running' | 'paused' | 'completed' | 'needs-information' | 'failed' | 'unknown';
  paperCount: number;
  completedPaperCount: number;
  savedCount: number;
  questionCount: number;
  reusedCount?: number;
  skippedCount?: number;
  unavailableCount?: number;
  shelfId?: string;
  reason?: 'saved' | 'reused' | 'no-new-tags' | 'needs-information' | 'no-eligible-papers';
  message?: string;
  tagNames?: string[];
}
export interface DisplayRun {
  requiresChangeReview?: boolean;
  id: string;
  kind: 'build' | 'assignment';
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  createdAt?: number;
  updatedAt?: number;
  paperCount: number;
  completedPaperCount: number;
  phase?: string;
  message?: string;
  error?: string;
  attemptCount?: number;
  newCount?: number;
  reusedCount?: number;
  skippedCount?: number;
  unavailableCount?: number;
  appliedCount?: number;
  choiceCount?: number;
  tagNames?: string[];
  resultRunId?: string;
  canRetry?: boolean;
  canStop?: boolean;
  spentUSD?: number;
  provider?: string;
  model?: string;
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
  lastChangeId?: string;
  processingPolicy?: 'auto-clear';
  appliedCount?: number;
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
export interface DisplayReviewItem {
  id: string;
  kind: 'definition' | 'assignment';
  state: 'open' | 'deferred' | 'resolved';
  taskId: string;
  paperId?: string;
  tagId?: string;
  questionId?: string;
  sourceName?: string;
  label: string;
  message?: string;
  suggestionId?: string;
  ownerPage: 'cleanup' | 'assignment' | 'vocabulary';
  workId?: string;
}
export interface ManagerSnapshot {
  transitionSummary?:{message:string;completedAt:number;retiredDefinitions:number;keptDefinitions:number};
  savedFilters?: {id:string;name:string;filter:ConceptFilter}[];
  run?: DisplayRun;
  runs?: DisplayRun[];
  buildResult?: DisplayBuildResult;
  /** Query totals are independent of the bounded rows returned for this page. */
  totals?: { papers: number; tags: number; openChoices: number; history: number; definedTags?: number; assignableTags?: number };
  conceptCounts?: Record<string,number>;
  /** Explicitly requested editor, relationship and evidence context. */
  detailTags?: DisplayTag[];
  detailPapers?: DisplayPaper[];
  detailNativeMeaningRows?: NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows'];
  storage?: { activeBytes: number; historyBytes: number; cacheBytes: number; backupBytes: number; physicalBytes: number; retentionDays: number; decodedCacheBytes?: number; databaseBytes?:number };
  reviewItems?: DisplayReviewItem[];
  recoveryRequests?:{id:string;provider?:string;model?:string;status:'unknown'|'stopped';startedAt?:number;message:string}[];
  libraryIndexProgress?:{phase:'indexing'|'reconciling'|'completed';checked:number;changed:number;removed:number;total:number;error?:string};
  nativeTagTreatments?: Record<string,'personal'|'scientific'>;
  canPrepareNativeMeanings?: boolean;
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
  assignmentReview?: DisplayAssignmentReview;
  assignmentReviews?: DisplayAssignmentReview[];
  tagShelves?: { id: string; name: string; kind: 'generated' | 'user' | 'existing'; tagIds: string[]; count: number; readyCount?: number; assignableCount?: number; nativeNames?: { name: string; paperCount: number; tagId?: string; protected?: boolean; paperIds?: string[] }[] }[];
  tagLibraryEntries?: { name: string; paperCount: number; tagId?: string; protected?: boolean; paperIds?: string[] }[];
  nativeDefinitionPreparation?: {
    id: string; lastChangeId?: string; processingPolicy?: 'auto-clear'; status: 'queued' | 'running' | 'paused' | 'ready' | 'applied' | 'finished'; completed: number; total: number; canApply: boolean; canContinue?: boolean; readyCount?: number; questionCount?: number; savedCount?: number; deferredCount?: number; leftUndefinedCount?: number; clearChoiceCount?: number; canUseClearMeanings?: boolean; error?: string; spentUSD?: number; budgetUSD?: number;
    rows: { id: string; reviewId?: string; tagId?: string; sourceName: string; name?: string; fullName?: string; description?: string; facet?: DisplayTag['facet']; aliases?: string[]; inclusions?: string[]; exclusions?: string[]; examples?: string[]; broaderIds?: string[]; relatedIds?: string[]; matchingMode?: 'manual' | 'suggest' | 'auto'; paperIds: string[]; status: 'pending' | 'ready' | 'question' | 'failed' | 'left-undefined'; question?: string; questionKind?: 'meaning' | 'information' | 'personal' | 'protection'; resolution?: 'clear'|'ambiguous'|'personal'|'needs-information'; selectionOrigin?: 'human'|'automatic'; personalTreatment?: 'personal'|'scientific'; canSetTreatment?: boolean; canConfirmClear?: boolean; canUseProposedMeaning?: boolean; savedMeaningConflicts?: { id: string; name: string; description: string }[]; canSuggestMeaning?: boolean; choices?: { id: string; label: string; description: string }[]; needsContinuation?: boolean; targetTagId?: string; chosenMeaning?: {name:string;description:string}; sourceIssues?: {paperId:string;status:'uncertain'|'different'|'unchecked';reason:string}[]; canRecheckSources?: boolean; bindingVerified?: boolean; applied?: boolean }[];
  };
  activityTasks?: { id: string; kind: 'rebuild' | 'assignment' | 'meanings' | 'maintenance'; state: 'queued' | 'running' | 'paused' | 'needs-choice' | 'ready-to-save' | 'completed'; label: string; ownerPage: 'cleanup' | 'assignment' | 'vocabulary' | 'activity'; workId?: string; queuedAttempt?:boolean; message?: string; readyCount?: number; questionCount?: number; savedCount?: number; leftUndefinedCount?: number; completed?: number; total?: number; spentUSD?: number; createdAt?: string }[];
  diyComparison?: {
    id: string;
    total?: number;
    status: 'ready' | 'queued' | 'running' | 'paused';
    message?: string;
    pairs: { id: string; diyId: string; diyName: string; targetId: string; targetName: string; relation: 'equivalent' | 'broader' | 'narrower' | 'related' | 'distinct' | 'uncertain'; reason: string; conflict?: boolean }[];
    preview?: { id: string; total?: number; pageSize?: number; changes: { paperId: string; title: string; before: string[]; after: string[] }[]; mergeCount: number; overrideCount: number };
  };
  existingTags?: {
    id: string;
    total?: number;
    applied: boolean;
    status: 'ready' | 'queued' | 'running' | 'paused';
    message?: string;
    rows: { id: string; name: string; kept?: boolean; protected?: boolean; locked?: boolean; status: 'match' | 'choice' | 'unmatched'; meaning?: string; meaningInferred?: boolean; facet?: DisplayTag['facet']; targetNames: string[]; paperIds: string[]; manualCount: number; affectedCount: number; reason: string; diyQuestion?: string; assignments?: { paperId: string; status: 'match' | 'choice' | 'unmatched'; targetNames: string[]; targetIds: string[]; reason: string; conflict?: boolean; meaning?: string }[] }[];
    preview?: { id: string; total?: number; pageSize?: number; changes: { paperId: string; title: string; before: string[]; after: string[] }[] };
    keepPreview?: { id: string; total?: number; pageSize?: number; removedNames: string[]; paperCount: number; overrideCount: number; changes: { paperId: string; title: string; before: string[]; after: string[] }[] };
  };
  paperAttention?: { total?: number; papers: { id: string; title: string; status: 'usable' | 'needsInformation' | 'failed' | 'skipped' | 'excluded'; message: string; phase: string; queued?: boolean; canDismiss?: boolean; canLookupMetadata: boolean; canRecheck: boolean; canRetry: boolean; canSkip: boolean }[]; queued: number };
  paperExclusionPreview?: { id: string; total?: number; pageSize?: number; exclude: boolean; changes: { paperId: string; title: string; before: string[]; after: string[] }[] };
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
    ownerPage?: 'cleanup' | 'assignment' | 'vocabulary';
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
    signingIn?: boolean;
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
