/** The manager receives display data only. Credentials never belong in a snapshot. */
export type ManagerPage = 'overview' | 'vocabulary' | 'review' | 'library' | 'activity' | 'settings';
export type Scope = 'pilot' | 'selected' | 'collections' | 'library';
export interface DisplayTag {
  id: string;
  name: string;
  description: string;
  facet: 'system' | 'component' | 'phenomenon' | 'method';
  aliases: string[];
  inclusions: string[];
  exclusions: string[];
  examples: string[];
  custom: boolean;
  status: 'draft' | 'approved';
  broaderIds: string[];
  coverage?: number;
  representativePaperIds?: string[];
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
export interface ManagerSettings {
  provider: 'api' | 'chatgpt';
  model: string;
  autoAssign: boolean;
  budgetUSD: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  maxOutputTokens: number;
}
export interface ManagerSnapshot {
  vocabularyVersion: number;
  pilotReviewed: boolean;
  tags: DisplayTag[];
  papers: DisplayPaper[];
  suggestions: DisplaySuggestion[];
  cleanup: DisplayCleanup[];
  history: DisplayHistory[];
  neighbors: Record<string, { paperId: string; score: number }[]>;
  queue: {
    status: 'idle' | 'running' | 'paused';
    total: number;
    completed: number;
    failed: number;
    message?: string;
    spentUSD?: number;
    estimatedUSD?: number;
    jobs?: DisplayJob[];
  };
  settings: ManagerSettings;
  models: string[];
  connection: {
    apiKeyStored: boolean;
    chatgptSignedIn: boolean;
    accountLabel?: string;
    verified?: boolean;
    credentialStorage?: string;
    accounts?: { id: string; label: string }[];
    selectedAccountId?: string;
  };
  warnings?: string[];
}
export interface ManagerAPI {
  snapshot(): Promise<ManagerSnapshot>;
  invoke(action: string, payload?: any): Promise<any>;
  subscribe(listener: () => void): () => void;
}
