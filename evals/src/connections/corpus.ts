// The commits the Connections eval scores, and a SCIP index for each commit
// and its parent: a detached worktree per commit under evals/.cache/, its
// dependencies installed, `scip-typescript index`, the worktree removed.
// Indexes are cached by commit and scip-typescript version.

import { execFile } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

export const EVALS_DIR = resolve(__dirname, "../..")
export const CACHE_DIR = join(EVALS_DIR, ".cache")

export interface CorpusEntry {
  name: string
  /** "self": this repository. A URL and pinned revision: cloned into the cache. A path: a local repository (local mode). */
  source: "self" | { url: string; rev: string } | { path: string; rev?: string }
  /** The latest N non-merge commits touching .ts or .tsx at the revision, or these commits. */
  commits: number | string[]
  /** Run in each worktree before indexing; null for none. */
  install: string | null
  /** Install in every commit's worktree (a workspace whose links must point into it), or once at the revision and link node_modules in. */
  perCommitInstall: boolean
  /** tsconfig files to index, relative to the repository root; the root project when absent. */
  projects?: string[]
}

export interface CommitIndexes {
  sha: string
  parent: string
  subject: string
  /** SCIP files for the parent (Base) and the commit (Head). */
  base: string | null
  head: string | null
  /** Why this commit can't be scored, if it can't. */
  skipped: string | null
}

export interface PreparedEntry {
  entry: CorpusEntry
  /** The repository to build Change Sets from. */
  repoDir: string
  commits: CommitIndexes[]
}

export function loadCorpus(file = join(EVALS_DIR, "corpus/connections.json")) {
  return JSON.parse(readFileSync(file, "utf8")) as CorpusEntry[]
}

/** Local mode: EVAL_REPO, EVAL_COMMITS (default 20), EVAL_INSTALL. Null when EVAL_REPO isn't set. */
export function localEntry(
  vars: NodeJS.ProcessEnv = process.env,
): CorpusEntry | null {
  if (!vars.EVAL_REPO) return null
  const n = Number(vars.EVAL_COMMITS ?? 20)
  if (!(n > 0 && Number.isInteger(n)))
    throw new Error(
      `EVAL_COMMITS must be a whole number of commits, not "${vars.EVAL_COMMITS}".`,
    )
  // pnpm runs the script in evals/; a relative path means where you ran it.
  const path = resolve(vars.INIT_CWD ?? process.cwd(), vars.EVAL_REPO)
  return {
    name: `local-${path.split("/").filter(Boolean).pop() ?? "repo"}`,
    source: { path },
    commits: n,
    install: vars.EVAL_INSTALL || null,
    perCommitInstall: false,
  }
}

export const SCIP_TYPESCRIPT = (() => {
  const req = createRequire(join(EVALS_DIR, "package.json"))
  const pkg = req.resolve("@sourcegraph/scip-typescript/package.json")
  const { version, bin } = JSON.parse(readFileSync(pkg, "utf8")) as {
    version: string
    bin: string
  }
  return { version, main: join(dirname(pkg), bin) }
})()

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

async function sh(cwd: string, command: string) {
  await run("sh", ["-c", command], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: "1" },
  })
}

/** The last lines of a failed command's output, without local paths: they go into committed results. */
function failure(e: unknown, worktree: string): string {
  const err = e as { stderr?: string; stdout?: string; message?: string }
  const text = (err.stderr || err.stdout || err.message || String(e))
    .replaceAll(`${worktree}/`, "")
    .replaceAll(worktree, ".")
    .trim()
  return text.split("\n").slice(-3).join(" ").slice(0, 300)
}

/** The repository for an entry, cloned or fetched as needed, and the revision its commits are counted from. */
async function repository(
  entry: CorpusEntry,
  dir: string,
): Promise<{ repoDir: string; rev: string }> {
  const s = entry.source
  if (s === "self") {
    const top = (await git(EVALS_DIR, ["rev-parse", "--show-toplevel"])).trim()
    return { repoDir: top, rev: "HEAD" }
  }
  if ("path" in s) return { repoDir: s.path, rev: s.rev ?? "HEAD" }
  const repoDir = join(dir, "repo.git")
  if (!existsSync(repoDir)) {
    mkdirSync(dir, { recursive: true })
    await git(dir, ["clone", "--quiet", "--bare", s.url, repoDir])
  }
  const have = await run("git", ["cat-file", "-e", `${s.rev}^{commit}`], {
    cwd: repoDir,
  }).then(
    () => true,
    () => false,
  )
  if (!have) await git(repoDir, ["fetch", "--quiet", "origin", s.rev])
  return { repoDir, rev: s.rev }
}

async function selectCommits(
  repoDir: string,
  rev: string,
  commits: CorpusEntry["commits"],
): Promise<{ sha: string; parent: string | null; subject: string }[]> {
  const list =
    typeof commits === "number"
      ? (
          await git(repoDir, [
            "log",
            "--no-merges",
            `--max-count=${commits}`,
            "--format=%H",
            rev,
            "--",
            "*.ts",
            "*.tsx",
          ])
        )
          .split("\n")
          .filter(Boolean)
      : commits
  const out = []
  for (const c of list) {
    const [sha, parent, subject] = (
      await git(repoDir, ["log", "-1", "--format=%H%x00%P%x00%s", c])
    )
      .trim()
      .split("\0")
    out.push({
      sha: sha as string,
      parent: parent?.split(" ")[0] || null,
      subject: subject ?? "",
    })
  }
  return out
}

/**
 * A SCIP index for every commit of an entry and its parent, built or from
 * the cache. Commits that can't be indexed are kept with the reason.
 */
export async function prepare(
  entry: CorpusEntry,
  log: (line: string) => void = () => {},
): Promise<PreparedEntry> {
  const dir = join(CACHE_DIR, "connections", entry.name)
  const { repoDir, rev } = await repository(entry, dir)
  const selected = await selectCommits(repoDir, rev, entry.commits)
  const scipDir = join(dir, `scip-typescript-${SCIP_TYPESCRIPT.version}`)
  mkdirSync(scipDir, { recursive: true })

  // Dependencies installed once, at the revision, for entries that link them in.
  let shared: string | null = null
  const sharedDeps = async (): Promise<string> => {
    if (shared) return shared
    const deps = join(dir, "deps")
    const sha = (await git(repoDir, ["rev-parse", `${rev}^{commit}`])).trim()
    const stamp = join(deps, ".legible-rev")
    if (
      !existsSync(stamp) ||
      readFileSync(stamp, "utf8").trim() !== sha ||
      !existsSync(join(deps, "node_modules"))
    ) {
      rmSync(deps, { recursive: true, force: true })
      await git(repoDir, ["worktree", "prune"])
      await git(repoDir, ["worktree", "add", "--detach", "--force", deps, sha])
      if (entry.install) {
        log(`  installing ${entry.name} dependencies at ${sha.slice(0, 8)}`)
        await sh(deps, entry.install)
      }
      writeFileSync(stamp, sha)
    }
    shared = deps
    return deps
  }

  const errors = new Map<string, string>()
  const indexOf = async (sha: string): Promise<string | null> => {
    const out = join(scipDir, `${sha}.scip`)
    if (existsSync(out)) return out
    if (errors.has(sha)) return null
    const partial = `${out}.partial`
    const wt = join(dir, `wt-${sha.slice(0, 12)}`)
    const started = Date.now()
    try {
      rmSync(wt, { recursive: true, force: true })
      await git(repoDir, ["worktree", "prune"])
      await git(repoDir, ["worktree", "add", "--detach", "--force", wt, sha])
      if (entry.install && entry.perCommitInstall) await sh(wt, entry.install)
      else if (!existsSync(join(wt, "node_modules"))) {
        const deps = await sharedDeps()
        if (existsSync(join(deps, "node_modules")))
          symlinkSync(join(deps, "node_modules"), join(wt, "node_modules"))
      }
      await run(
        process.execPath,
        [
          SCIP_TYPESCRIPT.main,
          "index",
          "--no-progress-bar",
          "--output",
          partial,
          ...(entry.projects ?? []),
        ],
        { cwd: wt, maxBuffer: 64 * 1024 * 1024 },
      )
      if (!existsSync(partial))
        throw new Error("scip-typescript wrote no index")
      // Only a finished index is cached.
      renameSync(partial, out)
      log(
        `  indexed ${entry.name} ${sha.slice(0, 8)} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      )
      return out
    } catch (e) {
      rmSync(partial, { force: true })
      const reason = failure(e, wt)
      errors.set(sha, reason)
      log(`  ${entry.name} ${sha.slice(0, 8)} not indexed: ${reason}`)
      return null
    } finally {
      await git(repoDir, ["worktree", "remove", "--force", wt]).catch(() =>
        rmSync(wt, { recursive: true, force: true }),
      )
    }
  }

  const commits: CommitIndexes[] = []
  for (const c of selected) {
    if (!c.parent) {
      commits.push({
        sha: c.sha,
        parent: "",
        subject: c.subject,
        base: null,
        head: null,
        skipped: "root commit: no parent to compare with",
      })
      continue
    }
    const base = await indexOf(c.parent)
    const head = await indexOf(c.sha)
    const reason = !base
      ? `parent ${c.parent.slice(0, 8)} not indexed: ${errors.get(c.parent)}`
      : !head
        ? `not indexed: ${errors.get(c.sha)}`
        : null
    commits.push({
      sha: c.sha,
      parent: c.parent,
      subject: c.subject,
      base,
      head,
      skipped: reason,
    })
  }
  return { entry, repoDir, commits }
}
