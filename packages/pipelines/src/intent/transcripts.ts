// Agent Transcript import (engineering plan §9.1, step 2): finds the local
// Claude Code and Codex CLI sessions that may have produced a Change Set and
// extracts the user's prompts, the agent's plans and the user's corrections.
//
// Both formats are internal and undocumented. Parsing is defensive: unknown
// lines are skipped, and a file that can't be read yields nothing rather than
// an error.

import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

import type { AgentTool } from "@legible/domain"

export interface TranscriptSession {
  /** `${tool}:${session id}`. */
  id: string
  tool: AgentTool
  cwd: string
  branch: string | null
  startedAt: string
  endedAt: string
  prompts: string[]
  plans: string[]
  corrections: string[]
}

/** A user message that pushes back on what the agent did. */
const CORRECTION =
  /^\s*(no\b|nope\b|actually\b|wait\b|hmm\b|don'?t\b|do not\b|stop\b|instead\b|that'?s (not|wrong)|this is (not|wrong)|not what|revert\b|undo\b|why did you|you (shouldn'?t|should not|broke|removed|deleted|forgot|missed|changed))/i

/** Wrapper messages tools inject that aren't the user's words. */
const NOT_A_PROMPT =
  /^\s*(<command-|<local-command|<environment_context|<user_instructions|<system-reminder|Caveat:|\[Request interrupted)/

const MAX_FILE_BYTES = 50 * 1024 * 1024

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((p: unknown) => {
      if (!p || typeof p !== "object") return ""
      const part = p as { type?: unknown; text?: unknown }
      return (part.type === "text" || part.type === "input_text") &&
        typeof part.text === "string"
        ? part.text
        : ""
    })
    .filter(Boolean)
    .join("\n")
}

function lines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const v = JSON.parse(line) as unknown
      if (v && typeof v === "object" && !Array.isArray(v))
        out.push(v as Record<string, unknown>)
    } catch {
      // A partial last line while the session is still being written.
    }
  }
  return out
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null

function finish(
  s: Omit<TranscriptSession, "corrections"> & {
    /** Prompts after the agent had answered at least once. */
    later: string[]
  },
): TranscriptSession | null {
  if (!s.prompts.length || !s.cwd) return null
  const { later, ...rest } = s
  return { ...rest, corrections: later.filter((p) => CORRECTION.test(p)) }
}

/** One Claude Code session: `~/.claude/projects/<folder>/<session>.jsonl`. */
export function parseClaudeCodeSession(text: string): TranscriptSession | null {
  let id: string | null = null
  let cwd = ""
  let branch: string | null = null
  let first: string | null = null
  let last: string | null = null
  const prompts: string[] = []
  const later: string[] = []
  const plans: string[] = []
  let answered = false
  for (const l of lines(text)) {
    const ts = str(l.timestamp)
    if (ts) {
      first ??= ts
      last = ts
    }
    id ??= str(l.sessionId)
    cwd = str(l.cwd) ?? cwd
    branch = str(l.gitBranch) ?? branch
    // Subagent and tool-generated turns aren't the user's.
    if (l.isSidechain === true || l.isMeta === true) continue
    const message = l.message as { content?: unknown } | undefined
    if (l.type === "user" && message) {
      const t = textOf(message.content).trim()
      if (!t || NOT_A_PROMPT.test(t)) continue
      prompts.push(t)
      if (answered) later.push(t)
    } else if (l.type === "assistant" && message) {
      answered = true
      if (Array.isArray(message.content))
        for (const part of message.content as {
          type?: unknown
          name?: unknown
          input?: { plan?: unknown }
        }[])
          if (
            part.type === "tool_use" &&
            part.name === "ExitPlanMode" &&
            typeof part.input?.plan === "string"
          )
            plans.push(part.input.plan)
    }
  }
  if (!id || !first || !last) return null
  return finish({
    id: `claude-code:${id}`,
    tool: "claude-code",
    cwd,
    branch,
    startedAt: first,
    endedAt: last,
    prompts,
    plans,
    later,
  })
}

/** One Codex CLI session: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. */
export function parseCodexSession(text: string): TranscriptSession | null {
  let id: string | null = null
  let cwd = ""
  let branch: string | null = null
  let first: string | null = null
  let last: string | null = null
  const prompts: string[] = []
  const later: string[] = []
  const plans: string[] = []
  let answered = false
  for (const l of lines(text)) {
    const ts = str(l.timestamp)
    if (ts) {
      first ??= ts
      last = ts
    }
    const p = (l.payload ?? {}) as Record<string, unknown>
    if (l.type === "session_meta") {
      id ??= str(p.id)
      cwd = str(p.cwd) ?? cwd
      branch =
        str((p.git as { branch?: unknown } | undefined)?.branch) ?? branch
      first = str(p.timestamp) ?? first
    } else if (l.type === "event_msg" && p.type === "user_message") {
      const t = (str(p.message) ?? "").trim()
      if (!t || NOT_A_PROMPT.test(t)) continue
      prompts.push(t)
      if (answered) later.push(t)
    } else if (l.type === "event_msg" && p.type === "agent_message") {
      answered = true
    } else if (
      l.type === "response_item" &&
      p.type === "message" &&
      p.role === "assistant"
    ) {
      answered = true
    } else if (
      l.type === "response_item" &&
      p.type === "function_call" &&
      p.name === "update_plan"
    ) {
      try {
        const args = JSON.parse(String(p.arguments)) as {
          plan?: { step?: unknown }[]
        }
        const steps = (args.plan ?? [])
          .map((s) => (typeof s.step === "string" ? `- ${s.step}` : ""))
          .filter(Boolean)
        if (steps.length) plans.push(steps.join("\n"))
      } catch {
        // Not the shape we know.
      }
    }
  }
  if (!id || !first || !last) return null
  return finish({
    id: `codex:${id}`,
    tool: "codex",
    cwd,
    branch,
    startedAt: first,
    endedAt: last,
    prompts,
    plans,
    later,
  })
}

/** Claude Code names a project's folder after its path, with every other character a dash. */
export const claudeProjectFolder = (path: string) =>
  path.replace(/[^a-zA-Z0-9]/g, "-")

export interface TranscriptQuery {
  /** `~/.claude` (or CLAUDE_CONFIG_DIR) and `~/.codex` (or CODEX_HOME). Null to skip a tool. */
  claudeDir: string | null
  codexDir: string | null
  /** The repository's working tree and any worktrees of it. */
  repoPaths: string[]
  branch: string | null
  /** When work on the Change Set may have happened. */
  since: Date
  until: Date
}

export interface FoundTranscript {
  session: TranscriptSession
  /** Why it matched, for the user. */
  match: string
  /** Overlaps the work and its branch doesn't contradict: used by default. */
  likely: boolean
}

const inside = (cwd: string, roots: string[]) =>
  roots.some((r) => cwd === r || cwd.startsWith(r.endsWith(sep) ? r : r + sep))

async function readSmall(path: string): Promise<string | null> {
  try {
    const s = await stat(path)
    if (s.size > MAX_FILE_BYTES) return null
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

async function recentFiles(dir: string, since: Date): Promise<string[]> {
  const out: string[] = []
  for (const name of await listDir(dir)) {
    if (!name.endsWith(".jsonl")) continue
    const path = join(dir, name)
    try {
      if ((await stat(path)).mtime >= since) out.push(path)
    } catch {
      // Gone since listing.
    }
  }
  return out
}

/** Sessions run in the repository during the window, most recent first. */
export async function findTranscripts(
  q: TranscriptQuery,
): Promise<FoundTranscript[]> {
  const roots = q.repoPaths.map((p) => resolve(p))
  const sessions: TranscriptSession[] = []

  if (q.claudeDir) {
    const projects = join(q.claudeDir, "projects")
    const prefixes = roots.map(claudeProjectFolder)
    for (const folder of await listDir(projects)) {
      if (!prefixes.some((p) => folder.startsWith(p))) continue
      for (const file of await recentFiles(join(projects, folder), q.since)) {
        const text = await readSmall(file)
        const s = text ? parseClaudeCodeSession(text) : null
        if (s) sessions.push(s)
      }
    }
  }

  if (q.codexDir) {
    const day = 86_400_000
    for (
      let t = q.since.getTime() - day;
      t <= q.until.getTime() + day;
      t += day
    ) {
      const d = new Date(t)
      const dir = join(
        q.codexDir,
        "sessions",
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      )
      for (const file of await recentFiles(dir, q.since)) {
        const text = await readSmall(file)
        const s = text ? parseCodexSession(text) : null
        if (s) sessions.push(s)
      }
    }
  }

  const found: FoundTranscript[] = []
  for (const s of sessions) {
    if (!inside(resolve(s.cwd), roots)) continue
    const start = Date.parse(s.startedAt)
    const end = Date.parse(s.endedAt)
    const overlaps = start <= q.until.getTime() && end >= q.since.getTime()
    if (!overlaps) continue
    const branchKnown = Boolean(s.branch && q.branch)
    const sameBranch = branchKnown && s.branch === q.branch
    const why = [
      "same folder",
      sameBranch
        ? `branch ${s.branch}`
        : branchKnown
          ? `on ${s.branch}, not ${q.branch}`
          : null,
      "during the work",
    ].filter(Boolean)
    found.push({
      session: s,
      match: why.join(" · "),
      likely: !branchKnown || sameBranch,
    })
  }
  return found
    .toSorted((a, b) => b.session.endedAt.localeCompare(a.session.endedAt))
    .slice(0, 10)
}
