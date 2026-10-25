// Opening sources as Reviews, taking Snapshots, refreshing Iterations, and
// noticing when a working tree, branch or Pull Request moved.

import { type FSWatcher, watch } from 'node:fs';
import { basename, join } from 'node:path';
import type { ChangeSetSummary, FileDiff, Iteration, Mode, ReviewSummary, Source } from '@legible/domain';
import { ensureCacheClone, fetchRefs, GitRepo, tokenAuthEnv } from '@legible/git';
import { getPullRequest, HostError, type PullRequestInfo, parsePullRequestUrl } from '@legible/hosts';
import type { Store } from '@legible/store';
import { type BuiltChangeSet, buildChangeSet } from './changeSet';
import type { HostService } from './hosts';

export class UserError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'UserError';
  }
}

interface RepoHandle {
  repo: GitRepo;
  cached: boolean;
}

export class ReviewService {
  private repos = new Map<string, RepoHandle>();
  private changeSets = new Map<string, Promise<BuiltChangeSet>>();
  private watcher: { reviewId: string; stop: () => void } | null = null;
  private lastNotified = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly hosts: HostService,
    private readonly cacheRoot: string,
    private readonly onChangesAvailable: (reviewId: string, detail: string) => void,
  ) {}

  dispose() {
    this.watcher?.stop();
    for (const h of this.repos.values()) h.repo.close();
    this.repos.clear();
  }

  // ---- Opening ------------------------------------------------------------------

  async open(source: Source): Promise<ReviewSummary> {
    if (source.kind === 'pull_request') return this.openPullRequest(source.url);
    let repo: GitRepo;
    try {
      repo = await GitRepo.open(source.repoPath);
    } catch {
      throw new UserError(`${source.repoPath} isn't inside a git repository.`);
    }
    const workTree = repo.workTree;
    const remoteUrl = await repo.remoteUrl();
    const record = await this.store.upsertRepo({
      displayName: basename(workTree ?? repo.gitDir),
      gitDir: repo.gitDir,
      workTree,
      remoteUrl,
      host: remoteUrl ? hostOf(remoteUrl) : null,
    });
    this.repos.set(record.id, { repo, cached: false });

    if (source.kind === 'working_tree') {
      if (!workTree) throw new UserError('This repository has no working tree to snapshot.');
      const baseRef = source.baseRef ?? (await repo.defaultBaseRef());
      const branch = await repo.currentBranch();
      const existing = await this.store.findReview({
        repoId: record.id,
        sourceKind: 'working_tree',
        baseRef,
        headRef: branch,
        prUrl: null,
      });
      const review =
        existing ??
        (await this.store.createReview({
          repoId: record.id,
          title: branch ?? 'Detached HEAD',
          sourceKind: 'working_tree',
          baseRef,
          headRef: branch,
          prUrl: null,
          prNumber: null,
          mode: 'author',
          intentText: null,
        }));
      // Reopening takes a fresh Snapshot only if the working tree moved.
      const latest = await this.store.latestIteration(review.id);
      const tree = await repo.workingTreeTree();
      if (!latest || latest.headTree !== tree) await this.snapshotIteration(review.id, repo, baseRef);
      return this.summary(review.id);
    }

    const head = await repo.resolveCommit(source.headRef);
    const base = await repo.resolveCommit(source.baseRef);
    if (!head) throw new UserError(`Can't find ${source.headRef} in this repository.`);
    if (!base) throw new UserError(`Can't find ${source.baseRef} in this repository.`);
    const existing = await this.store.findReview({
      repoId: record.id,
      sourceKind: 'refs',
      baseRef: source.baseRef,
      headRef: source.headRef,
      prUrl: null,
    });
    const review =
      existing ??
      (await this.store.createReview({
        repoId: record.id,
        title: `${source.baseRef}...${source.headRef}`,
        sourceKind: 'refs',
        baseRef: source.baseRef,
        headRef: source.headRef,
        prUrl: null,
        prNumber: null,
        mode: 'author',
        intentText: null,
      }));
    const latest = await this.store.latestIteration(review.id);
    if (!latest || latest.headSha !== head) {
      await this.store.addIteration({
        reviewId: review.id,
        kind: 'refs',
        baseSha: await repo.mergeBase(base, head),
        headSha: head,
        headTree: null,
      });
    }
    return this.summary(review.id);
  }

  private async snapshotIteration(reviewId: string, repo: GitRepo, baseRef: string | null): Promise<Iteration> {
    const snapId = `${reviewId.slice(0, 8)}-${Date.now()}`;
    const snap = await repo.snapshot(snapId);
    const head = await repo.resolveCommit('HEAD');
    // Base is the merge-base with the base branch (three-dot). Without one, review uncommitted changes against HEAD.
    const baseTip = baseRef ? await repo.resolveCommit(baseRef) : null;
    const baseSha = baseTip ? await repo.mergeBase(baseTip, snap.sha) : (head ?? snap.sha);
    const it = await this.store.addIteration({ reviewId, kind: 'snapshot', baseSha, headSha: snap.sha, headTree: snap.tree });
    this.lastNotified.delete(reviewId);
    return it;
  }

  private async pullRequestInfo(url: string): Promise<{ info: PullRequestInfo; token: string | null }> {
    const ref = parsePullRequestUrl(url);
    if (!ref) throw new UserError("That doesn't look like a GitHub pull request or GitLab merge request URL.");
    const token = await this.hosts.token(ref.hostname);
    try {
      return { info: await getPullRequest(ref, token), token };
    } catch (e) {
      if (e instanceof HostError) throw new UserError(e.message, e.needsAuth ? 'needs_auth' : 'host');
      throw e;
    }
  }

  private async openPullRequest(url: string): Promise<ReviewSummary> {
    const { info, token } = await this.pullRequestInfo(url);
    const { ref } = info;
    const env = token ? tokenAuthEnv(ref.hostname, token) : undefined;
    let repo: GitRepo;
    try {
      repo = await ensureCacheClone({
        cacheRoot: this.cacheRoot,
        hostname: ref.hostname,
        project: ref.project,
        cloneUrl: info.cloneUrl,
        env,
      });
      await fetchRefs(repo, [`+refs/heads/${info.baseRef}:refs/legible/pr/${ref.number}/base`, info.headRefspec]);
    } catch (e) {
      throw new UserError(`Couldn't fetch ${ref.project}: ${(e as Error).message.split('\n')[0]}`, 'git');
    }
    const record = await this.store.upsertRepo({
      displayName: ref.project,
      gitDir: repo.gitDir,
      workTree: null,
      remoteUrl: info.cloneUrl,
      host: ref.hostname,
    });
    this.repos.get(record.id)?.repo.close();
    this.repos.set(record.id, { repo, cached: true });

    const mode: Mode = info.canPush ? 'author' : 'reviewer';
    const intentText = `${info.title}\n\n${info.body}`.trim();
    const existing = await this.store.findReview({
      repoId: record.id,
      sourceKind: 'pull_request',
      baseRef: null,
      headRef: null,
      prUrl: ref.url,
    });
    const review =
      existing ??
      (await this.store.createReview({
        repoId: record.id,
        title: info.title,
        sourceKind: 'pull_request',
        baseRef: info.baseRef,
        headRef: info.headRef,
        prUrl: ref.url,
        prNumber: ref.number,
        mode,
        intentText,
      }));
    if (existing) await this.store.updateReview(review.id, { title: info.title, intentText });
    const head = (await repo.resolveCommit(`refs/legible/pr/${ref.number}/head`)) ?? info.headSha;
    const baseTip = (await repo.resolveCommit(`refs/legible/pr/${ref.number}/base`)) ?? info.baseSha;
    const latest = await this.store.latestIteration(review.id);
    if (!latest || latest.headSha !== head) {
      await this.store.addIteration({
        reviewId: review.id,
        kind: 'push',
        baseSha: await repo.mergeBase(baseTip, head),
        headSha: head,
        headTree: null,
      });
    }
    return this.summary(review.id);
  }

  // ---- Refreshing -----------------------------------------------------------------

  async refresh(reviewId: string): Promise<Iteration> {
    const review = await this.requireReview(reviewId);
    if (review.sourceKind === 'pull_request' && review.prUrl) {
      await this.openPullRequest(review.prUrl);
    } else {
      const { repo } = await this.repoFor(review);
      if (review.sourceKind === 'working_tree') {
        await this.snapshotIteration(review.id, repo, review.baseRef);
      } else if (review.baseRef && review.headRef) {
        const head = await repo.resolveCommit(review.headRef);
        const base = await repo.resolveCommit(review.baseRef);
        if (!head || !base) throw new UserError(`Can't resolve ${review.baseRef}...${review.headRef} any more.`);
        const latest = await this.store.latestIteration(review.id);
        if (latest?.headSha !== head) {
          await this.store.addIteration({
            reviewId: review.id,
            kind: 'refs',
            baseSha: await repo.mergeBase(base, head),
            headSha: head,
            headTree: null,
          });
        }
      }
    }
    this.lastNotified.delete(reviewId);
    const it = await this.store.latestIteration(reviewId);
    if (!it) throw new UserError('This Review has no Iterations.');
    return it;
  }

  /** Whether the source has moved since the latest Iteration. Never refreshes on its own. */
  async checkForChanges(reviewId: string): Promise<{ available: boolean; detail: string | null }> {
    const review = await this.requireReview(reviewId);
    const latest = review.latestIteration;
    if (!latest) return { available: false, detail: null };
    if (review.sourceKind === 'working_tree') {
      const { repo } = await this.repoFor(review);
      const tree = await repo.workingTreeTree();
      return tree !== latest.headTree ? { available: true, detail: 'New changes since this Snapshot' } : { available: false, detail: null };
    }
    if (review.sourceKind === 'refs' && review.headRef) {
      const { repo } = await this.repoFor(review);
      const head = await repo.resolveCommit(review.headRef);
      return head && head !== latest.headSha
        ? { available: true, detail: `${review.headRef} moved to ${head.slice(0, 7)}` }
        : { available: false, detail: null };
    }
    if (review.prUrl) {
      try {
        const { info } = await this.pullRequestInfo(review.prUrl);
        return info.headSha !== latest.headSha
          ? { available: true, detail: `New commits pushed (${info.headSha.slice(0, 7)})` }
          : { available: false, detail: null };
      } catch {
        return { available: false, detail: null };
      }
    }
    return { available: false, detail: null };
  }

  /** Watches the Review the user has open; only one at a time. */
  watch(reviewId: string) {
    if (this.watcher?.reviewId === reviewId) return;
    this.watcher?.stop();
    this.watcher = null;
    void this.startWatching(reviewId);
  }

  private async startWatching(reviewId: string) {
    const review = await this.store.getReview(reviewId);
    if (!review) return;
    let timer: NodeJS.Timeout | null = null;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const r = await this.checkForChanges(reviewId);
        const key = r.detail ?? '';
        if (r.available && this.lastNotified.get(reviewId) !== key) {
          this.lastNotified.set(reviewId, key);
          this.onChangesAvailable(reviewId, r.detail ?? 'New changes');
        }
      } catch {
        // Transient git or network errors: try again on the next tick.
      } finally {
        checking = false;
      }
    };
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 1500);
    };

    let fsWatcher: FSWatcher | null = null;
    let interval: NodeJS.Timeout;
    if (review.sourceKind === 'working_tree' && review.repo.workTree && process.platform !== 'linux') {
      // FSEvents / ReadDirectoryChangesW handle recursive watches cheaply.
      try {
        fsWatcher = watch(review.repo.workTree, { recursive: true }, (_e, file) => {
          const f = String(file ?? '');
          if (f.startsWith('.git/') && !/^\.git\/(HEAD|index|refs\/)/.test(f)) return;
          debounced();
        });
      } catch {
        fsWatcher = null;
      }
      interval = setInterval(check, 30_000);
    } else if (review.sourceKind === 'pull_request') {
      interval = setInterval(check, 60_000);
    } else {
      // Linux: recursive inotify watches on big repos exhaust the watch limit, so poll.
      interval = setInterval(check, 4_000);
    }
    this.watcher = {
      reviewId,
      stop: () => {
        fsWatcher?.close();
        clearInterval(interval);
        if (timer) clearTimeout(timer);
      },
    };
  }

  // ---- Change Sets ------------------------------------------------------------------

  async changeSet(reviewId: string, iterationId: string | null, ignoreWhitespace: boolean): Promise<ChangeSetSummary> {
    const built = await this.built(reviewId, iterationId, ignoreWhitespace);
    return built.summary;
  }

  async fileDiff(reviewId: string, iterationId: string, fileId: string, ignoreWhitespace: boolean): Promise<FileDiff> {
    const built = await this.built(reviewId, iterationId, ignoreWhitespace);
    const d = built.diffs.get(fileId);
    if (!d) throw new UserError('That file is not part of this Change Set.');
    return d;
  }

  async built(reviewId: string, iterationId: string | null, ignoreWhitespace: boolean): Promise<BuiltChangeSet> {
    const review = await this.requireReview(reviewId);
    const it = iterationId ? await this.store.getIteration(iterationId) : review.latestIteration;
    if (!it || it.reviewId !== reviewId) throw new UserError('That Iteration is not part of this Review.');
    const key = `${it.id}:${ignoreWhitespace ? 'w' : '-'}`;
    let p = this.changeSets.get(key);
    if (!p) {
      const { repo, cached } = await this.repoFor(review);
      p = buildChangeSet(repo, { reviewId, iterationId: it.id }, it.baseSha, it.headSha, { ignoreWhitespace, prefetch: cached });
      this.changeSets.set(key, p);
      p.catch(() => this.changeSets.delete(key));
      // Keep a handful of Change Sets in memory.
      while (this.changeSets.size > 6) this.changeSets.delete(this.changeSets.keys().next().value as string);
    }
    return p;
  }

  async repoFor(review: ReviewSummary): Promise<RepoHandle> {
    const hit = this.repos.get(review.repoId);
    if (hit) return hit;
    const cached = review.repo.workTree === null;
    let env: NodeJS.ProcessEnv | undefined;
    if (cached && review.repo.host) {
      const token = await this.hosts.token(review.repo.host);
      if (token) env = tokenAuthEnv(review.repo.host, token);
    }
    const repo = GitRepo.at(review.repo.gitDir, review.repo.workTree, env);
    const handle = { repo, cached };
    this.repos.set(review.repoId, handle);
    return handle;
  }

  async summary(reviewId: string): Promise<ReviewSummary> {
    return this.requireReview(reviewId);
  }

  private async requireReview(reviewId: string): Promise<ReviewSummary> {
    const r = await this.store.getReview(reviewId);
    if (!r) throw new UserError('That Review no longer exists.');
    return r;
  }

  async inspect(path: string) {
    let repo: GitRepo;
    try {
      repo = await GitRepo.open(path);
    } catch {
      throw new UserError(`${path} isn't inside a git repository.`);
    }
    try {
      const root = repo.workTree ?? repo.gitDir;
      return {
        root,
        name: basename(root),
        branch: await repo.currentBranch(),
        defaultBase: await repo.defaultBaseRef(),
        branches: (await repo.listBranches()).slice(0, 200),
        remoteUrl: await repo.remoteUrl(),
      };
    } finally {
      repo.close();
    }
  }

  workTreePath(review: ReviewSummary, path: string): string | null {
    return review.repo.workTree ? join(review.repo.workTree, path) : null;
  }
}

function hostOf(remote: string): string | null {
  const m = remote.match(/^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)/);
  return m?.[1]?.toLowerCase() ?? null;
}
