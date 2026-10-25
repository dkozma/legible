import { FileCode2, Search, Terminal } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { formatKey, fuzzy } from '../commands';
import { cn, Kbd } from '../components/ui';
import { useUI } from '../state';

interface Item {
  id: string;
  kind: 'file' | 'command';
  label: string;
  keys: string[];
  indices: number[];
  score: number;
  run: () => void;
}

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  // `indices` are UTF-16 offsets (from indexOf). Walk code points so emoji stay whole, keyed by offset.
  const parts: ReactNode[] = [];
  let at = 0;
  for (const ch of text) {
    parts.push(
      set.has(at) ? (
        <mark key={at} className="bg-transparent font-semibold text-foreground">
          {ch}
        </mark>
      ) : (
        <span key={at}>{ch}</span>
      ),
    );
    at += ch.length;
  }
  return <>{parts}</>;
}

export function Palette() {
  const source = useUI((s) => s.paletteSource);
  const set = useUI((s) => s.set);
  const go = useUI((s) => s.go);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => set({ palette: false });

  const items = useMemo(() => {
    const out: Item[] = [];
    const cmds = source?.commands ?? [];
    const globals = [
      { id: 'settings', title: 'Open Settings', keys: ['mod+,'], run: () => go({ name: 'settings', section: null }) },
      { id: 'shortcuts', title: 'Show keyboard shortcuts', keys: ['?'], run: () => set({ shortcuts: true }) },
      { id: 'home', title: 'All Reviews', keys: [], run: () => go({ name: 'home' }) },
    ];
    for (const c of [...cmds.filter((cmd) => !cmd.paletteHidden && (!cmd.enabled || cmd.enabled())), ...globals]) {
      const title = 'title' in c ? c.title : '';
      const m = fuzzy(q, title);
      if (m) out.push({ id: `c:${c.id}`, kind: 'command', label: title, keys: c.keys, indices: m.indices, score: m.score - 1, run: c.run });
    }
    for (const f of source?.files ?? []) {
      const m = fuzzy(q, f.path);
      if (m)
        out.push({
          id: `f:${f.id}`,
          kind: 'file',
          label: f.path,
          keys: [],
          indices: m.indices,
          score: m.score,
          run: () => source?.openFile(f.id),
        });
    }
    if (q) out.sort((a, b) => b.score - a.score);
    return out.slice(0, 80);
  }, [q, source, go, set]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const files = items.filter((i) => i.kind === 'file');
  const commands = items.filter((i) => i.kind === 'command');
  const ordered = q ? items : [...commands, ...files];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-overlay pt-[12vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="flex max-h-[70vh] w-[600px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[14px] border bg-popover text-popover-foreground shadow-popover"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b px-3.5">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            className="h-full flex-auto border-0 bg-transparent text-[15px] text-foreground outline-none select-text placeholder:text-muted-foreground"
            aria-label="Search files and actions"
            placeholder="Search files and actions"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(ordered.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const item = ordered[active];
                if (item) {
                  close();
                  item.run();
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          />
          <Kbd keys={['esc']} />
        </div>
        <div className="overflow-auto p-1.5" ref={listRef}>
          {ordered.length === 0 && <div className="p-2.5 text-sm text-muted-foreground">No matches</div>}
          {ordered.map((item, i) => {
            const header = i === 0 || ordered[i - 1]?.kind !== item.kind;
            return (
              <div key={item.id}>
                {header && !q && (
                  <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                    {item.kind === 'file' ? 'Files' : 'Actions'}
                  </div>
                )}
                <div
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  data-index={i}
                  className={cn('flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2', i === active && 'bg-accent')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    close();
                    item.run();
                  }}
                >
                  {item.kind === 'file' ? (
                    <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className={cn('min-w-0 flex-auto truncate text-sm', item.kind === 'file' && 'font-mono')}>
                    <Highlight text={item.label} indices={item.indices} />
                  </span>
                  {item.keys[0] && <Kbd keys={formatKey(item.keys[0])} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-3.5 border-t px-3.5 py-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd keys={['↑', '↓']} />
            move
          </span>
          <span className="flex items-center gap-1">
            <Kbd keys={['↵']} />
            open
          </span>
          <span className="grow" />
          <span>Jumps join the Trail</span>
        </div>
      </div>
    </div>
  );
}
