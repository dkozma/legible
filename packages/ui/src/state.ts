import type { Explanation, ExplanationJob } from '@legible/domain';
import { create } from 'zustand';

import type { Command } from './commands';

export type View = { name: 'home' } | { name: 'review'; reviewId: string } | { name: 'settings'; section: string | null };

export interface Selection {
  fileId: string;
  anchor: number;
  focus: number;
}

/** A Trail entry: where the diff was scrolled. */
export interface Location {
  reviewId: string;
  px: number;
}

export interface PaletteSource {
  commands: Command[];
  files: { id: string; path: string }[];
  openFile(id: string): void;
}

export interface Toast {
  id: number;
  kind: 'error' | 'info';
  message: string;
}

export interface UIState {
  view: View;
  returnTo: View | null;
  iterationId: string | null;
  layout: 'unified' | 'split';
  ignoreWhitespace: boolean;
  selection: Selection | null;
  /** Index into the RowModel's hunks. */
  cursor: number;
  activeFileId: string | null;
  expandedFiles: Set<string>;
  collapsedFiles: Set<string>;
  expandedFrags: Set<string>;
  gapReveal: Map<string, number>;
  jobs: Record<string, ExplanationJob>;
  activeJobId: string | null;
  shownExplanation: Explanation | null;
  palette: boolean;
  shortcuts: boolean;
  toasts: Toast[];
  changesAvailable: Record<string, string>;
  trail: { back: Location[]; forward: Location[] };
  scrollTo: { px: number; nonce: number } | null;
  paletteSource: PaletteSource | null;
  /** The Review whose view state (selection, expansions, Trail) is loaded. */
  lastReviewId: string | null;

  go(view: View): void;
  set(patch: Partial<UIState>): void;
  toggleIn(key: 'expandedFiles' | 'collapsedFiles' | 'expandedFrags', id: string, on?: boolean): void;
  revealGap(key: string, by: number): void;
  upsertJob(job: ExplanationJob): void;
  toast(message: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  scroll(px: number): void;
  resetReviewView(): void;
}

let toastId = 0;
let nonce = 0;

export const useUI = create<UIState>((set, get) => ({
  view: { name: 'home' },
  returnTo: null,
  iterationId: null,
  layout: 'unified',
  ignoreWhitespace: false,
  selection: null,
  cursor: 0,
  activeFileId: null,
  expandedFiles: new Set(),
  collapsedFiles: new Set(),
  expandedFrags: new Set(),
  gapReveal: new Map(),
  jobs: {},
  activeJobId: null,
  shownExplanation: null,
  palette: false,
  shortcuts: false,
  toasts: [],
  changesAvailable: {},
  trail: { back: [], forward: [] },
  scrollTo: null,
  paletteSource: null,
  lastReviewId: null,

  go(view) {
    const cur = get().view;
    if (view.name === 'settings' && cur.name !== 'settings') set({ returnTo: cur });
    if (view.name === 'review' && get().lastReviewId !== view.reviewId) {
      get().resetReviewView();
      set({ lastReviewId: view.reviewId });
    }
    set({ view, palette: false, shortcuts: false });
  },
  set(patch) {
    set(patch);
  },
  toggleIn(key, id, on) {
    const next = new Set(get()[key]);
    const want = on ?? !next.has(id);
    if (want) next.add(id);
    else next.delete(id);
    set({ [key]: next } as Partial<UIState>);
  },
  revealGap(key, by) {
    const next = new Map(get().gapReveal);
    next.set(key, (next.get(key) ?? 0) + by);
    set({ gapReveal: next });
  },
  upsertJob(job) {
    set({ jobs: { ...get().jobs, [job.jobId]: job } });
  },
  toast(message, kind = 'error') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, message }].slice(-4) });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4000);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  scroll(px) {
    set({ scrollTo: { px: Math.max(0, px), nonce: ++nonce } });
  },
  resetReviewView() {
    set({
      iterationId: null,
      selection: null,
      cursor: 0,
      activeFileId: null,
      expandedFiles: new Set(),
      collapsedFiles: new Set(),
      expandedFrags: new Set(),
      gapReveal: new Map(),
      activeJobId: null,
      shownExplanation: null,
      trail: { back: [], forward: [] },
    });
  },
}));
