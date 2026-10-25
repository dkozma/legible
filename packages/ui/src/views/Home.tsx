import type { ReviewSummary } from '@legible/domain';
import type { RepoInspection } from '@legible/ipc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FolderGit2, GitPullRequest, Loader2, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ClientError } from '../client';
import { relativeTime } from '../components/Inline';
import { useClient } from '../context';
import { useUI } from '../state';

export function Home() {
  const client = useClient();
  const go = useUI((s) => s.go);
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => client.call('review.list', {}), staleTime: 0 });
  const status = useQuery({ queryKey: ['runtimeStatus'], queryFn: () => client.call('runtime.status', {}), staleTime: 60_000 });
  const info = useQuery({ queryKey: ['appInfo'], queryFn: () => client.call('app.info', {}) });

  return (
    <>
      <header className="titlebar">
        <span className="b sm grow">Legible</span>
        <button className="btn btn-ghost btn-sm muted" type="button" onClick={() => go({ name: 'settings', section: null })}>
          <SettingsIcon className="i i-sm" />
          Settings
        </button>
      </header>
      <div className="home">
        <div className="home-inner">
          {info.data && !info.data.gitOk && (
            <div className="crit-box row" style={{ padding: '10px 14px', alignItems: 'flex-start' }}>
              <AlertTriangle className="i i-sm" style={{ color: 'var(--risk-critical)', marginTop: 2 }} />
              <span className="sm">
                Legible needs git 2.40 or newer; found {info.data.gitVersion}. Install a newer git (for example with Homebrew) and restart.
              </span>
            </div>
          )}
          {status.data && !status.data.ready && (
            <div className="elev-box row" style={{ padding: '10px 14px' }}>
              <AlertTriangle className="i i-sm" style={{ color: 'var(--risk-elevated)' }} />
              <span className="sm grow">Explanations need Claude. {status.data.detail}.</span>
              <button className="btn btn-outline btn-xs" type="button" onClick={() => go({ name: 'settings', section: 'providers' })}>
                Open Settings
              </button>
            </div>
          )}

          <OpenCard />

          <section className="col" style={{ gap: 10 }} aria-labelledby="recent-h">
            <div className="row">
              <h2 className="h2 grow" id="recent-h">
                Reviews
              </h2>
              {status.data?.ready && <span className="xs muted">{status.data.detail}</span>}
            </div>
            {reviews.data && reviews.data.length === 0 && (
              <div className="inset sm muted" style={{ padding: '18px 16px' }}>
                No Reviews yet. Open a repository with an agent's work in it, or paste a pull request URL.
              </div>
            )}
            {reviews.data && reviews.data.length > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                {reviews.data.map((r) => (
                  <ReviewRow key={r.id} review={r} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function sourceLabel(r: ReviewSummary): string {
  if (r.sourceKind === 'pull_request') return `${r.repo.host?.includes('gitlab') ? 'MR' : 'PR'} #${r.prNumber}`;
  if (r.sourceKind === 'refs') return 'Refs';
  return 'Working tree';
}

function ReviewRow({ review }: { review: ReviewSummary }) {
  const client = useClient();
  const qc = useQueryClient();
  const go = useUI((s) => s.go);
  const del = useMutation({
    mutationFn: () => client.call('review.delete', { reviewId: review.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  });
  const open = () => go({ name: 'review', reviewId: review.id });
  return (
    <div className="review-row" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <span className="sm b truncate">{review.title}</span>
        <span className="xs muted truncate">
          {review.repo.displayName}
          {review.baseRef ? ` · vs ${review.baseRef}` : ''}
          {review.latestIteration ? ` · Iteration ${review.latestIteration.seq}` : ''}
        </span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="badge badge-muted">{sourceLabel(review)}</span>
        <span className="badge badge-outline">{review.mode === 'author' ? 'Author mode' : 'Reviewer mode'}</span>
        <span className="xs muted" style={{ width: 80, textAlign: 'right' }}>
          {relativeTime(review.updatedAt)}
        </span>
      </div>
      <button
        className="btn btn-ghost btn-icon btn-xs muted del"
        type="button"
        aria-label={`Delete Review ${review.title}`}
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Delete the Review “${review.title}”? Its viewed state and Explanations are removed. Your repository isn't touched.`))
            del.mutate();
        }}
      >
        <Trash2 className="i i-sm" />
      </button>
    </div>
  );
}

function OpenCard() {
  const client = useClient();
  const qc = useQueryClient();
  const go = useUI((s) => s.go);
  const [tab, setTab] = useState<'local' | 'pr'>('local');
  const [repo, setRepo] = useState<RepoInspection | null>(null);
  const [mode, setMode] = useState<'working_tree' | 'refs'>('working_tree');
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);

  const pick = useMutation({
    mutationFn: async () => {
      const { path } = await client.call('repo.pick', {});
      if (!path) return null;
      return client.call('repo.inspect', { path });
    },
    onSuccess: (r) => {
      if (!r) return;
      setRepo(r);
      setError(null);
      setBaseRef(r.defaultBase ?? '');
      setHeadRef(r.branch ?? r.branches[0] ?? '');
    },
    onError: (e: Error) => setError({ message: e.message, code: null }),
  });

  const open = useMutation({
    mutationFn: () => {
      if (tab === 'pr') return client.call('review.open', { source: { kind: 'pull_request', url: url.trim() } });
      if (!repo) throw new Error('Choose a repository first.');
      if (mode === 'working_tree')
        return client.call('review.open', { source: { kind: 'working_tree', repoPath: repo.root, baseRef: baseRef || null } });
      return client.call('review.open', { source: { kind: 'refs', repoPath: repo.root, baseRef, headRef } });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      go({ name: 'review', reviewId: r.id });
    },
    onError: (e: Error) => setError({ message: e.message, code: e instanceof ClientError ? e.code : null }),
  });

  return (
    <section className="card" aria-labelledby="open-h">
      <div className="card-head row">
        <h1 className="h2 grow" id="open-h">
          Open a Review
        </h1>
        <div className="tabs" role="tablist" aria-label="Source">
          <button className="tab" role="tab" type="button" aria-selected={tab === 'local'} onClick={() => setTab('local')}>
            <FolderGit2 className="i i-sm" />
            Local repository
          </button>
          <button className="tab" role="tab" type="button" aria-selected={tab === 'pr'} onClick={() => setTab('pr')}>
            <GitPullRequest className="i i-sm" />
            Pull Request
          </button>
        </div>
      </div>
      <div className="card-body col" style={{ gap: 14 }}>
        {tab === 'local' ? (
          <>
            <div className="row wrap" style={{ gap: 10 }}>
              <button className="btn btn-outline btn-sm" type="button" onClick={() => pick.mutate()} disabled={pick.isPending}>
                {pick.isPending ? <Loader2 className="i i-sm spin" /> : <FolderGit2 className="i i-sm" />}
                {repo ? 'Choose another…' : 'Choose folder…'}
              </button>
              {repo && (
                <span className="sm">
                  <b>{repo.name}</b> <span className="muted">· {repo.branch ? `on ${repo.branch}` : 'detached HEAD'}</span>
                </span>
              )}
            </div>
            {repo && (
              <div className="col" style={{ gap: 10 }}>
                <label className="row sm" style={{ gap: 10, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    className="rb"
                    name="mode"
                    checked={mode === 'working_tree'}
                    onChange={() => setMode('working_tree')}
                  />
                  <span className="grow">
                    <b>Working tree</b>{' '}
                    <span className="muted">
                      — everything on this branch, including uncommitted and untracked files, captured as a Snapshot
                    </span>
                  </span>
                </label>
                <label className="row sm" style={{ gap: 10, cursor: 'pointer' }}>
                  <input type="radio" className="rb" name="mode" checked={mode === 'refs'} onChange={() => setMode('refs')} />
                  <span className="grow">
                    <b>Compare refs</b> <span className="muted">— two branches or commits, three-dot (merge-base) semantics</span>
                  </span>
                </label>
                <div className="row wrap" style={{ gap: 8, paddingLeft: 26 }}>
                  <span className="xs muted">Base</span>
                  <RefSelect value={baseRef} options={repo.branches} onChange={setBaseRef} label="Base ref" />
                  {mode === 'refs' && (
                    <>
                      <span className="xs muted">...</span>
                      <span className="xs muted">Head</span>
                      <RefSelect value={headRef} options={repo.branches} onChange={setHeadRef} label="Head ref" />
                    </>
                  )}
                  {mode === 'working_tree' && <span className="xs muted">vs the working tree</span>}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            <label className="label" htmlFor="pr-url">
              GitHub pull request or GitLab merge request URL
            </label>
            <input
              id="pr-url"
              className="input mono"
              style={{ fontSize: 12 }}
              placeholder="https://github.com/owner/repo/pull/123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && open.mutate()}
            />
            <span className="xs muted">Read-only in this version. Private repositories need an account in Settings → Hosts.</span>
          </div>
        )}
        {error && (
          <div className="crit-box row sm" style={{ padding: '8px 12px' }}>
            <span className="grow">{error.message}</span>
            {error.code === 'needs_auth' && (
              <button className="btn btn-outline btn-xs" type="button" onClick={() => go({ name: 'settings', section: 'hosts' })}>
                Connect a host
              </button>
            )}
          </div>
        )}
        <div className="row">
          <span className="grow" />
          <button
            className="btn btn-sm"
            type="button"
            disabled={open.isPending || (tab === 'local' ? !repo || (mode === 'refs' && (!baseRef || !headRef)) : !url.trim())}
            onClick={() => open.mutate()}
          >
            {open.isPending && <Loader2 className="i i-sm spin" />}
            {open.isPending ? (tab === 'pr' ? 'Fetching…' : 'Taking Snapshot…') : 'Open Review'}
          </button>
        </div>
      </div>
    </section>
  );
}

function RefSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label: string;
}) {
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select
      className="select mono"
      style={{ height: 28, fontSize: 12, maxWidth: 260 }}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {all.map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
    </select>
  );
}
