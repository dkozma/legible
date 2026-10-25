import type { Explanation, ExplanationTarget, FileChange, FileDiff } from '@legible/domain';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Command, formatKey, useKeyboard } from '../commands';
import { Kbd, relativeTime, usd } from '../components/Inline';
import { useClient } from '../context';
import { type DiffActions, DiffLoading, DiffView } from '../diff/DiffView';
import { buildRows, chunkRanges, rangesForRows, rowAt } from '../diff/rows';
import { ExplainPanel } from '../review/ExplainPanel';
import { FileTree } from '../review/FileTree';
import { useUI } from '../state';

const HEAD_ROOM = 64;
const NO_FILES: FileChange[] = [];
const dataOf = <T,>(results: { data?: T }[]) => results.map((q) => q.data);

export function ReviewView({ reviewId }: { reviewId: string }) {
  const client = useClient();
  const qc = useQueryClient();
  const ui = useUI();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const [topFile, setTopFile] = useState<string | null>(null);

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => client.call('settings.get', {}) });
  const review = useQuery({ queryKey: ['review', reviewId], queryFn: () => client.call('review.get', { reviewId }) });
  const iterations = useQuery({ queryKey: ['iterations', reviewId], queryFn: () => client.call('review.iterations', { reviewId }) });
  const latestId = review.data?.latestIteration?.id ?? null;
  const iterationId = ui.iterationId ?? latestId;
  const cs = useQuery({
    queryKey: ['changeSet', reviewId, iterationId, ui.ignoreWhitespace],
    queryFn: () => client.call('changeSet.get', { reviewId, iterationId, ignoreWhitespace: ui.ignoreWhitespace }),
    enabled: Boolean(iterationId),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const viewedQ = useQuery({ queryKey: ['viewed', reviewId], queryFn: () => client.call('viewed.list', { reviewId }) });
  const history = useQuery({ queryKey: ['history', reviewId], queryFn: () => client.call('explain.history', { reviewId }) });
  const spend = useQuery({ queryKey: ['spend', reviewId], queryFn: () => client.call('spend.summary', { reviewId }) });
  const runtime = useQuery({ queryKey: ['runtimeStatus'], queryFn: () => client.call('runtime.status', {}), staleTime: 60_000 });

  const files = cs.data?.files ?? NO_FILES;
  const diffList = useQueries({
    queries: files.map((f) => ({
      queryKey: ['fileDiff', reviewId, iterationId, f.id, ui.ignoreWhitespace],
      queryFn: () =>
        client.call('fileDiff.get', { reviewId, iterationId: iterationId as string, fileId: f.id, ignoreWhitespace: ui.ignoreWhitespace }),
      enabled: Boolean(iterationId) && !f.binary,
      staleTime: Number.POSITIVE_INFINITY,
    })),
    combine: dataOf,
  });
  const diffs = useMemo(() => {
    const out: Record<string, FileDiff | undefined> = {};
    files.forEach((f, i) => {
      out[f.id] = diffList[i];
    });
    return out;
  }, [files, diffList]);

  const viewed = useMemo(() => new Set(viewedQ.data ?? []), [viewedQ.data]);
  const model = useMemo(
    () =>
      buildRows(cs.data ?? { files: [], moves: [] }, {
        layout: ui.layout,
        context: settings.data?.diff.contextLines ?? 3,
        viewed,
        expandedFiles: ui.expandedFiles,
        collapsedFiles: ui.collapsedFiles,
        expandedFrags: ui.expandedFrags,
        gapReveal: ui.gapReveal,
      }),
    [cs.data, ui.layout, settings.data?.diff.contextLines, viewed, ui.expandedFiles, ui.collapsedFiles, ui.expandedFrags, ui.gapReveal],
  );

  // ---- Navigation ------------------------------------------------------------------

  const scrollToPx = useCallback(
    (px: number, trail = false) => {
      const s = useUI.getState();
      if (trail) s.set({ trail: { back: [...s.trail.back, { reviewId, px: scrollTop.current }].slice(-100), forward: [] } });
      s.scroll(px);
    },
    [reviewId],
  );
  const scrollToRow = useCallback(
    (row: number, trail = false) => scrollToPx((model.offsets[row] ?? 0) - HEAD_ROOM, trail),
    [model.offsets, scrollToPx],
  );

  const openFile = useCallback(
    (fileId: string) => {
      const f = model.files.find((x) => x.fileId === fileId);
      if (f) scrollToRow(f.row, true);
      useUI.getState().set({ activeFileId: fileId });
    },
    [model.files, scrollToRow],
  );

  const moveHunk = (dir: 1 | -1) => {
    const top = scrollTop.current;
    const pos = (h: { row: number }) => (model.offsets[h.row] ?? 0) - HEAD_ROOM;
    const list = model.hunks;
    const idx = dir === 1 ? list.findIndex((h) => pos(h) > top + 1) : list.findLastIndex((h) => pos(h) < top - 1);
    if (idx < 0) return;
    useUI.getState().set({ cursor: idx, selection: null });
    scrollToPx(pos(list[idx] as { row: number }));
  };
  const moveFile = (dir: 1 | -1) => {
    const top = scrollTop.current;
    const pos = (f: { row: number }) => (model.offsets[f.row] ?? 0) - 8;
    const list = model.files;
    const idx = dir === 1 ? list.findIndex((f) => pos(f) > top + 1) : list.findLastIndex((f) => pos(f) < top - 1);
    if (idx < 0) return;
    scrollToPx(pos(list[idx] as { row: number }));
  };
  const currentFileId = () => {
    const cur = model.hunks[useUI.getState().cursor];
    const fromScroll = model.rows[rowAt(model, scrollTop.current + HEAD_ROOM + 8)];
    if (fromScroll && fromScroll.k !== 'end') return fromScroll.fileId;
    return cur?.fileId ?? topFile;
  };

  // ---- Actions ---------------------------------------------------------------------------

  const explain = useMutation({
    mutationFn: ({ target, force }: { target: ExplanationTarget; force: boolean }) =>
      client.call('explain.request', { reviewId, iterationId: iterationId as string, target, force }),
    onSuccess: (job) => {
      const s = useUI.getState();
      s.upsertJob(job);
      s.set({ activeJobId: job.jobId, shownExplanation: null });
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  });

  const fileTarget = (fileId: string): ExplanationTarget | null => {
    const f = files.find((x) => x.id === fileId);
    return f ? { kind: 'file', fileId: f.id, path: f.path, oldPath: f.oldPath } : null;
  };
  const chunkTarget = (fileId: string, chunk: number): ExplanationTarget | null => {
    const f = files.find((x) => x.id === fileId);
    const c = f?.chunks[chunk];
    if (!f || !c) return null;
    return { kind: 'range', fileId: f.id, path: f.path, oldPath: f.oldPath, ...chunkRanges(c) };
  };

  /** Gutter selection, else a text selection inside the diff, else the current hunk. */
  const selectionTarget = (): ExplanationTarget | null => {
    const s = useUI.getState();
    let fileId: string | null = null;
    let from = -1;
    let to = -1;
    if (s.selection) {
      fileId = s.selection.fileId;
      from = s.selection.anchor;
      to = s.selection.focus;
    } else {
      const sel = window.getSelection();
      const rowOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest('[data-row]')?.getAttribute('data-row');
      if (sel && !sel.isCollapsed && scrollRef.current?.contains(sel.anchorNode)) {
        const a = Number(rowOf(sel.anchorNode));
        const b = Number(rowOf(sel.focusNode));
        const ra = model.rows[a];
        const rb = model.rows[b];
        if (ra && rb && ra.k !== 'end' && rb.k !== 'end' && ra.fileId === rb.fileId) {
          fileId = ra.fileId;
          from = a;
          to = b;
        }
      }
    }
    if (fileId) {
      const f = files.find((x) => x.id === fileId);
      const r = rangesForRows(model.rows, from, to);
      if (f && (r.baseRange || r.headRange)) return { kind: 'range', fileId: f.id, path: f.path, oldPath: f.oldPath, ...r };
    }
    // The hunk at the top of the viewport.
    const top = scrollTop.current;
    const h = model.hunks.find((x) => (model.offsets[x.row] ?? 0) >= top + HEAD_ROOM - 4) ?? model.hunks[s.cursor];
    return h ? chunkTarget(h.fileId, h.chunk) : null;
  };

  const runExplain = (t: ExplanationTarget | null, force = false) => {
    if (!t) {
      useUI.getState().toast('Nothing to explain here.', 'info');
      return;
    }
    if (!iterationId) return;
    explain.mutate({ target: t, force });
  };

  const viewedMut = useMutation({
    mutationFn: ({ fileIds, on }: { fileIds: string[]; on: boolean }) => client.call('viewed.set', { reviewId, fileIds, viewed: on }),
    onMutate: ({ fileIds, on }) => {
      qc.setQueryData<string[]>(['viewed', reviewId], (old = []) =>
        on ? [...new Set([...old, ...fileIds])] : old.filter((x) => !fileIds.includes(x)),
      );
    },
    onError: (e: Error) => {
      useUI.getState().toast(e.message);
      void qc.invalidateQueries({ queryKey: ['viewed', reviewId] });
    },
  });
  const toggleViewed = (fileId: string) => {
    const on = !viewed.has(fileId);
    const s = useUI.getState();
    s.toggleIn('expandedFiles', fileId, false);
    s.toggleIn('collapsedFiles', fileId, false);
    viewedMut.mutate({ fileIds: [fileId], on });
  };

  const openInEditor = (path: string, line: number) => {
    client
      .call('editor.open', { reviewId, path, line })
      .then((r) => {
        if (!r.ok && r.error) useUI.getState().toast(r.error);
      })
      .catch((e: Error) => useUI.getState().toast(e.message));
  };

  const refresh = useMutation({
    mutationFn: () => client.call('review.refresh', { reviewId }),
    onSuccess: async () => {
      const s = useUI.getState();
      const next = { ...s.changesAvailable };
      delete next[reviewId];
      s.set({ changesAvailable: next, iterationId: null, selection: null });
      await qc.invalidateQueries({ queryKey: ['review', reviewId] });
      await qc.invalidateQueries({ queryKey: ['iterations', reviewId] });
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  });

  const actions: DiffActions = {
    explainChunk: (fileId, chunk) => runExplain(chunkTarget(fileId, chunk)),
    explainFile: (fileId) => runExplain(fileTarget(fileId)),
    openInEditor,
    toggleViewed,
    canOpenInEditor: Boolean(review.data?.repo.workTree),
  };

  const jumpToExplanation = (e: Explanation) => {
    const f = model.files.find((x) => x.fileId === e.target.fileId);
    if (!f) return;
    if (e.target.kind === 'file') {
      scrollToRow(f.row, true);
      return;
    }
    const want = e.target.headRange ?? e.target.baseRange;
    const side = e.target.headRange ? 'head' : 'base';
    const idx = model.rows.findIndex(
      (r, i) =>
        i > f.row &&
        (r.k === 'line' || r.k === 'pair') &&
        r.fileId === f.fileId &&
        want &&
        (side === 'head' ? (r.k === 'line' ? r.head : r.r) : r.k === 'line' ? r.base : r.l) + 1 === want[0],
    );
    scrollToRow(idx >= 0 ? idx : f.row, true);
  };

  const trailMove = (dir: 'back' | 'forward') => {
    const s = useUI.getState();
    const stack = dir === 'back' ? s.trail.back : s.trail.forward;
    const loc = stack[stack.length - 1];
    if (!loc) return;
    const here = { reviewId, px: scrollTop.current };
    s.set({
      trail:
        dir === 'back'
          ? { back: s.trail.back.slice(0, -1), forward: [...s.trail.forward, here] }
          : { back: [...s.trail.back, here], forward: s.trail.forward.slice(0, -1) },
    });
    s.scroll(loc.px);
  };

  const commands: Command[] = [
    { id: 'next-hunk', title: 'Next hunk', group: 'Move', keys: ['j'], paletteHidden: true, run: () => moveHunk(1) },
    { id: 'prev-hunk', title: 'Previous hunk', group: 'Move', keys: ['k'], paletteHidden: true, run: () => moveHunk(-1) },
    { id: 'next-file', title: 'Next file', group: 'Move', keys: ['n'], run: () => moveFile(1) },
    { id: 'prev-file', title: 'Previous file', group: 'Move', keys: ['p'], run: () => moveFile(-1) },
    { id: 'trail-back', title: 'Trail back', group: 'Move', keys: ['mod+['], run: () => trailMove('back') },
    { id: 'trail-forward', title: 'Trail forward', group: 'Move', keys: ['mod+]'], run: () => trailMove('forward') },
    { id: 'explain', title: 'Explain selection or current hunk', group: 'Act', keys: ['e'], run: () => runExplain(selectionTarget()) },
    {
      id: 'explain-file',
      title: 'Explain current file',
      group: 'Act',
      keys: ['shift+e'],
      run: () => {
        const id = currentFileId();
        runExplain(id ? fileTarget(id) : null);
      },
    },
    {
      id: 'viewed',
      title: 'Mark file viewed',
      group: 'Act',
      keys: ['v'],
      run: () => {
        const id = currentFileId();
        if (id) toggleViewed(id);
      },
    },
    {
      id: 'clear-selection',
      title: 'Clear selection',
      group: 'Act',
      keys: ['escape'],
      paletteHidden: true,
      enabled: () => useUI.getState().selection !== null && !useUI.getState().palette && !useUI.getState().shortcuts,
      run: () => useUI.getState().set({ selection: null }),
    },
    {
      id: 'split',
      title: 'Toggle split view',
      group: 'View',
      keys: ['alt+s'],
      run: () => useUI.getState().set({ layout: useUI.getState().layout === 'split' ? 'unified' : 'split' }),
    },
    {
      id: 'whitespace',
      title: 'Toggle hiding whitespace changes',
      group: 'View',
      keys: ['w'],
      run: () => useUI.getState().set({ ignoreWhitespace: !useUI.getState().ignoreWhitespace }),
    },
    {
      id: 'open-editor',
      title: 'Open in editor',
      group: 'App',
      keys: ['o'],
      enabled: () => actions.canOpenInEditor,
      run: () => {
        const r = model.rows[rowAt(model, scrollTop.current + HEAD_ROOM + 8)];
        if (!r || r.k === 'end') return;
        const f = files.find((x) => x.id === r.fileId);
        const line =
          r.k === 'line' ? Math.max(r.head, r.base) + 1 : r.k === 'pair' ? Math.max(r.r, r.l) + 1 : r.k === 'hunk' ? r.head + 1 : 1;
        if (f) openInEditor(f.path, line);
      },
    },
    { id: 'refresh', title: 'Refresh Snapshot / fetch new commits', group: 'App', keys: ['shift+r'], run: () => refresh.mutate() },
    { id: 'home', title: 'All Reviews', group: 'App', keys: [], run: () => useUI.getState().go({ name: 'home' }) },
  ];
  useKeyboard(commands, !ui.palette && !ui.shortcuts);

  // Expose commands and files to the palette.
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  useEffect(() => {
    useUI.getState().set({
      paletteSource: {
        get commands() {
          return commandsRef.current;
        },
        files: files.map((f) => ({ id: f.id, path: f.path })),
        openFile,
      },
    });
    return () => useUI.getState().set({ paletteSource: null });
  }, [files, openFile]);

  // Menu commands from main (File → Refresh).
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === 'refresh') refresh.mutate();
    };
    window.addEventListener('legible-command', on);
    return () => window.removeEventListener('legible-command', on);
  }, [refresh]);

  // Check once on open whether the source moved since the last Iteration.
  useEffect(() => {
    client
      .call('review.checkForChanges', { reviewId })
      .then((r) => {
        if (r.available) {
          const s = useUI.getState();
          s.set({ changesAvailable: { ...s.changesAvailable, [reviewId]: r.detail ?? 'New changes' } });
        }
      })
      .catch(() => undefined);
  }, [client, reviewId]);

  const job = ui.activeJobId ? (ui.jobs[ui.activeJobId] ?? null) : null;
  const viewedCount = files.filter((f) => viewed.has(f.id)).length;
  const changes = ui.changesAvailable[reviewId];
  const r = review.data;
  const it = iterations.data?.find((x) => x.id === iterationId);
  const onLatest = !ui.iterationId || ui.iterationId === latestId;

  return (
    <>
      <header className="titlebar">
        <nav className="row" aria-label="Trail" style={{ gap: 2 }}>
          <button
            className="btn btn-ghost btn-icon btn-xs"
            type="button"
            aria-label="Back"
            title={`Back (${formatKey('mod+[').join('')})`}
            disabled={ui.trail.back.length === 0}
            onClick={() => trailMove('back')}
          >
            <ChevronLeft className="i i-sm" />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-xs"
            type="button"
            aria-label="Forward"
            title={`Forward (${formatKey('mod+]').join('')})`}
            disabled={ui.trail.forward.length === 0}
            onClick={() => trailMove('forward')}
          >
            <ChevronRight className="i i-sm" />
          </button>
        </nav>
        <nav className="crumbs grow" aria-label="Location">
          <button
            className="btn-link"
            type="button"
            style={{ color: 'var(--muted-foreground)', textDecoration: 'none', fontSize: 12, border: 0, cursor: 'pointer' }}
            onClick={() => ui.go({ name: 'home' })}
          >
            Reviews
          </button>
          <ChevronRight className="i i-xs" />
          <span>{r?.repo.displayName}</span>
          <ChevronRight className="i i-xs" />
          <b className="truncate">{r?.title}</b>
        </nav>
        {r && <span className="badge badge-outline">{r.mode === 'author' ? 'Author mode' : 'Reviewer mode'}</span>}
        {iterations.data && iterations.data.length > 1 ? (
          <select
            className="select"
            style={{ height: 28, fontSize: 12 }}
            aria-label="Iteration"
            value={iterationId ?? ''}
            onChange={(e) => ui.set({ iterationId: e.target.value === latestId ? null : e.target.value, selection: null })}
          >
            {[...iterations.data].reverse().map((x) => (
              <option key={x.id} value={x.id}>
                Iteration {x.seq} of {iterations.data.length} · {relativeTime(x.createdAt)}
              </option>
            ))}
          </select>
        ) : (
          it && <span className="xs muted">Iteration {it.seq}</span>
        )}
        <span className="xs muted mono" title="Spent on this Review">
          {usd(spend.data?.reviewUsd ?? 0)}
        </span>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          style={{ width: 180, justifyContent: 'space-between', color: 'var(--muted-foreground)' }}
          onClick={() => ui.set({ palette: true })}
        >
          <span className="row" style={{ gap: 6 }}>
            <Search className="i i-sm" />
            Search or run…
          </span>
          <Kbd keys={formatKey('mod+k')} />
        </button>
      </header>

      {changes && onLatest && (
        <div className="banner ask-tone" role="status">
          <RefreshCw className="i i-sm" style={{ color: 'var(--ask)' }} />
          <span className="sm grow">
            <b>{changes}</b>
            <span className="muted">
              {' '}
              · {r?.sourceKind === 'working_tree' ? 'Refresh to take a new Snapshot.' : 'Refresh to review the new Iteration.'}
            </span>
          </span>
          <button className="btn btn-sm" type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending && <Loader2 className="i i-sm spin" />}
            Refresh
          </button>
        </div>
      )}
      {!onLatest && it && (
        <div className="banner" role="status">
          <span className="sm grow">
            <b>Iteration {it.seq}</b> <span className="muted">· an earlier state of this Review</span>
          </span>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => ui.set({ iterationId: null })}>
            Go to latest
          </button>
        </div>
      )}

      <div className="main">
        <aside className="sidebar" aria-label="Files">
          <div className="row" style={{ padding: '12px 14px 8px' }}>
            <span className="b sm grow">Files</span>
            <span className="xs muted">
              {files.length} changed · <span className="add-t">+{cs.data?.additions ?? 0}</span>{' '}
              <span className="del-t">−{cs.data?.deletions ?? 0}</span>
            </span>
          </div>
          <div className="scroll" style={{ flex: '1 1 auto', padding: '0 6px 8px' }}>
            <FileTree files={files} viewed={viewed} activeFileId={topFile} onOpen={openFile} />
          </div>
          <div className="col" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', gap: 6 }}>
            <div className="row xs">
              <span className="grow muted">Change Set</span>
              <span>
                {viewedCount} of {files.length} files viewed
              </span>
            </div>
            <div className="progress">
              <span style={{ width: `${files.length ? (viewedCount / files.length) * 100 : 0}%` }} />
            </div>
          </div>
        </aside>

        <section className="center" aria-label="Diff">
          <div className="row wrap" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', gap: 10, flex: 'none' }}>
            {r?.intentText && (
              <span className="sm truncate" style={{ maxWidth: 420 }} title={r.intentText}>
                {r.intentText.split('\n')[0]}
              </span>
            )}
            {cs.data && cs.data.moves.length > 0 && (
              <span className="badge badge-ask">
                {cs.data.moves.length} moved {cs.data.moves.length === 1 ? 'block' : 'blocks'}
              </span>
            )}
            <span className="grow" />
            <button className="btn btn-ghost btn-sm muted" type="button" onClick={() => runExplain(selectionTarget())} title="Explain (e)">
              <BookOpen className="i i-sm" />
              Explain
              <Kbd keys={['e']} />
            </button>
            <label className="row xs muted" style={{ gap: 6, cursor: 'pointer' }}>
              <button
                className="switch"
                role="switch"
                type="button"
                aria-checked={ui.ignoreWhitespace}
                aria-label="Hide whitespace changes"
                onClick={() => ui.set({ ignoreWhitespace: !ui.ignoreWhitespace })}
              />
              Hide whitespace
            </label>
            <div className="tabs" role="tablist" aria-label="Diff layout" style={{ height: 28, padding: 2 }}>
              <button
                className="tab"
                role="tab"
                type="button"
                aria-selected={ui.layout === 'unified'}
                style={{ padding: '0 8px' }}
                onClick={() => ui.set({ layout: 'unified' })}
              >
                Unified
              </button>
              <button
                className="tab"
                role="tab"
                type="button"
                aria-selected={ui.layout === 'split'}
                style={{ padding: '0 8px' }}
                onClick={() => ui.set({ layout: 'split' })}
              >
                Split
              </button>
            </div>
          </div>
          {cs.isError ? (
            <div className="empty-state">
              <span className="sm">{(cs.error as Error).message}</span>
              <button className="btn btn-outline btn-sm" type="button" onClick={() => ui.go({ name: 'home' })}>
                <ArrowLeft className="i i-sm" />
                All Reviews
              </button>
            </div>
          ) : !cs.data ? (
            <DiffLoading />
          ) : files.length === 0 ? (
            <div className="empty-state">
              <span className="h3">No changes</span>
              <span className="sm">
                Base and Head are identical
                {r?.sourceKind === 'working_tree' ? '. Changes you or an agent make here will show up as a refresh.' : '.'}
              </span>
            </div>
          ) : (
            <DiffView
              summary={cs.data}
              model={model}
              diffs={diffs}
              viewed={viewed}
              actions={actions}
              scrollRef={scrollRef}
              onScrollTop={(px, fileId) => {
                scrollTop.current = px;
                setTopFile((prev) => (prev === fileId ? prev : fileId));
              }}
            />
          )}
        </section>

        <aside className="rightpanel" aria-label="Context">
          {runtime.data && !runtime.data.ready && (
            <div className="elev-box sm" style={{ margin: '12px 12px 0', padding: '8px 10px' }}>
              {runtime.data.detail}.{' '}
              <button
                className="btn-link sm"
                type="button"
                style={{ border: 0, cursor: 'pointer' }}
                onClick={() => ui.go({ name: 'settings', section: 'providers' })}
              >
                Settings
              </button>
            </div>
          )}
          <ExplainPanel
            job={job}
            explanation={ui.shownExplanation}
            history={(history.data ?? []).filter((h) => h.id !== (ui.shownExplanation?.id ?? job?.explanation?.id))}
            onShow={(e) => ui.set({ shownExplanation: e, activeJobId: null })}
            onJump={jumpToExplanation}
            onRetry={(force) => {
              const t = job?.target ?? ui.shownExplanation?.target ?? null;
              runExplain(t, force);
            }}
            onCancel={() => job && client.call('explain.cancel', { jobId: job.jobId })}
          />
        </aside>
      </div>
    </>
  );
}
