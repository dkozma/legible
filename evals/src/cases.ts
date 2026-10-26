// Labeled eval cases. Each case is a folder under evals/cases/:
//
//   case.json   the Intent, an optional Pull Request description, and labels
//   base/       every file on Base
//   head/       files added or changed on Head (deletions listed in case.json)
//
// Or, instead of base/ and head/, a `generator` script that builds the
// repository (the M0 refund fixture), whose uncommitted edits join Head.
//
// Labels point at code by path, optionally with a Head line range
// ("src/a.ts@12-20") or a Base one ("src/a.ts@b4-9"), so they survive any
// change to how Fragments are cut or named.

import { execFileSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { Layer } from "@legible/domain"

export interface CaseLabels {
  /** Code that belongs in one Step together. Each inner list is one Step. */
  steps: string[][]
  /** The Layer of each path. */
  layers: Record<string, Layer>
  /** Code the Intent didn't ask for. */
  unrequested: string[]
  /** Domain Changes, in a few words each. */
  domainChanges: string[]
  /** How many Chapters (independent features); 0 or 1 means none. */
  chapters: number
}

export interface EvalCase {
  name: string
  description: string
  intent: { goal: string; requirements: string[] } | null
  pullRequest: { title: string; body: string } | null
  /** Paths removed on Head. */
  deleted: string[]
  /** A script that builds the repository instead of base/ and head/. */
  generator: string | null
  labels: CaseLabels
  dir: string
}

export const CASES_DIR = resolve(__dirname, "../cases")

export function loadCases(dir = CASES_DIR, only?: string): EvalCase[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (!only || d.name === only))
    .map((d) => {
      const raw = JSON.parse(
        readFileSync(join(dir, d.name, "case.json"), "utf8"),
      ) as Partial<EvalCase>
      return {
        name: d.name,
        description: raw.description ?? "",
        intent: raw.intent ?? null,
        pullRequest: raw.pullRequest ?? null,
        deleted: raw.deleted ?? [],
        generator: raw.generator ?? null,
        labels: {
          steps: raw.labels?.steps ?? [],
          layers: raw.labels?.layers ?? {},
          unrequested: raw.labels?.unrequested ?? [],
          domainChanges: raw.labels?.domainChanges ?? [],
          chapters: raw.labels?.chapters ?? 0,
        },
        dir: join(dir, d.name),
      }
    })
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Eval",
  GIT_AUTHOR_EMAIL: "eval@example.com",
  GIT_COMMITTER_NAME: "Eval",
  GIT_COMMITTER_EMAIL: "eval@example.com",
  GIT_AUTHOR_DATE: "2026-10-01T09:00:00Z",
  GIT_COMMITTER_DATE: "2026-10-01T09:00:00Z",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
}

/** Builds the case's repository: Base on `main`, Head on `feature`. Returns its path. */
export function materialize(c: EvalCase): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `legible-eval-${c.name}-`))
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env, stdio: "pipe" })
  if (c.generator) {
    execFileSync("node", [resolve(__dirname, "../..", c.generator), dir], {
      stdio: "pipe",
    })
    git("add", "-A")
    git("commit", "-qm", "Uncommitted work", "--allow-empty")
  } else {
    git("init", "-q", "-b", "main")
    cpSync(join(c.dir, "base"), dir, { recursive: true })
    git("add", "-A")
    git("commit", "-qm", "Base")
    git("checkout", "-qb", "feature")
    if (existsSync(join(c.dir, "head")))
      cpSync(join(c.dir, "head"), dir, { recursive: true })
    for (const p of c.deleted) rmSync(join(dir, p), { force: true })
    git("add", "-A")
    git("commit", "-qm", c.pullRequest?.title ?? "Head")
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
