// The virtualized diff renderer: fixed-height rows, sticky gutters, gutter
// selection, and an overview ruler.

import type { ChangeSetSummary, FileChange, FileDiff } from '@legible/domain';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BookOpen, Check, ChevronsUpDown, ExternalLink, FileCode2, Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Badge, Button, cn } from '../components/ui';
import { useUI } from '../state';
import { Code } from './code';
import { ROW_HEIGHT, type Row, type RowModel, rowAt } from './rows';

export interface DiffActions {
  /** Explains change chunks `chunk..lastChunk` of a file. */
  explainChunk(fileId: string, chunk: number, lastChunk?: number): void;
  explainFile(fileId: string): void;
  openInEditor(path: string, line: number): void;
  toggleViewed(fileId: string): void;
  canOpenInEditor: boolean;
}

interface Props {
  summary: ChangeSetSummary;
  model: RowModel;
  diffs: Record<string, FileDiff | undefined>;
  viewed: ReadonlySet<string>;
  actions: DiffActions;
  /** Reports the scroll position, for j/k/n/p and the Trail. */
  onScrollTop(px: number, fileId: string | null): void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const COLLAPSE_TEXT: Record<string, string> = {
  viewed: 'Viewed',
  generated: 'Generated file',
  lockfile: 'Lockfile',
  binary: 'Binary file',
  large: 'Large file',
  vendored: 'Vendored code',
  structural: 'Structural only — verified behavior-preserving',
  unchanged: 'No content changes',
  user: 'Collapsed',
};

const STATUS_TEXT: Record<FileChange['status'], string> = {
  added: 'Added',
  deleted: 'Deleted',
  modified: 'Modified',
  renamed: 'Renamed',
  copied: 'Copied',
  typechange: 'Type changed',
};

const widest = new WeakMap<FileDiff, number>();
/** Longest line in a file, measured once per loaded diff. */
function widestLine(d: FileDiff): number {
  let max = widest.get(d);
  if (max === undefined) {
    max = 0;
    for (const l of d.baseLines) if (l.length > max) max = l.length;
    for (const l of d.headLines) if (l.length > max) max = l.length;
    widest.set(d, max);
  }
  return max;
}

export function DiffView({ summary, model, diffs, viewed, actions, onScrollTop, scrollRef }: Props) {
  const [width, setWidth] = useState(800);
  const selection = useUI((s) => s.selection);
  const cursor = useUI((s) => s.cursor);
  const layout = useUI((s) => s.layout);
  const scrollTo = useUI((s) => s.scrollTo);
  const filesById = useMemo(() => new Map(summary.files.map((f) => [f.id, f])), [summary.files]);

  const virtualizer = useVirtualizer({
    count: model.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_HEIGHT[(model.rows[i] as Row).k],
    overscan: 30,
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [scrollRef]);

  // Programmatic scrolls (j/k, n/p, file tree, palette, Trail).
  useEffect(() => {
    if (!scrollTo || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollTo.px;
  }, [scrollTo, scrollRef]);

  // Report the scroll position and the file at the top of the viewport.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const r = model.rows[rowAt(model, el.scrollTop + 72)];
    onScrollTop(el.scrollTop, r && r.k !== 'end' ? r.fileId : null);
  }, [model, onScrollTop, scrollRef]);
  useEffect(onScroll, [onScroll]);

  // Widest line, so long lines scroll horizontally instead of clipping (unified only).
  const contentWidth = useMemo(() => {
    if (layout === 'split') return width;
    let max = 0;
    for (const d of Object.values(diffs)) if (d) max = Math.max(max, widestLine(d));
    return Math.max(width, Math.min(max, 2000) * 7.25 + 140);
  }, [diffs, layout, width]);

  const cur = model.hunks[cursor];
  const sel = selection
    ? { fileId: selection.fileId, lo: Math.min(selection.anchor, selection.focus), hi: Math.max(selection.anchor, selection.focus) }
    : null;

  // Gutter selection with drag.
  const dragging = useRef(false);
  const startSelect = (row: number, fileId: string, extend: boolean) => {
    const s = useUI.getState().selection;
    if (extend && s && s.fileId === fileId) useUI.getState().set({ selection: { ...s, focus: row } });
    else useUI.getState().set({ selection: { fileId, anchor: row, focus: row } });
    dragging.current = true;
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !scrollRef.current) return;
      const rect = scrollRef.current.getBoundingClientRect();
      const row = rowAt(model, scrollRef.current.scrollTop + e.clientY - rect.top);
      const s = useUI.getState().selection;
      const r = model.rows[row];
      if (!s || !r || r.k === 'end' || r.fileId !== s.fileId) return;
      if (r.k === 'line' || r.k === 'pair') useUI.getState().set({ selection: { ...s, focus: row } });
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [model, scrollRef]);

  return (
    <div className="flex min-h-0 flex-auto">
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-auto overflow-auto bg-background font-mono text-sm leading-5 [tab-size:4]"
        onScroll={onScroll}
        data-testid="diff"
        style={{ ['--vw' as string]: `${width}px` }}
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize(), width: contentWidth }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = model.rows[v.index] as Row;
            const file = row.k === 'end' ? undefined : filesById.get(row.fileId);
            const isCur = Boolean(cur && row.k !== 'end' && row.fileId === cur.fileId && 'chunk' in row && row.chunk === cur.chunk);
            const isSel = Boolean(sel && row.k !== 'end' && row.fileId === sel.fileId && v.index >= sel.lo && v.index <= sel.hi);
            return (
              <div
                key={v.key}
                className="group/row absolute top-0 left-0 w-full"
                data-row={v.index}
                style={{ transform: `translateY(${v.start}px)`, height: v.size }}
              >
                <RowView
                  row={row}
                  index={v.index}
                  file={file}
                  diff={file ? diffs[file.id] : undefined}
                  viewed={file ? viewed.has(file.id) : false}
                  isCur={isCur}
                  isSel={isSel}
                  layout={layout}
                  actions={actions}
                  onSelect={startSelect}
                />
              </div>
            );
          })}
        </div>
      </div>
      <Ruler model={model} scrollRef={scrollRef} selection={sel} />
    </div>
  );
}

interface RowProps {
  row: Row;
  index: number;
  file: FileChange | undefined;
  diff: FileDiff | undefined;
  viewed: boolean;
  isCur: boolean;
  isSel: boolean;
  layout: 'unified' | 'split';
  actions: DiffActions;
  onSelect(row: number, fileId: string, extend: boolean): void;
}

type LineState = 'add' | 'del' | 'ctx' | 'moved' | 'selected';

/** Row tint, and the same tint over an opaque base for the sticky gutter. */
const LINE_BG: Record<LineState, { row: string; gutter: string; sign: string }> = {
  ctx: { row: '', gutter: 'bg-background', sign: 'text-dim' },
  add: { row: 'bg-add', gutter: 'bg-background bg-linear-to-r from-add to-add', sign: 'text-ok' },
  del: { row: 'bg-del', gutter: 'bg-background bg-linear-to-r from-del to-del', sign: 'text-critical' },
  moved: { row: 'bg-move/8', gutter: 'bg-background bg-linear-to-r from-move/8 to-move/8', sign: 'text-move' },
  selected: {
    row: 'bg-ask-bg shadow-[inset_0_1px_0_var(--ask-border),inset_0_-1px_0_var(--ask-border)]',
    gutter: 'bg-background bg-linear-to-r from-ask-bg to-ask-bg',
    sign: 'text-ask',
  },
};

const lineNumber = 'w-11 shrink-0 cursor-pointer pr-2 text-right text-dim hover:text-foreground';

function lineState(t: '-' | '+' | ' ', moved: boolean, selected: boolean): LineState {
  if (selected) return 'selected';
  if (moved && t !== ' ') return 'moved';
  return t === '+' ? 'add' : t === '-' ? 'del' : 'ctx';
}

const kindOf = (t: '-' | '+' | ' ') => (t === '+' ? 'add' : t === '-' ? 'del' : 'ctx');

const RowView = memo(function RowView({ row, index, file, diff, viewed, isCur, isSel, actions, onSelect }: RowProps) {
  const ui = useUI.getState;
  switch (row.k) {
    case 'end':
      return <div className="flex h-16 items-center justify-center font-sans text-sm text-dim">End of Change Set</div>;
    case 'file': {
      if (!file) return null;
      const renamed = file.oldPath && file.oldPath !== file.path;
      return (
        <div
          className={cn(
            'sticky left-0 flex h-10 w-(--vw) items-center gap-2.5 border-y bg-sidebar pr-3.5 pl-3 font-sans',
            row.first && 'border-t-0',
          )}
          data-testid="file-head"
          data-file={file.id}
        >
          <button
            type="button"
            title={viewed ? 'Viewed (v)' : 'Mark viewed (v)'}
            aria-label={viewed ? `Mark ${file.path} not viewed` : `Mark ${file.path} viewed`}
            aria-pressed={viewed}
            data-testid="viewed-toggle"
            onClick={() => actions.toggleViewed(file.id)}
            className={cn(
              'inline-flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-foreground/25',
              viewed && 'border-foreground bg-foreground text-background',
            )}
          >
            {viewed && <Check className="size-2.5" strokeWidth={3} />}
          </button>
          <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-sm" title={file.path}>
            {renamed ? (
              <>
                <span className="text-muted-foreground">{file.oldPath} → </span>
                {file.path}
              </>
            ) : (
              file.path
            )}
          </span>
          <span className="font-mono text-xs text-ok">+{file.additions}</span>
          <span className="font-mono text-xs text-critical">−{file.deletions}</span>
          {file.status !== 'modified' && <Badge tone="muted">{STATUS_TEXT[file.status]}</Badge>}
          {file.structural && <Badge tone="muted">Structural · {file.structural}</Badge>}
          {file.collapse && <Badge tone="muted">{file.collapse}</Badge>}
          {file.notes.map((n) => (
            <Badge key={n} tone="elevated">
              {n}
            </Badge>
          ))}
          <span className="grow" />
          {!file.binary && (
            <Button variant="muted" size="xs" onClick={() => actions.explainFile(file.id)} title="Explain this file (⇧E)">
              <BookOpen />
              Explain file
            </Button>
          )}
          {actions.canOpenInEditor && file.status !== 'deleted' && (
            <Button
              variant="muted"
              size="icon-xs"
              aria-label="Open in editor"
              title="Open in editor (o)"
              onClick={() => actions.openInEditor(file.path, 1)}
            >
              <ExternalLink />
            </Button>
          )}
          <Button
            variant="muted"
            size="icon-xs"
            aria-label="Collapse or expand file"
            title="Collapse or expand"
            onClick={() => {
              const s = ui();
              const collapsedNow =
                s.collapsedFiles.has(file.id) ||
                (!s.expandedFiles.has(file.id) && (viewed || Boolean(file.collapse) || Boolean(file.structural)));
              if (collapsedNow) {
                s.toggleIn('collapsedFiles', file.id, false);
                s.toggleIn('expandedFiles', file.id, true);
              } else {
                s.toggleIn('expandedFiles', file.id, false);
                s.toggleIn('collapsedFiles', file.id, true);
              }
            }}
          >
            <ChevronsUpDown />
          </Button>
        </div>
      );
    }
    case 'collapsed': {
      const fixed = row.reason === 'binary' || row.reason === 'unchanged';
      return (
        <button
          type="button"
          disabled={fixed}
          className="sticky left-0 flex h-[34px] w-(--vw) items-center gap-2 border-b bg-frag pr-3.5 pl-[25px] text-left font-sans text-sm text-muted-foreground disabled:cursor-default"
          onClick={() => {
            const s = ui();
            s.toggleIn('collapsedFiles', row.fileId, false);
            s.toggleIn('expandedFiles', row.fileId, true);
          }}
        >
          <ChevronsUpDown className="size-3" />
          <span>{row.reason === 'unchanged' && file?.notes.length ? file.notes.join(' · ') : COLLAPSE_TEXT[row.reason]}</span>
          {!fixed && <span className="text-dim">· show</span>}
        </button>
      );
    }
    case 'hunk':
      return (
        <div
          className={cn(
            'flex h-6 items-center gap-2.5 border-y bg-hunk pr-3 pl-[25px] text-xs text-muted-foreground',
            isCur && 'text-foreground',
          )}
        >
          <span>
            @@ −{row.base + 1},{row.baseLen} +{row.head + 1},{row.headLen} @@
          </span>
          <span className={cn('sticky right-3 ml-auto flex gap-1 opacity-0 group-hover/row:opacity-100', isCur && 'opacity-100')}>
            <Button
              variant="ghost"
              size="xs"
              className="font-sans"
              onClick={() => actions.explainChunk(row.fileId, row.chunk, row.lastChunk)}
            >
              <BookOpen />
              Explain
            </Button>
            {actions.canOpenInEditor && file && file.status !== 'deleted' && (
              <Button variant="ghost" size="xs" className="font-sans" onClick={() => actions.openInEditor(file.path, row.head + 1)}>
                <ExternalLink />
                Open
              </Button>
            )}
          </span>
        </div>
      );
    case 'gap':
      return (
        <button
          type="button"
          className="flex h-6 w-full items-center justify-center gap-1.5 border-y bg-hunk font-sans text-xs text-muted-foreground hover:text-foreground"
          onClick={(e) => ui().revealGap(row.gapKey, e.altKey || row.count <= 60 ? row.count : 25)}
          title="Show unchanged lines (⌥-click for all)"
        >
          <ChevronsUpDown className="size-3" />
          {row.count} unchanged {row.count === 1 ? 'line' : 'lines'}
        </button>
      );
    case 'frag':
      return (
        <div
          className="flex h-7 items-center gap-2 border-y bg-frag pr-3 pl-[25px] font-sans text-sm text-muted-foreground"
          onClick={() => ui().toggleIn('expandedFrags', row.fragmentId)}
          role="button"
          tabIndex={-1}
          data-testid="structural-fragment"
        >
          <ChevronsUpDown className="size-3" />
          <span>{row.label}</span>
          <span className="grow" />
          <span className="text-xs">
            {row.lines} {row.lines === 1 ? 'line' : 'lines'} · {row.expanded ? 'collapse' : 'expand'}
          </span>
        </div>
      );
    case 'line': {
      const base = row.base;
      const head = row.head;
      const text = diff ? (row.t === '-' ? diff.baseLines[base] : diff.headLines[head]) : null;
      const tokens = diff ? (row.t === '-' ? diff.baseTokens?.[base] : diff.headTokens?.[head]) : undefined;
      const words = diff ? (row.t === '-' ? diff.baseWords[base] : row.t === '+' ? diff.headWords[head] : undefined) : undefined;
      const bg = LINE_BG[lineState(row.t, row.moved, isSel)];
      return (
        <div
          className={cn('flex h-5', bg.row)}
          data-kind={kindOf(row.t)}
          data-selected={isSel || undefined}
          data-current={isCur || undefined}
        >
          <span className={cn('sticky left-0 z-[1] flex', bg.gutter)}>
            <span className={cn('w-[3px] shrink-0', isCur && 'bg-foreground')} />
            <span className={lineNumber} data-testid="base-line-number" onMouseDown={(e) => onSelect(index, row.fileId, e.shiftKey)}>
              {base >= 0 ? base + 1 : ''}
            </span>
            <span className={lineNumber} data-testid="head-line-number" onMouseDown={(e) => onSelect(index, row.fileId, e.shiftKey)}>
              {head >= 0 ? head + 1 : ''}
            </span>
            <span className={cn('w-[18px] shrink-0 text-center', bg.sign)}>{row.t === ' ' ? '' : row.t === '-' ? '−' : '+'}</span>
          </span>
          <span className={cn('flex-auto pr-4 whitespace-pre select-text', text === null && 'text-dim')}>
            {text === null ? '…' : <Code text={text ?? ''} tokens={tokens} words={words} wordClass={row.t === '-' ? 'del' : 'add'} />}
          </span>
        </div>
      );
    }
    case 'pair': {
      const half = (side: 'l' | 'r') => {
        const idx = side === 'l' ? row.l : row.r;
        const t = side === 'l' ? row.lt : row.rt;
        if (idx < 0 || t === null)
          return <div className="w-full bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--inset)_6px_7px)]" />;
        const lines = side === 'l' ? diff?.baseLines : diff?.headLines;
        const tokens = side === 'l' ? diff?.baseTokens?.[idx] : diff?.headTokens?.[idx];
        const words = t === ' ' ? undefined : side === 'l' ? diff?.baseWords[idx] : diff?.headWords[idx];
        const moved = side === 'l' ? row.lmoved : row.rmoved;
        const text = lines?.[idx];
        const bg = LINE_BG[lineState(t, moved, isSel)];
        return (
          <div className={cn('flex h-5 w-full', bg.row)} data-kind={kindOf(t)} data-selected={isSel || undefined}>
            <span className={cn('sticky left-0 z-[1] flex', bg.gutter)}>
              <span className={cn('w-[3px] shrink-0', isCur && 'bg-foreground')} />
              <span className={lineNumber} onMouseDown={(e) => onSelect(index, row.fileId, e.shiftKey)}>
                {idx + 1}
              </span>
              <span className={cn('w-[18px] shrink-0 text-center', bg.sign)}>{t === ' ' ? '' : t === '-' ? '−' : '+'}</span>
            </span>
            <span className="flex-auto overflow-hidden pr-4 text-ellipsis whitespace-pre select-text">
              {text === undefined ? '…' : <Code text={text} tokens={tokens} words={words} wordClass={t === '-' ? 'del' : 'add'} />}
            </span>
          </div>
        );
      };
      return (
        <div className="flex h-5" data-testid="split-row">
          <div className="flex w-1/2 min-w-0">{half('l')}</div>
          <div className="flex w-1/2 min-w-0 border-l">{half('r')}</div>
        </div>
      );
    }
  }
});

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** VS Code–style overview ruler: changes, moves, Structural regions, selection, viewport. */
function Ruler({
  model,
  scrollRef,
  selection,
}: {
  model: RowModel;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  selection: { lo: number; hi: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    el.addEventListener('scroll', on);
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', on);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  // Marks change only with the model or selection; cache them and redraw just the viewport on scroll.
  const marks = useRef<{ canvas: HTMLCanvasElement; key: unknown } | null>(null);

  useEffect(() => {
    void tick;
    const canvas = canvasRef.current;
    const el = scrollRef.current;
    if (!canvas || !el) return;
    const dpr = window.devicePixelRatio || 1;
    const h = canvas.clientHeight;
    const w = canvas.clientWidth;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      marks.current = null;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const total = Math.max(1, model.totalHeight);
    const y = (off: number) => (off / total) * h;
    const key = [model, selection?.lo, selection?.hi, document.documentElement.dataset.theme];
    const cached = marks.current;
    if (!cached || (cached.key as unknown[]).some((k, i) => k !== key[i])) {
      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const m = off.getContext('2d');
      if (!m) return;
      m.scale(dpr, dpr);
      const colors = {
        add: cssVar('--ok'),
        del: cssVar('--critical'),
        move: cssVar('--move'),
        frag: cssVar('--dim'),
        sel: cssVar('--ask'),
        file: cssVar('--border'),
      };
      for (const f of model.files) {
        m.fillStyle = colors.file;
        m.fillRect(0, y(model.offsets[f.row] ?? 0), w, 1);
      }
      for (let i = 0; i < model.rows.length; i++) {
        const r = model.rows[i] as Row;
        let color: string | null = null;
        let x = 3;
        let bw = 4;
        if (r.k === 'line' && r.t !== ' ') {
          color = r.moved ? colors.move : r.t === '+' ? colors.add : colors.del;
          x = r.t === '+' ? 7 : 2;
        } else if (r.k === 'pair' && (r.lt === '-' || r.rt === '+')) {
          color = r.lmoved || r.rmoved ? colors.move : r.rt === '+' ? colors.add : colors.del;
        } else if (r.k === 'frag') {
          color = colors.frag;
          x = 2;
          bw = 9;
        }
        if (!color) continue;
        m.fillStyle = color;
        m.fillRect(x, y(model.offsets[i] ?? 0), bw, Math.max(2, y(ROW_HEIGHT[r.k])));
      }
      if (selection) {
        m.fillStyle = colors.sel;
        const top = y(model.offsets[selection.lo] ?? 0);
        m.fillRect(0, top, w, Math.max(2, y((model.offsets[selection.hi] ?? 0) + 20) - top));
      }
      marks.current = { canvas: off, key };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage((marks.current as { canvas: HTMLCanvasElement }).canvas, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = cssVar('--track');
    ctx.fillRect(0, y(el.scrollTop), w, Math.max(6, y(el.clientHeight)));
  }, [tick, model, selection, scrollRef]);

  return (
    <div
      className="relative w-3.5 shrink-0 cursor-pointer border-l bg-inset"
      aria-hidden="true"
      onMouseDown={(e) => {
        const el = scrollRef.current;
        if (!el) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = (e.clientY - rect.top) / rect.height;
        el.scrollTop = frac * model.totalHeight - el.clientHeight / 2;
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  );
}

export function DiffLoading() {
  return (
    <div className="flex flex-auto flex-col items-center justify-center gap-2.5 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span className="text-sm">Reading the Change Set…</span>
    </div>
  );
}
