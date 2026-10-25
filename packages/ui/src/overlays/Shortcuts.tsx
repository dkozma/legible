import { Keyboard } from 'lucide-react';
import { formatKey } from '../commands';
import { Eyebrow, Kbd } from '../components/ui';
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-overlay pt-[12vh]" onMouseDown={() => set({ shortcuts: false })}>
      <div
        role="dialog"
        aria-labelledby="kb-h"
        className="w-[640px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[14px] border bg-popover text-popover-foreground shadow-popover"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-[18px] py-4">
          <Keyboard className="size-4 text-muted-foreground" />
          <h2 className="grow text-base font-semibold" id="kb-h">
            Keyboard shortcuts
          </h2>
          <Kbd keys={['?']} />
        </div>
        <div className="grid grid-cols-2 gap-x-7 gap-y-[22px] px-[18px] pt-4 pb-5">
          {GROUPS.map((g) => (
            <section key={g.title} className="flex flex-col gap-2">
              <Eyebrow>{g.title}</Eyebrow>
              {g.rows.map(([label, keys]) => (
                <div key={label} className="flex items-center gap-2 text-sm">
                  <span className="grow">{label}</span>
                  <span className="flex items-center gap-1">
                    {keys.map((k) =>
                      k.includes(' ') ? (
                        <span key={k} className="text-xs text-muted-foreground">
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
