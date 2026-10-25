import { FileCode2, Search, Terminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatKey, fuzzy } from '../commands';
import { Kbd } from '../components/Inline';
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
  return <>{[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>))}</>;
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
    for (const c of [...cmds.filter((c) => !c.paletteHidden && (!c.enabled || c.enabled())), ...globals]) {
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

  useEffect(() => setActive(0), []);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, []);

  const files = items.filter((i) => i.kind === 'file');
  const commands = items.filter((i) => i.kind === 'command');
  const ordered = q ? items : [...commands, ...files];

  return (
    <div className="overlay" onMouseDown={close}>
      <div role="dialog" aria-label="Command palette" className="popover palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ padding: '0 14px', height: 52, borderBottom: '1px solid var(--border)', gap: 10, flex: 'none' }}>
          <Search className="i muted" />
          <input
            autoFocus
            className="palette-input"
            aria-label="Search files and actions"
            placeholder="Search files and actions"
            value={q}
            onChange={(e) => setQ(e.target.value)}
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
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {ordered.length === 0 && (
            <div className="sm muted" style={{ padding: '10px 10px' }}>
              No matches
            </div>
          )}
          {ordered.map((item, i) => {
            const header = i === 0 || ordered[i - 1]?.kind !== item.kind;
            return (
              <div key={item.id}>
                {header && !q && (
                  <div className="xs muted" style={{ padding: '8px 10px 4px', fontWeight: 500 }}>
                    {item.kind === 'file' ? 'Files' : 'Actions'}
                  </div>
                )}
                <div
                  className={`li${i === active ? ' active' : ''}`}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    close();
                    item.run();
                  }}
                >
                  {item.kind === 'file' ? <FileCode2 className="i i-sm muted" /> : <Terminal className="i i-sm muted" />}
                  <span className={`sm grow truncate${item.kind === 'file' ? ' mono' : ''}`}>
                    <Highlight text={item.label} indices={item.indices} />
                  </span>
                  {item.keys[0] && <Kbd keys={formatKey(item.keys[0])} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="row xs muted" style={{ padding: '10px 14px', gap: 14, borderTop: '1px solid var(--border)', flex: 'none' }}>
          <span className="row" style={{ gap: 4 }}>
            <Kbd keys={['↑', '↓']} />
            move
          </span>
          <span className="row" style={{ gap: 4 }}>
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
