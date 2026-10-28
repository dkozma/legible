import type {
  ClaudeAuth,
  ModelInfo,
  ModelTier,
  OpenAIAuth,
  Provider,
  RuntimeStatus,
  TaskKind,
} from "@legible/domain"
import type { GitRepo } from "@legible/git"
import type { z } from "zod"

export type { TaskKind } from "@legible/domain"

/** What a task's tools can read: the Review's repository at Base and Head. */
export interface ToolContext {
  repo: GitRepo
  baseSha: string
  headSha: string
  /** Paths changed in the Change Set, for get_change_set_summary. */
  changedFiles: {
    path: string
    oldPath: string | null
    status: string
    additions: number
    deletions: number
  }[]
}

export interface AgentTask<T> {
  kind: TaskKind
  modelTier: ModelTier
  /** Versioned prompt. */
  system: string
  prompt: string
  /** Names of Legible tools granted to this task. */
  tools: string[]
  access: "read-only" | "revision-write"
  output: z.ZodType<T> | null
  context: ToolContext
  /** Keeps tool loops short for interactive tasks. */
  maxTurns: number
  /** Thinking effort; lower is faster. Null = the model's default. */
  effort: "low" | "medium" | "high" | null
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }

export interface RunOptions {
  signal: AbortSignal
  budgetUsd: number
  onEvent?: (e: AgentEvent) => void
}

export interface AgentResult<T> {
  output: T | null
  text: string
  provider: Provider
  model: string
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  numTurns: number
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly code:
      | "budget"
      | "max_turns"
      | "structured_output"
      | "auth"
      | "not_installed"
      | "aborted"
      | "execution",
  ) {
    super(message)
    this.name = "AgentError"
  }
}

export interface AgentRuntime {
  readonly provider: Provider
  run<T>(
    task: AgentTask<T>,
    model: string,
    opts: RunOptions,
  ): Promise<AgentResult<T>>
  status(): Promise<RuntimeStatus>
  models(): Promise<ModelInfo[]>
}

export interface ClaudeRuntimeConfig {
  auth: ClaudeAuth
  /** "Use my Claude Code": the user's own binary. Null = resolve from the login shell. */
  executablePath: string | null
  /** Credentials and provider selection, passed only as environment variables. */
  env: Record<string, string>
  bedrock: { region: string; profile: string }
  vertex: { projectId: string; region: string }
  foundry: { resource: string }
  /** Identifies Legible in the User-Agent. */
  clientApp: string
  /** Working directory for agent processes; an empty directory, since agents get no file tools. */
  scratchDir: string
  /** Path to the SDK's bundled binary when it can't be found automatically (packaged apps). */
  bundledExecutable: string | null
}

export interface OpenAIRuntimeConfig {
  auth: OpenAIAuth
  apiKey: string | null
  /** Continue with ChatGPT: an access token main keeps fresh, and the account it belongs to. */
  chatgpt: {
    accessToken: string
    accountId: string | null
    baseURL: string
  } | null
}
