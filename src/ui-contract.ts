import type { TaxonomyProposal } from './taxonomy';
import type { WarningRecord } from './warnings';
/** The manager receives display data only. Credentials never belong in a snapshot. */
export type ManagerPage = 'overview' | 'vocabulary' | 'review' | 'library' | 'activity' | 'settings';
export type Scope = 'pilot' | 'selected' | 'collections' | 'library';
export interface DisplayTag {
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
}
export interface ManagerSnapshot {
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
    provider?: ManagerSettings['provider'];
    status: 'idle' | 'running' | 'paused';
    total: number;
    completed: number;
    failed: number;
    message?: string;
    spentUSD?: number;
    estimatedUSD?: number;
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
