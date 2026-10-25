import type { FileChange } from '@legible/domain';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '../components/ui';

interface Dir {
  name: string;
  path: string;
  dirs: Map<string, Dir>;
  files: FileChange[];
}

function buildTree(files: FileChange[]): Dir {
  const root: Dir = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let d = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i] as string;
      let next = d.dirs.get(name);
      if (!next) {
        next = { name, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] };
        d.dirs.set(name, next);
      }
      d = next;
    }
    d.files.push(f);
  }
  // Collapse single-child directory chains: src/refunds instead of src › refunds.
  const squash = (d: Dir): Dir => {
    for (const [k, child] of d.dirs) d.dirs.set(k, squash(child));
    if (d.name && d.files.length === 0 && d.dirs.size === 1) {
      const only = [...d.dirs.values()][0] as Dir;
      return { ...only, name: `${d.name}/${only.name}` };
    }
    return d;
  };
  return squash(root);
}

const STATUS: Record<FileChange['status'], [string, string]> = {
  added: ['A', 'text-ok'],
  deleted: ['D', 'text-critical'],
  modified: ['M', 'text-muted-foreground'],
  renamed: ['R', 'text-muted-foreground'],
  copied: ['C', 'text-muted-foreground'],
  typechange: ['T', 'text-muted-foreground'],
};

export function FileTree({
  files,
  viewed,
  activeFileId,
  onOpen,
}: {
  files: FileChange[];
  viewed: ReadonlySet<string>;
  activeFileId: string | null;
  onOpen: (id: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const renderDir = (d: Dir, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    for (const child of d.dirs.values()) {
      const isClosed = closed.has(child.path);
      out.push(
        <button
          type="button"
          key={`d:${child.path}`}
          aria-expanded={!isClosed}
          className="flex h-[26px] w-full items-center gap-1.5 rounded-sm px-2 text-left text-sm text-muted-foreground"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() =>
            setClosed((s) => {
              const n = new Set(s);
              if (n.has(child.path)) n.delete(child.path);
              else n.add(child.path);
              return n;
            })
          }
        >
          {isClosed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          <span className="truncate">{child.name}</span>
        </button>,
      );
      if (!isClosed) out.push(...renderDir(child, depth + 1));
    }
    for (const f of d.files) {
      const [letter, cls] = STATUS[f.status];
      const isViewed = viewed.has(f.id);
      const name = f.path.split('/').pop();
      out.push(
        <div
          key={f.id}
          className={cn(
            'flex h-[26px] cursor-pointer items-center gap-1.5 rounded-sm px-2 text-sm text-foreground hover:bg-hover',
            activeFileId === f.id && 'bg-accent shadow-[inset_0_0_0_1px_var(--input)]',
          )}
          style={{ paddingLeft: 8 + depth * 12 + 14 }}
          title={f.oldPath && f.oldPath !== f.path ? `${f.oldPath} → ${f.path}` : f.path}
          onClick={() => onOpen(f.id)}
          data-testid="tree-file"
        >
          <span className={cn('w-3 shrink-0 text-center font-mono text-[10px]', cls)}>{letter}</span>
          <span className={cn('min-w-0 flex-auto truncate', isViewed && 'text-muted-foreground')}>{name}</span>
          {f.structural && <span className="text-xs text-dim">structural</span>}
          {f.collapse && <span className="text-xs text-dim">{f.collapse}</span>}
          {!f.collapse && !f.structural && (
            <span className="font-mono text-[10.5px]">
              <span className="text-ok">+{f.additions}</span> <span className="text-critical">−{f.deletions}</span>
            </span>
          )}
          {isViewed && <Check className="size-3 text-muted-foreground" aria-label="Viewed" />}
        </div>,
      );
    }
    return out;
  };

  return <div className="flex flex-col gap-px">{renderDir(tree, 0)}</div>;
}
