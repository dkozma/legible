// AgentRuntime over the Claude Agent SDK (ADR 0002).
//
// Two ways to authenticate:
//  - "Use my Claude Code": the SDK drives the user's own installed, signed-in
//    `claude`. Legible never reads, stores or proxies its credentials.
//  - Usage-based: an Anthropic API key, Bedrock, Vertex, or Foundry, passed to
//    the SDK's bundled binary only as environment variables.
//
// Agents load no settings, hooks, plugins, skills or MCP config from disk
// (ADR 0004), get no built-in tools, and can only call Legible's read tools.

import { execFile } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  createSdkMcpServer,
  type Options,
  query,
  type SDKMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk"
import type { ModelInfo, RuntimeStatus } from "@legible/domain"

import { MODEL_CATALOG } from "./catalog"
import { toJsonSchema } from "./schemaLint"
import { grantedTools, summarizeToolCall } from "./tools"
import {
  AgentError,
  type AgentResult,
  type AgentRuntime,
  type AgentTask,
  type ClaudeRuntimeConfig,
  type RunOptions,
} from "./types"

const MCP_SERVER = "legible"

function exec(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs, env: opts.env, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        const code = err
          ? typeof (err as NodeJS.ErrnoException).code === "number"
            ? Number((err as NodeJS.ErrnoException).code)
            : 1
          : 0
        resolve({ stdout: stdout ?? "", code })
      },
    )
  })
}

async function isExecutable(p: string) {
  try {
    await access(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Finds the user's `claude`: an explicit path, then the login shell's PATH
 * (GUI apps on macOS don't inherit it), then the usual install locations.
 */
export async function resolveClaudeExecutable(
  explicit: string | null,
): Promise<string | null> {
  if (explicit) return (await isExecutable(explicit)) ? explicit : null
  if (process.platform !== "win32") {
    const shell = process.env.SHELL || "/bin/zsh"
    const r = await exec(shell, ["-ilc", "command -v claude"], {
      timeoutMs: 5000,
      env: { ...process.env, DISABLE_AUTO_UPDATE: "true" },
    })
    const found = r.stdout
      .split("\n")
      .map((s) => s.trim())
      .toReversed()
      .find((s) => s.startsWith("/"))
    if (found && (await isExecutable(found))) return found
  } else {
    const r = await exec("where", ["claude"], { timeoutMs: 5000 })
    const found = r.stdout.split(/\r?\n/).find((s) => s.trim())
    if (found) return found.trim()
  }
  const home = homedir()
  for (const p of [
    join(home, ".local/bin/claude"),
    join(home, ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ]) {
    if (await isExecutable(p)) return p
  }
  return null
}

export class ClaudeSdkRuntime implements AgentRuntime {
  readonly provider = "anthropic" as const
  private resolvedExecutable: Promise<string | null> | null = null

  constructor(private readonly config: ClaudeRuntimeConfig) {}

  private executable(): Promise<string | null> {
    if (this.config.auth !== "claude-code") return Promise.resolve(null)
    this.resolvedExecutable ??= resolveClaudeExecutable(
      this.config.executablePath,
    )
    return this.resolvedExecutable
  }

  /** Environment for the agent process: inherited, plus provider selection and credentials. */
  private env(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: this.config.clientApp,
      // Agents must not pick up repo or user automation even if settings leak through.
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
    }
    const c = this.config
    switch (c.auth) {
      case "claude-code":
        // Use the claude.ai sign-in. Run non-interactively, claude prefers an API key or
        // token from the environment, so one exported in the user's shell would otherwise
        // bill Explanations to that key instead of their plan.
        delete env.ANTHROPIC_API_KEY
        delete env.ANTHROPIC_AUTH_TOKEN
        break
      case "anthropic-api":
        env.ANTHROPIC_API_KEY = c.env.ANTHROPIC_API_KEY
        break
      case "bedrock":
        env.CLAUDE_CODE_USE_BEDROCK = "1"
        if (c.bedrock.region) env.AWS_REGION = c.bedrock.region
        if (c.bedrock.profile) env.AWS_PROFILE = c.bedrock.profile
        break
      case "vertex":
        env.CLAUDE_CODE_USE_VERTEX = "1"
        if (c.vertex.projectId)
          env.ANTHROPIC_VERTEX_PROJECT_ID = c.vertex.projectId
        if (c.vertex.region) env.CLOUD_ML_REGION = c.vertex.region
        break
      case "foundry":
        env.CLAUDE_CODE_USE_FOUNDRY = "1"
        if (c.foundry.resource)
          env.ANTHROPIC_FOUNDRY_RESOURCE = c.foundry.resource
        env.ANTHROPIC_FOUNDRY_API_KEY = c.env.ANTHROPIC_FOUNDRY_API_KEY
        break
    }
    return env
  }

  /** Bedrock model ids carry an `anthropic.` prefix; the others use the first-party id. */
  private modelId(model: string): string {
    if (this.config.auth === "bedrock" && !model.includes("."))
      return `anthropic.${model}`
    return model
  }

  async run<T>(
    task: AgentTask<T>,
    model: string,
    opts: RunOptions,
  ): Promise<AgentResult<T>> {
    const started = Date.now()
    const tools = grantedTools(task.tools)
    if (task.access !== "read-only")
      throw new AgentError("Revision writes arrive in M4.", "execution")

    const server = createSdkMcpServer({
      name: MCP_SERVER,
      version: "1.0.0",
      alwaysLoad: true,
      tools: tools.map((t) =>
        tool(
          t.name,
          t.description,
          t.input,
          async (args: Record<string, unknown>) => {
            opts.onEvent?.({
              type: "tool",
              name: t.name,
              summary: summarizeToolCall(t.name, args),
            })
            try {
              const text = await t.handler(args as never, task.context)
              return { content: [{ type: "text" as const, text }] }
            } catch (e) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: ${(e as Error).message}`,
                  },
                ],
                isError: true,
              }
            }
          },
        ),
      ),
    })
    const allowed = tools.map((t) => `mcp__${MCP_SERVER}__${t.name}`)

    const abort = new AbortController()
    const onAbort = () => abort.abort()
    opts.signal.addEventListener("abort", onAbort, { once: true })

    const executable = await this.executable()
    if (this.config.auth === "claude-code" && !executable) {
      throw new AgentError(
        "Claude Code isn't installed or isn't on your PATH. Install it, sign in with `claude`, then Recheck in Settings.",
        "not_installed",
      )
    }

    const options: Options = {
      model: this.modelId(model),
      cwd: this.config.scratchDir,
      systemPrompt: task.system,
      // ADR 0004: nothing from disk — no settings, hooks, plugins, skills, CLAUDE.md or MCP config.
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: { [MCP_SERVER]: server },
      // No built-in tools at all: no Bash, file edits, web access, or subagents.
      tools: [],
      // Only the granted Legible tools are pre-approved; dontAsk denies everything else without prompting.
      allowedTools: allowed,
      permissionMode: "dontAsk",
      maxTurns: task.maxTurns,
      maxBudgetUsd: opts.budgetUsd,
      abortController: abort,
      env: this.env(),
      persistSession: false,
      ...(task.effort ? { effort: task.effort } : {}),
      ...(task.output
        ? {
            outputFormat: {
              type: "json_schema" as const,
              schema: toJsonSchema(task.output),
            },
          }
        : {}),
      // The user's own `claude`, or (usage-based auth) the SDK's bundled binary; a packaged app passes its unpacked path.
      ...(executable || this.config.bundledExecutable
        ? {
            pathToClaudeCodeExecutable: (executable ??
              this.config.bundledExecutable) as string,
          }
        : {}),
    }

    let text = ""
    let result: Extract<SDKMessage, { type: "result" }> | null = null
    let stderr = ""
    // Claude reports the exact cost only in the final result. A run that ends without one
    // (cancelled, crashed) is charged from per-message usage at catalog prices.
    const price = MODEL_CATALOG.find((m) => m.id === model)
    let estimatedUsd = 0
    const charged = (e: AgentError, costUsd: number) =>
      Object.assign(e, { costUsd })
    try {
      opts.onEvent?.({ type: "status", message: "Starting Claude" })
      const q = query({
        prompt: task.prompt,
        options: {
          ...options,
          stderr: (d) => (stderr = (stderr + d).slice(-4000)),
        },
      })
      for await (const msg of q) {
        if (msg.type === "assistant") {
          const u = msg.message.usage
          if (price && u) {
            const input =
              u.input_tokens +
              (u.cache_read_input_tokens ?? 0) +
              (u.cache_creation_input_tokens ?? 0)
            estimatedUsd +=
              (input * (price.inputPrice ?? 0) +
                u.output_tokens * (price.outputPrice ?? 0)) /
              1e6
          }
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text) {
              text += block.text
              opts.onEvent?.({ type: "text", text: block.text })
            }
          }
        } else if (msg.type === "system" && msg.subtype === "init") {
          opts.onEvent?.({ type: "status", message: "Thinking" })
        } else if (msg.type === "result") {
          result = msg
        }
      }
    } catch (e) {
      if (opts.signal.aborted)
        throw charged(new AgentError("Cancelled", "aborted"), estimatedUsd)
      throw charged(
        classifyError(e as Error, stderr, this.config.auth),
        estimatedUsd,
      )
    } finally {
      opts.signal.removeEventListener("abort", onAbort)
    }

    if (!result)
      throw charged(
        new AgentError(
          `Claude ended without a result.${stderr ? ` ${lastLine(stderr)}` : ""}`,
          "execution",
        ),
        estimatedUsd,
      )
    const usage = Object.values(result.modelUsage ?? {})
    const base = {
      text,
      provider: this.provider,
      model,
      costUsd: result.total_cost_usd ?? 0,
      durationMs: Date.now() - started,
      inputTokens: usage.reduce(
        (n, u) =>
          n +
          u.inputTokens +
          u.cacheReadInputTokens +
          u.cacheCreationInputTokens,
        0,
      ),
      outputTokens: usage.reduce((n, u) => n + u.outputTokens, 0),
      numTurns: result.num_turns,
    }
    if (result.subtype !== "success") {
      const messages: Record<string, [string, AgentError["code"]]> = {
        error_max_budget_usd: [
          `Stopped at the spend cap ($${opts.budgetUsd.toFixed(2)}). Raise it in Settings → Spend.`,
          "budget",
        ],
        error_max_turns: [
          "Stopped after too many steps without an answer.",
          "max_turns",
        ],
        error_max_structured_output_retries: [
          "Claude's answer didn't match the expected shape after several tries.",
          "structured_output",
        ],
        error_during_execution: [
          `Claude failed: ${result.errors?.join("; ") || lastLine(stderr) || "unknown error"}`,
          "execution",
        ],
      }
      const [message, code] = messages[result.subtype] ?? [
        `Claude failed (${result.subtype})`,
        "execution",
      ]
      throw charged(new AgentError(message, code), base.costUsd)
    }
    if (result.is_error)
      throw charged(
        classifyError(
          new Error(result.result || "Claude returned an error"),
          stderr,
          this.config.auth,
        ),
        base.costUsd,
      )

    let output: T | null = null
    if (task.output) {
      const parsed = task.output.safeParse(result.structured_output)
      if (!parsed.success)
        throw charged(
          new AgentError(
            `Claude's answer didn't match the expected shape: ${parsed.error.message.slice(0, 300)}`,
            "structured_output",
          ),
          base.costUsd,
        )
      output = parsed.data
    }
    return { ...base, output }
  }

  async status(): Promise<RuntimeStatus> {
    const auth = this.config.auth
    if (auth !== "claude-code") {
      const ready =
        auth === "anthropic-api"
          ? Boolean(this.config.env.ANTHROPIC_API_KEY)
          : auth === "foundry"
            ? Boolean(
                this.config.env.ANTHROPIC_FOUNDRY_API_KEY &&
                this.config.foundry.resource,
              )
            : auth === "vertex"
              ? Boolean(this.config.vertex.projectId)
              : Boolean(this.config.bedrock.region)
      const labels = {
        "anthropic-api": "Anthropic API key",
        bedrock: "Amazon Bedrock",
        vertex: "Google Vertex AI",
        foundry: "Microsoft Foundry",
      } as const
      return {
        provider: "anthropic",
        auth,
        ready,
        detail: ready
          ? `${labels[auth]} configured`
          : `${labels[auth]} isn't configured yet`,
        executablePath: null,
        version: null,
      }
    }
    this.resolvedExecutable = null
    const exe = await this.executable()
    if (!exe) {
      return {
        provider: "anthropic",
        auth,
        ready: false,
        detail: "Couldn't find `claude` on your PATH",
        executablePath: null,
        version: null,
      }
    }
    // The same environment runs get, so the status describes what an Explanation would use.
    const env = this.env()
    const v = await exec(exe, ["--version"], { timeoutMs: 10_000, env })
    const version = v.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null
    // `claude auth status` reports whether the user is signed in without exposing credentials.
    const s = await exec(exe, ["auth", "status", "--json"], {
      timeoutMs: 10_000,
      env,
    })
    let loggedIn: boolean | null = null
    let configDir: string | null = null
    try {
      const j = JSON.parse(s.stdout) as {
        loggedIn?: unknown
        configDirectory?: unknown
      }
      // Anything but an explicit true/false is unknown, not signed out.
      if (typeof j.loggedIn === "boolean") loggedIn = j.loggedIn
      if (typeof j.configDirectory === "string") configDir = j.configDirectory
    } catch {
      loggedIn = null
    }
    const ready = loggedIn !== false
    // Say which `claude` ran and where it looked: a different install, or a
    // CLAUDE_CONFIG_DIR the terminal sets, is the usual reason it disagrees with the terminal.
    const detail =
      loggedIn === false
        ? `Claude Code at ${exe} isn't signed in${configDir ? ` (it looked in ${configDir})` : ""}. Run \`claude\` in a terminal to sign in, or set the path your terminal uses in Settings → Providers.`
        : `Claude Code${version ? ` ${version}` : ""}${loggedIn ? ", signed in" : ""}`
    return {
      provider: "anthropic",
      auth,
      ready,
      detail,
      executablePath: exe,
      version,
    }
  }

  async models(): Promise<ModelInfo[]> {
    return MODEL_CATALOG.filter((m) => m.provider === "anthropic")
  }
}

function lastLine(s: string): string {
  return s.trim().split("\n").filter(Boolean).pop()?.slice(0, 300) ?? ""
}

function classifyError(e: Error, stderr: string, auth: string): AgentError {
  const msg = `${e.message}\n${stderr}`
  if (/not found|ENOENT|executable_not_found/i.test(msg)) {
    return new AgentError(
      "Couldn't start Claude Code. Check its path in Settings → Providers.",
      "not_installed",
    )
  }
  if (
    /401|authentication|invalid api key|not logged in|please run \/login|oauth/i.test(
      msg,
    )
  ) {
    return new AgentError(
      auth === "claude-code"
        ? "Claude Code isn't signed in. Run `claude` in a terminal to sign in, then retry."
        : "Claude rejected the credentials. Check them in Settings → Providers.",
      "auth",
    )
  }
  if (/structured output|StructuredOutput|required schema/i.test(msg)) {
    return new AgentError(
      `Claude's answer didn't match the expected shape: ${e.message.split("\n")[0]?.slice(0, 300)}`,
      "structured_output",
    )
  }
  return new AgentError(
    `Claude failed: ${e.message.split("\n")[0]?.slice(0, 300)}`,
    "execution",
  )
}
