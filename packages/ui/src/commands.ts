// One command registry drives keyboard shortcuts, the command palette, and the
// shortcut overlay (engineering plan §12).

import { useEffect, useRef } from 'react';

export type CommandGroup = 'Move' | 'Act' | 'View' | 'App';

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** Key specs like "j", "shift+e", "mod+k", "alt+s", "?". */
  keys: string[];
  /** Hidden from the palette (e.g. raw navigation keys). */
  paletteHidden?: boolean;
  enabled?: () => boolean;
  run: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export function formatKey(spec: string): string[] {
  const parts = spec.split('+');
  return parts.map((p) => {
    switch (p) {
      case 'mod':
        return isMac ? '⌘' : 'Ctrl';
      case 'shift':
        return '⇧';
      case 'alt':
        return isMac ? '⌥' : 'Alt';
      case 'enter':
        return '↵';
      case 'escape':
        return 'esc';
      default:
        // Letters after a modifier read as capitals, as on the keycaps: ⌘K, ⌥S.
        return parts.length > 1 && /^[a-z]$/.test(p) ? p.toUpperCase() : p;
    }
  });
}

export function matches(spec: string, e: KeyboardEvent): boolean {
  const parts = spec.split('+');
  const key = parts[parts.length - 1] as string;
  const mod = parts.includes('mod');
  const shift = parts.includes('shift');
  const alt = parts.includes('alt');
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== modPressed) return false;
  if (alt !== e.altKey) return false;
  // "?" and other shifted symbols match on the produced character.
  const k = e.key.toLowerCase();
  if (key === '?') return e.key === '?';
  if (shift !== e.shiftKey) return false;
  if (alt) return e.code === `Key${key.toUpperCase()}` || k === key;
  return k === key;
}

function typingInField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

/**
 * Binds commands to the window. Plain keys are ignored while typing in a field.
 * The listener stays bound; `active` is read per keystroke so keys pressed right
 * after an overlay closes aren't lost.
 */
export function useKeyboard(commands: Command[], active = true) {
  const ref = useRef(commands);
  ref.current = commands;
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current || e.defaultPrevented || e.isComposing) return;
      const typing = typingInField(e);
      for (const c of ref.current) {
        for (const spec of c.keys) {
          const needsMod = spec.includes('mod+') || spec === 'escape';
          if (typing && !needsMod) continue;
          if (!matches(spec, e)) continue;
          if (c.enabled && !c.enabled()) continue;
          e.preventDefault();
          c.run();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Subsequence fuzzy match; returns matched indices or null. */
export function fuzzy(query: string, text: string): { score: number; indices: number[] } | null {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let ti = 0;
  let score = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    indices.push(at);
    // Reward consecutive runs and matches at word starts.
    if (at === prev + 1) score += 3;
    if (at === 0 || /[\s/._-]/.test(t[at - 1] ?? '')) score += 2;
    score -= (at - ti) * 0.01;
    prev = at;
    ti = at + 1;
  }
  // Prefer matches in the file name over the directory.
  const slash = t.lastIndexOf('/');
  if (indices.length && (indices[0] as number) > slash) score += 4;
  return { score, indices };
}
