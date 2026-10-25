// Shared domain types for Legible. Names follow CONTEXT.md exactly.
import { z } from 'zod';

export const Side = z.enum(['base', 'head']);
export type Side = z.infer<typeof Side>;

export const Mode = z.enum(['author', 'reviewer']);
export type Mode = z.infer<typeof Mode>;

export const SourceKind = z.enum(['working_tree', 'refs', 'pull_request']);
export type SourceKind = z.infer<typeof SourceKind>;

export const HostKind = z.enum(['github', 'gitlab']);
export type HostKind = z.infer<typeof HostKind>;

// ---------------------------------------------------------------------------
// Sources: what the user asks to open. Every source reduces to a Change Set.

export const Source = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('working_tree'),
    repoPath: z.string(),
    /** Ref whose merge-base with HEAD is the Base. Null = the repo's default branch. */
    baseRef: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('refs'),
    repoPath: z.string(),
    baseRef: z.string(),
    headRef: z.string(),
  }),
  z.object({
    kind: z.literal('pull_request'),
    url: z.string(),
  }),
]);
export type Source = z.infer<typeof Source>;

export interface PullRequestRef {
  host: HostKind;
  /** e.g. github.com, gitlab.example.com */
  hostname: string;
  /** owner/name for GitHub; full namespace path for GitLab */
  project: string;
  number: number;
  url: string;
}

// ---------------------------------------------------------------------------
// Reviews and Iterations

export interface Repo {
  id: string;
  displayName: string;
  /** Path to the git dir used for all object reads. */
  gitDir: string;
  /** The user's working tree for local repos; null for cached clones. */
  workTree: string | null;
  remoteUrl: string | null;
  host: string | null;
}

export interface Review {
  id: string;
  repoId: string;
  title: string;
  sourceKind: SourceKind;
  baseRef: string | null;
  headRef: string | null;
  prUrl: string | null;
  prNumber: number | null;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
}

export const IterationKind = z.enum(['snapshot', 'push', 'refs']);
export type IterationKind = z.infer<typeof IterationKind>;

export interface Iteration {
  id: string;
  reviewId: string;
  seq: number;
  kind: IterationKind;
  baseSha: string;
  headSha: string;
  /** For Snapshots: the captured tree, used to tell whether the working tree moved. */
  headTree: string | null;
  createdAt: string;
}

export interface ReviewSummary extends Review {
  repo: Repo;
  latestIteration: Iteration | null;
  intentText: string | null;
}

// ---------------------------------------------------------------------------
// Change Sets

export const FileStatus = z.enum(['added', 'deleted', 'modified', 'renamed', 'copied', 'typechange']);
export type FileStatus = z.infer<typeof FileStatus>;

/** Why a file is collapsed by default. */
export const CollapseReason = z.enum(['generated', 'lockfile', 'binary', 'large', 'vendored']);
export type CollapseReason = z.infer<typeof CollapseReason>;

export const StructuralProof = z.enum(['formatting', 'whitespace', 'move']);
export type StructuralProof = z.infer<typeof StructuralProof>;

export interface FileChange {
  /** Stable id: hash of oldPath/path + both blob oids. Survives Iterations where the file didn't change. */
  id: string;
  path: string;
  oldPath: string | null;
  status: FileStatus;
  baseOid: string | null;
  headOid: string | null;
  language: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
  collapse: CollapseReason | null;
  /** Set when every Fragment in the file is Structural. */
  structural: StructuralProof | null;
  /** The edit script (ranges only), so the viewer can lay out rows before contents load. */
  chunks: DiffChunk[];
  fragments: Fragment[];
  baseLineCount: number;
  headLineCount: number;
}

export interface MoveBlock {
  id: string;
  fromFileId: string;
  fromPath: string;
  /** 1-based inclusive Base line range. */
  fromStart: number;
  fromEnd: number;
  toFileId: string;
  toPath: string;
  /** 1-based inclusive Head line range. */
  toStart: number;
  toEnd: number;
}

export interface ChangeSetSummary {
  reviewId: string;
  iterationId: string;
  baseSha: string;
  headSha: string;
  files: FileChange[];
  moves: MoveBlock[];
  additions: number;
  deletions: number;
}

/** One run of the line-level edit script. Ranges are 0-based, half-open. */
export interface DiffChunk {
  kind: 'equal' | 'change';
  baseStart: number;
  baseEnd: number;
  headStart: number;
  headEnd: number;
}

/** A contiguous change region. The atomic unit Steps will be built from (M3). */
export interface Fragment {
  /** Stable, content-derived id. */
  id: string;
  /** Index into FileDiff.chunks of the 'change' chunk this Fragment covers. */
  chunkIndex: number;
  kind: 'behavioral' | 'structural';
  proof: StructuralProof | null;
}

/** [startCol, length, scopeId] triples, flattened. */
export type LineTokens = number[];

/** [startCol, endCol] pairs, flattened; intra-line changed spans. */
export type WordRanges = number[];

export interface FileDiff {
  fileId: string;
  baseLines: string[];
  headLines: string[];
  chunks: DiffChunk[];
  fragments: Fragment[];
  baseTokens: LineTokens[] | null;
  headTokens: LineTokens[] | null;
  /** Keyed by 0-based line index. */
  baseWords: Record<number, WordRanges>;
  headWords: Record<number, WordRanges>;
  ignoreWhitespace: boolean;
}

/** Highlight scopes. The renderer maps ids to CSS classes. */
export const TOKEN_SCOPES = [
  'keyword',
  'function',
  'string',
  'number',
  'type',
  'comment',
  'punctuation',
  'property',
  'variable',
  'operator',
  'constant',
  'tag',
  'attribute',
  'meta',
  'heading',
  'link',
  'inserted',
  'deleted',
] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

// ---------------------------------------------------------------------------
// Models and agent work

export const Provider = z.enum(['anthropic', 'openai']);
export type Provider = z.infer<typeof Provider>;

export const ModelTier = z.enum(['strong', 'mid', 'fast']);
export type ModelTier = z.infer<typeof ModelTier>;

export const ClaudeAuth = z.enum(['claude-code', 'anthropic-api', 'bedrock', 'vertex', 'foundry']);
export type ClaudeAuth = z.infer<typeof ClaudeAuth>;

export interface ModelInfo {
  provider: Provider;
  id: string;
  displayName: string;
  /** USD per million tokens. Null when unknown. */
  inputPrice: number | null;
  outputPrice: number | null;
  contextWindow: number | null;
  status: 'recommended' | 'experimental';
  /** Relative cost, 1–3, for the "$" badges. */
  costRank: 1 | 2 | 3;
  tiers: ModelTier[];
}

export interface TierAssignment {
  provider: Provider;
  model: string;
}

export interface RuntimeStatus {
  provider: Provider;
  auth: ClaudeAuth;
  ready: boolean;
  /** e.g. "Claude Code 2.1.310 at /usr/local/bin/claude" */
  detail: string;
  executablePath: string | null;
  version: string | null;
}

// ---------------------------------------------------------------------------
// Explanations

export const ExplanationTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('range'),
    fileId: z.string(),
    path: z.string(),
    oldPath: z.string().nullable(),
    /** 1-based inclusive. Null when the selection has no lines on that side. */
    baseRange: z.tuple([z.number().int(), z.number().int()]).nullable(),
    headRange: z.tuple([z.number().int(), z.number().int()]).nullable(),
  }),
  z.object({
    kind: z.literal('file'),
    fileId: z.string(),
    path: z.string(),
    oldPath: z.string().nullable(),
  }),
]);
export type ExplanationTarget = z.infer<typeof ExplanationTarget>;

export interface ExplanationBody {
  /** What it did on Base. Null for new code. */
  before: string | null;
  after: string;
  whatChanged: { kind: 'behavior' | 'connection' | 'intent'; text: string }[];
  /** 0–2 items. */
  watchOut: string[];
}

export interface Explanation {
  id: string;
  cacheKey: string;
  target: ExplanationTarget;
  /** Short display label, e.g. "src/refunds.ts · lines 40–58". */
  label: string;
  body: ExplanationBody;
  provider: Provider;
  model: string;
  tier: ModelTier;
  promptVersion: string;
  costUsd: number | null;
  durationMs: number | null;
  createdAt: string;
  cached: boolean;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface ExplanationJob {
  jobId: string;
  reviewId: string;
  target: ExplanationTarget;
  label: string;
  status: JobStatus;
  /** Latest progress line, e.g. "Reading src/refunds.ts". */
  progress: string | null;
  error: string | null;
  explanation: Explanation | null;
  startedAt: string;
}

export interface SpendSummary {
  reviewUsd: number | null;
  monthUsd: number;
  monthByProvider: Record<Provider, number>;
  runsThisMonth: number;
}

// ---------------------------------------------------------------------------
// Settings

export const EditorChoice = z.enum(['vscode', 'cursor', 'zed', 'idea', 'env']);
export type EditorChoice = z.infer<typeof EditorChoice>;

export const Theme = z.enum(['system', 'dark', 'light']);
export type Theme = z.infer<typeof Theme>;

export const Settings = z.object({
  claude: z.object({
    auth: ClaudeAuth,
    /** Override for the `claude` executable; null = resolve from the login shell's PATH. */
    executablePath: z.string().nullable(),
    bedrock: z.object({ region: z.string(), profile: z.string() }),
    vertex: z.object({ projectId: z.string(), region: z.string() }),
    foundry: z.object({ resource: z.string() }),
  }),
  tiers: z.object({
    strong: z.object({ provider: Provider, model: z.string() }),
    mid: z.object({ provider: Provider, model: z.string() }),
    fast: z.object({ provider: Provider, model: z.string() }),
  }),
  spend: z.object({
    /** Hard cap per Explanation run. */
    explanationCapUsd: z.number().positive(),
    /** Agent Review cap, used from M5. */
    agentReviewCapUsd: z.number().positive(),
  }),
  agents: z.object({
    concurrency: z.number().int().min(1).max(16),
  }),
  diff: z.object({
    layout: z.enum(['unified', 'split']),
    ignoreWhitespace: z.boolean(),
    contextLines: z.number().int().min(0).max(20),
  }),
  /** Hosts the user has connected, and where each one's token comes from. */
  hosts: z.array(
    z.object({
      hostname: z.string(),
      kind: HostKind,
      source: z.enum(['gh', 'glab', 'token']),
    }),
  ),
  editor: EditorChoice,
  theme: Theme,
  privacy: z.object({ crashReports: z.boolean() }),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  claude: {
    auth: 'claude-code',
    executablePath: null,
    bedrock: { region: 'us-east-1', profile: '' },
    vertex: { projectId: '', region: 'global' },
    foundry: { resource: '' },
  },
  tiers: {
    strong: { provider: 'anthropic', model: 'claude-opus-5-5' },
    mid: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    fast: { provider: 'anthropic', model: 'claude-haiku-5-5' },
  },
  spend: { explanationCapUsd: 0.5, agentReviewCapUsd: 5 },
  agents: { concurrency: 6 },
  diff: { layout: 'unified', ignoreWhitespace: false, contextLines: 3 },
  hosts: [],
  editor: 'vscode',
  theme: 'system',
  privacy: { crashReports: false },
};

/** Secrets live only in the OS keychain (Electron safeStorage), never in SQLite. */
export const SecretName = z.union([z.enum(['anthropic-api-key', 'foundry-api-key']), z.string().regex(/^host-token:[a-z0-9.-]+(:\d+)?$/i)]);
export type SecretName = z.infer<typeof SecretName>;

export const hostTokenSecret = (hostname: string) => `host-token:${hostname.toLowerCase()}`;

export interface HostAccount {
  hostname: string;
  host: HostKind;
  /** Where the token comes from. */
  source: 'gh' | 'glab' | 'token' | 'none';
  login: string | null;
  connected: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Helpers

export function isRangeTarget(t: ExplanationTarget): t is Extract<ExplanationTarget, { kind: 'range' }> {
  return t.kind === 'range';
}

export function targetLabel(t: ExplanationTarget): string {
  if (t.kind === 'file') return `${t.path} · whole file`;
  const r = t.headRange ?? t.baseRange;
  if (!r) return t.path;
  const side = t.headRange ? '' : ' (removed)';
  return r[0] === r[1] ? `${t.path}:${r[0]}${side}` : `${t.path}:${r[0]}–${r[1]}${side}`;
}
