import { Keyboard } from 'lucide-react';
import { formatKey } from '../commands';
import { Kbd } from '../components/Inline';
import { useUI } from '../state';

const GROUPS: { title: string; rows: [string, string[]][] }[] = [
  {
    title: 'Move',
    rows: [
      ['Next / previous hunk', ['j', 'k']],
      ['Next / previous file', ['n', 'p']],
      ['Trail back / forward', ['mod+[', 'mod+]']],
    ],
  },
  {
    title: 'Act',
    rows: [
      ['Explain selection or hunk', ['e']],
      ['Explain current file', ['shift+e']],
      ['Mark file viewed', ['v']],
      ['Select lines', ['click / drag line numbers']],
    ],
  },
  {
    title: 'View',
    rows: [
      ['Split / unified', ['alt+s']],
      ['Hide whitespace changes', ['w']],
      ['Show all unchanged lines in a gap', ['alt+click']],
    ],
  },
  {
    title: 'App',
    rows: [
      ['Command palette', ['mod+k']],
      ['Open in editor', ['o']],
      ['Refresh Snapshot', ['shift+r']],
      ['Settings', ['mod+,']],
      ['This overlay', ['?']],
    ],
  },
];

export function Shortcuts() {
  const set = useUI((s) => s.set);
  return (
    <div className="overlay" onMouseDown={() => set({ shortcuts: false })}>
      <div
        role="dialog"
        aria-labelledby="kb-h"
        className="popover"
        style={{ width: 640, maxWidth: 'calc(100vw - 32px)', borderRadius: 14, overflow: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <Keyboard className="i muted" />
          <h2 className="h3 grow" id="kb-h">
            Keyboard shortcuts
          </h2>
          <span className="kbd">?</span>
        </div>
        <div style={{ padding: '16px 18px 20px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '22px 28px' }}>
          {GROUPS.map((g) => (
            <section key={g.title} className="col" style={{ gap: 8 }}>
              <h3 className="eyebrow">{g.title}</h3>
              {g.rows.map(([label, keys]) => (
                <div key={label} className="row sm">
                  <span className="grow">{label}</span>
                  <span className="row" style={{ gap: 4 }}>
                    {keys.map((k) =>
                      k.includes(' ') ? (
                        <span key={k} className="xs muted">
                          {k}
                        </span>
                      ) : (
                        <Kbd key={k} keys={formatKey(k)} />
                      ),
                    )}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
