// Opening sources as Reviews, taking Snapshots, refreshing Iterations, and
// noticing when a working tree, branch or Pull Request moved.

import { type FSWatcher, watch } from "node:fs"
import { basename, join } from "node:path"

import type {
  ChangeSetSummary,
  FileDiff,
  Iteration,
  Mode,
  ReviewSummary,
  Source,
} from "@legible/domain"
import {
  ensureCacheClone,
  fetchRefs,
  GitRepo,
  tokenAuthEnv,
} from "@legible/git"
import {
  getPullRequest,
  HostError,
  type PullRequestInfo,
  parsePullRequestUrl,
} from "@legible/hosts"
import type { BuiltChangeSet } from "@legible/indexer"
import type { Store } from "@legible/store"

import type { HostService } from "./hosts"
import type { Indexer, IndexKey } from "./indexerCore"

export class UserError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = "UserError"
  }
}

interface RepoHandle {
  repo: GitRepo
  cached: boolean
}

export class ReviewService {
  private repos = new Map<string, RepoHandle>()
  private changeSets = new Map<string, Promise<BuiltChangeSet>>()
  private watcher: { reviewId: string; stop: () => void } | null = null
  private lastNotified = new Map<string, string>()
  /** The last working-tree check per Review, reused while the tree's signature holds. */
  private treeChecks = new Map<
    string,
    { signature: string; iterationId: string; tree: string }
  >()
  private locks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly store: Store,
    private readonly hosts: HostService,
    private readonly indexer: Indexer,
    private readonly cacheRoot: string,
    private readonly onChangesAvailable: (
      reviewId: string,
      detail: string,
    ) => void,
  ) {}

  dispose() {
    this.watcher?.stop()
    this.watcher = null
    for (const h of this.repos.values()) h.repo.close()
    this.repos.clear()
  }

  /**
   * Runs work that adds Iterations for one Review at a time. Concurrent opens
   * and refreshes would otherwise snapshot twice or race for the same seq.
   */
  private serial<T>(reviewId: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.locks.get(reviewId) ?? Promise.resolve()).then(fn)
    const tail = next.catch(() => undefined)
    this.locks.set(reviewId, tail)
    void tail.then(() => {
      if (this.locks.get(reviewId) === tail) this.locks.delete(reviewId)
    })
    return next
  }

  /**
   * Keeps one GitRepo per repository. Replacing it would orphan the old one's
   * cat-file process, or fail reads a Change Set build still has in flight.
   */
  private adopt(repoId: string, repo: GitRepo, cached: boolean): GitRepo {
    const existing = this.repos.get(repoId)
    if (existing) {
      if (existing.repo !== repo) repo.close()
      return existing.repo
    }
    this.repos.set(repoId, { repo, cached })
    return repo
  }

  // ---- Opening ------------------------------------------------------------------

  async open(source: Source): Promise<ReviewSummary> {
    if (source.kind === "pull_request") return this.openPullRequest(source.url)
    let opened: GitRepo
    try {
      opened = await GitRepo.open(source.repoPath)
    } catch {
      throw new UserError(`${source.repoPath} isn't inside a git repository.`)
    }
    const workTree = opened.workTree
    const remoteUrl = await opened.remoteUrl()
    const record = await this.store.upsertRepo({
      displayName: basename(workTree ?? opened.gitDir),
      gitDir: opened.gitDir,
      workTree,
      remoteUrl,
      host: remoteUrl ? hostOf(remoteUrl) : null,
    })
    const repo = this.adopt(record.id, opened, false)

    if (source.kind === "working_tree") {
      if (!workTree)
        throw new UserError("This repository has no working tree to snapshot.")
      const baseRef = source.baseRef ?? (await repo.defaultBaseRef())
      const branch = await repo.currentBranch()
      const existing = await this.store.findReview({
        repoId: record.id,
        sourceKind: "working_tree",
        baseRef,
        headRef: branch,
        prUrl: null,
      })
      const review =
        existing ??
        (await this.store.createReview({
          repoId: record.id,
          title: branch ?? "Detached HEAD",
          sourceKind: "working_tree",
          baseRef,
          headRef: branch,
          prUrl: null,
          prNumber: null,
          mode: "author",
          intentText: null,
        }))
      await this.serial(review.id, () =>
        this.snapshotIfMoved(review.id, repo, baseRef),
      )
      return this.summary(review.id)
    }

    const head = await repo.resolveCommit(source.headRef)
    const base = await repo.resolveCommit(source.baseRef)
    if (!head)
      throw new UserError(`Can't find ${source.headRef} in this repository.`)
    if (!base)
      throw new UserError(`Can't find ${source.baseRef} in this repository.`)
    const existing = await this.store.findReview({
      repoId: record.id,
      sourceKind: "refs",
      baseRef: source.baseRef,
      headRef: source.headRef,
      prUrl: null,
    })
    const review =
      existing ??
      (await this.store.createReview({
        repoId: record.id,
        title: `${source.baseRef}...${source.headRef}`,
        sourceKind: "refs",
        baseRef: source.baseRef,
        headRef: source.headRef,
        prUrl: null,
        prNumber: null,
        mode: "author",
        intentText: null,
      }))
    await this.serial(review.id, () =>
      this.addRefsIteration(review.id, repo, base, head),
    )
    return this.summary(review.id)
  }

  /** Adds an Iteration for a new head commit; a no-op if it's already the latest. */
  private async addRefsIteration(
    reviewId: string,
    repo: GitRepo,
    base: string,
    head: string,
  ) {
    const latest = await this.store.latestIteration(reviewId)
    if (latest?.headSha === head) return
    await this.store.addIteration({
      reviewId,
      kind: "refs",
      baseSha: await repo.mergeBase(base, head),
      headSha: head,
      headTree: null,
    })
  }

  /** Takes a Snapshot only if the working tree moved since the latest Iteration. */
  private async snapshotIfMoved(
    reviewId: string,
    repo: GitRepo,
    baseRef: string | null,
  ) {
    const latest = await this.store.latestIteration(reviewId)
    const tree = await repo.workingTreeTree()
    if (!latest || latest.headTree !== tree)
      await this.snapshotIteration(reviewId, repo, baseRef, tree)
  }

  private async snapshotIteration(
    reviewId: string,
    repo: GitRepo,
    baseRef: string | null,
    tree: string,
  ): Promise<Iteration> {
    const snapId = `${reviewId.slice(0, 8)}-${Date.now()}`
    const snap = await repo.snapshot(snapId, tree)
    const head = await repo.resolveCommit("HEAD")
    // Base is the merge-base with the base branch (three-dot). Without one, review uncommitted changes against HEAD.
    const baseTip = baseRef ? await repo.resolveCommit(baseRef) : null
    const baseSha = baseTip
      ? await repo.mergeBase(baseTip, snap.sha)
      : (head ?? snap.sha)
    const it = await this.store.addIteration({
      reviewId,
      kind: "snapshot",
      baseSha,
      headSha: snap.sha,
      headTree: snap.tree,
    })
    this.lastNotified.delete(reviewId)
    return it
  }

  private async pullRequestInfo(
    url: string,
  ): Promise<{ info: PullRequestInfo; token: string | null }> {
    const ref = parsePullRequestUrl(url)
    if (!ref)
      throw new UserError(
        "That doesn't look like a GitHub pull request or GitLab merge request URL.",
      )
    const token = await this.hosts.token(ref.hostname)
    try {
      return { info: await getPullRequest(ref, token), token }
    } catch (e) {
      if (e instanceof HostError)
        throw new UserError(e.message, e.needsAuth ? "needs_auth" : "host")
      throw e
    }
  }

  private async openPullRequest(url: string): Promise<ReviewSummary> {
    const { info, token } = await this.pullRequestInfo(url)
    const { ref } = info
    const env = token ? tokenAuthEnv(ref.hostname, token, ref.host) : undefined
    let fetched: GitRepo
    try {
      fetched = await ensureCacheClone({
        cacheRoot: this.cacheRoot,
        hostname: ref.hostname,
        project: ref.project,
        cloneUrl: info.cloneUrl,
        env,
      })
      await fetchRefs(fetched, [
        `+refs/heads/${info.baseRef}:refs/legible/pr/${ref.number}/base`,
        info.headRefspec,
      ])
    } catch (e) {
      throw new UserError(
        `Couldn't fetch ${ref.project}: ${(e as Error).message.split("\n")[0]}`,
        "git",
      )
    }
    const record = await this.store.upsertRepo({
      displayName: ref.project,
      gitDir: fetched.gitDir,
      workTree: null,
      remoteUrl: info.cloneUrl,
      host: ref.hostname,
    })
    // A running cat-file sees the newly fetched objects, so the existing GitRepo stays.
    const repo = this.adopt(record.id, fetched, true)

    const mode: Mode = info.canPush ? "author" : "reviewer"
    const intentText = `${info.title}\n\n${info.body}`.trim()
    const existing = await this.store.findReview({
      repoId: record.id,
      sourceKind: "pull_request",
      baseRef: null,
      headRef: null,
      prUrl: ref.url,
    })
    const review =
      existing ??
      (await this.store.createReview({
        repoId: record.id,
        title: info.title,
        sourceKind: "pull_request",
        baseRef: info.baseRef,
        headRef: info.headRef,
        prUrl: ref.url,
        prNumber: ref.number,
        mode,
        intentText,
      }))
    if (existing)
      await this.store.updateReview(review.id, {
        title: info.title,
        intentText,
      })
    const head =
      (await repo.resolveCommit(`refs/legible/pr/${ref.number}/head`)) ??
      info.headSha
    const baseTip =
      (await repo.resolveCommit(`refs/legible/pr/${ref.number}/base`)) ??
      info.baseSha
    await this.serial(review.id, async () => {
      const latest = await this.store.latestIteration(review.id)
      if (latest?.headSha === head) return
      await this.store.addIteration({
        reviewId: review.id,
        kind: "push",
        baseSha: await repo.mergeBase(baseTip, head),
        headSha: head,
        headTree: null,
      })
    })
    return this.summary(review.id)
  }

  // ---- Refreshing -----------------------------------------------------------------

  async refresh(reviewId: string): Promise<Iteration> {
    const review = await this.requireReview(reviewId)
    if (review.sourceKind === "pull_request" && review.prUrl) {
      await this.openPullRequest(review.prUrl)
    } else {
      const { repo } = await this.repoFor(review)
      if (review.sourceKind === "working_tree") {
        await this.serial(review.id, () =>
          this.snapshotIfMoved(review.id, repo, review.baseRef),
        )
      } else if (review.baseRef && review.headRef) {
        const head = await repo.resolveCommit(review.headRef)
        const base = await repo.resolveCommit(review.baseRef)
        if (!head || !base)
          throw new UserError(
            `Can't resolve ${review.baseRef}...${review.headRef} any more.`,
          )
        await this.serial(review.id, () =>
          this.addRefsIteration(review.id, repo, base, head),
        )
      }
    }
    this.lastNotified.delete(reviewId)
    const it = await this.store.latestIteration(reviewId)
    if (!it) throw new UserError("This Review has no Iterations.")
    return it
  }

  /** Whether the source has moved since the latest Iteration. Never refreshes on its own. */
  async checkForChanges(
    reviewId: string,
  ): Promise<{ available: boolean; detail: string | null }> {
    const review = await this.requireReview(reviewId)
    const latest = review.latestIteration
    if (!latest) return { available: false, detail: null }
    if (review.sourceKind === "working_tree") {
      const { repo } = await this.repoFor(review)
      // Hashing the tree runs `git add -A` on a temp index; skip it while nothing a tree depends on changed.
      const signature = await repo.workingTreeSignature()
      const prev = this.treeChecks.get(reviewId)
      const tree =
        prev?.signature === signature && prev.iterationId === latest.id
          ? prev.tree
          : await repo.workingTreeTree()
      this.treeChecks.set(reviewId, { signature, iterationId: latest.id, tree })
      return tree !== latest.headTree
        ? { available: true, detail: "New changes since this Snapshot" }
        : { available: false, detail: null }
    }
    if (review.sourceKind === "refs" && review.headRef) {
      const { repo } = await this.repoFor(review)
      const head = await repo.resolveCommit(review.headRef)
      return head && head !== latest.headSha
        ? {
            available: true,
            detail: `${review.headRef} moved to ${head.slice(0, 7)}`,
          }
        : { available: false, detail: null }
    }
    if (review.prUrl) {
      try {
        const { info } = await this.pullRequestInfo(review.prUrl)
        return info.headSha !== latest.headSha
          ? {
              available: true,
              detail: `New commits pushed (${info.headSha.slice(0, 7)})`,
            }
          : { available: false, detail: null }
      } catch {
        return { available: false, detail: null }
      }
    }
    return { available: false, detail: null }
  }

  /** Watches the Review the user has open; only one at a time. */
  watch(reviewId: string) {
    if (this.watcher?.reviewId === reviewId) return
    this.watcher?.stop()
    // Claim the slot now: starting is async, and a second watch() before it finishes
    // must stop this one rather than run beside it.
    let stopped = false
    let stopStarted: (() => void) | null = null
    this.watcher = {
      reviewId,
      stop: () => {
        stopped = true
        stopStarted?.()
      },
    }
    this.startWatching(reviewId).then(
      (stop) => {
        if (stopped) stop?.()
        else stopStarted = stop
      },
      () => undefined,
    )
  }

  private async startWatching(reviewId: string): Promise<(() => void) | null> {
    const review = await this.store.getReview(reviewId)
    if (!review) return null
    let timer: NodeJS.Timeout | null = null
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const r = await this.checkForChanges(reviewId)
        const key = r.detail ?? ""
        if (r.available && this.lastNotified.get(reviewId) !== key) {
          this.lastNotified.set(reviewId, key)
          this.onChangesAvailable(reviewId, r.detail ?? "New changes")
        }
      } catch {
        // Transient git or network errors: try again on the next tick.
      } finally {
        checking = false
      }
    }
    // check() catches its own errors.
    const poll = () => void check()
    const debounced = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(poll, 1500)
    }

    let fsWatcher: FSWatcher | null = null
    let interval: NodeJS.Timeout
    if (
      review.sourceKind === "working_tree" &&
      review.repo.workTree &&
      process.platform !== "linux"
    ) {
      // FSEvents / ReadDirectoryChangesW handle recursive watches cheaply.
      try {
        fsWatcher = watch(
          review.repo.workTree,
          { recursive: true },
          (_e, file) => {
            const f =
              process.platform === "win32"
                ? (file ?? "").replaceAll("\\", "/")
                : (file ?? "")
            if (
              f.startsWith(".git/") &&
              !/^\.git\/(HEAD|index|packed-refs|refs\/)/.test(f)
            )
              return
            debounced()
          },
        )
        // E.g. the work tree was deleted or became unreadable. Without a listener this
        // throws in the main process; the interval below keeps checking.
        fsWatcher.on("error", () => {
          fsWatcher?.close()
          fsWatcher = null
        })
      } catch {
        fsWatcher = null
      }
      interval = setInterval(poll, 30_000)
    } else if (review.sourceKind === "pull_request") {
      interval = setInterval(poll, 60_000)
    } else {
      // Linux: recursive inotify watches on big repos exhaust the watch limit, so poll.
      interval = setInterval(poll, 6_000)
    }
    return () => {
      fsWatcher?.close()
      clearInterval(interval)
      if (timer) clearTimeout(timer)
    }
  }

  // ---- Change Sets ------------------------------------------------------------------

  async changeSet(
    reviewId: string,
    iterationId: string | null,
    ignoreWhitespace: boolean,
  ): Promise<ChangeSetSummary> {
    const built = await this.built(reviewId, iterationId, ignoreWhitespace)
    return built.summary
  }

  async fileDiff(
    reviewId: string,
    iterationId: string,
    fileId: string,
    ignoreWhitespace: boolean,
  ): Promise<FileDiff> {
    const built = await this.built(reviewId, iterationId, ignoreWhitespace)
    const d = built.diffs.get(fileId)
    if (!d) throw new UserError("That file is not part of this Change Set.")
    return d
  }

  async built(
    reviewId: string,
    iterationId: string | null,
    ignoreWhitespace: boolean,
  ): Promise<BuiltChangeSet> {
    const review = await this.requireReview(reviewId)
    const it = await this.iteration(review, iterationId)
    const key = `${it.id}:${ignoreWhitespace ? "w" : "-"}`
    let p = this.changeSets.get(key)
    if (!p) {
      const { cached } = await this.repoFor(review)
      p = this.indexer.buildChangeSet(
        await this.indexKey(reviewId, it.id),
        { reviewId, iterationId: it.id },
        { ignoreWhitespace, prefetch: cached },
      )
      this.changeSets.set(key, p)
      p.catch(() => this.changeSets.delete(key))
      // Keep a handful of Change Sets in memory.
      while (this.changeSets.size > 6)
        this.changeSets.delete(this.changeSets.keys().next().value as string)
    }
    return p
  }

  private async iteration(
    review: ReviewSummary,
    iterationId: string | null,
  ): Promise<Iteration> {
    const it = iterationId
      ? await this.store.getIteration(iterationId)
      : review.latestIteration
    if (!it || it.reviewId !== review.id)
      throw new UserError("That Iteration is not part of this Review.")
    return it
  }

  /** What the indexer needs to find (or rebuild) an Iteration's code index. */
  async indexKey(reviewId: string, iterationId: string): Promise<IndexKey> {
    const review = await this.requireReview(reviewId)
    const it = await this.iteration(review, iterationId)
    const { repo } = await this.repoFor(review)
    return {
      repo: {
        gitDir: repo.gitDir,
        workTree: repo.workTree,
        env: (repo.env as Record<string, string> | undefined) ?? null,
      },
      baseSha: it.baseSha,
      headSha: it.headSha,
    }
  }

  async repoFor(review: ReviewSummary): Promise<RepoHandle> {
    const hit = this.repos.get(review.repoId)
    if (hit) return hit
    const cached = review.repo.workTree === null
    const env =
      cached && review.repo.host
        ? await this.hosts.gitAuthEnv(review.repo.host)
        : undefined
    // Another call may have created the handle while this one awaited the token.
    this.adopt(
      review.repoId,
      GitRepo.at(review.repo.gitDir, review.repo.workTree, env),
      cached,
    )
    return this.repos.get(review.repoId) as RepoHandle
  }

  async summary(reviewId: string): Promise<ReviewSummary> {
    return this.requireReview(reviewId)
  }

  private async requireReview(reviewId: string): Promise<ReviewSummary> {
    const r = await this.store.getReview(reviewId)
    if (!r) throw new UserError("That Review no longer exists.")
    return r
  }

  async inspect(path: string) {
    let repo: GitRepo
    try {
      repo = await GitRepo.open(path)
    } catch {
      throw new UserError(`${path} isn't inside a git repository.`)
    }
    try {
      const root = repo.workTree ?? repo.gitDir
      return {
        root,
        name: basename(root),
        branch: await repo.currentBranch(),
        defaultBase: await repo.defaultBaseRef(),
        branches: (await repo.listBranches()).slice(0, 200),
        remoteUrl: await repo.remoteUrl(),
      }
    } finally {
      repo.close()
    }
  }

  workTreePath(review: ReviewSummary, path: string): string | null {
    return review.repo.workTree ? join(review.repo.workTree, path) : null
  }
}

function hostOf(remote: string): string | null {
  const m = remote.match(/^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)/)
  return m?.[1]?.toLowerCase() ?? null
}
