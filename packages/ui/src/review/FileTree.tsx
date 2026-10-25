import type { FileChange } from '@legible/domain';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

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
  added: ['A', 'add-t'],
  deleted: ['D', 'del-t'],
  modified: ['M', 'muted'],
  renamed: ['R', 'muted'],
  copied: ['C', 'muted'],
  typechange: ['T', 'muted'],
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
        <div
          key={`d:${child.path}`}
          className="tree-row dir"
          style={{ paddingLeft: 8 + depth * 12, cursor: 'pointer' }}
          onClick={() =>
            setClosed((s) => {
              const n = new Set(s);
              if (n.has(child.path)) n.delete(child.path);
              else n.add(child.path);
              return n;
            })
          }
        >
          {isClosed ? <ChevronRight className="i i-xs" /> : <ChevronDown className="i i-xs" />}
          <span className="truncate">{child.name}</span>
        </div>,
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
          className={`tree-row${activeFileId === f.id ? ' active' : ''}${isViewed ? ' viewed' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 + 14 }}
          title={f.oldPath && f.oldPath !== f.path ? `${f.oldPath} → ${f.path}` : f.path}
          onClick={() => onOpen(f.id)}
          data-testid="tree-file"
        >
          <span className={`status-letter ${cls}`}>{letter}</span>
          <span className="name truncate grow">{name}</span>
          {f.structural && <span className="xs dim">structural</span>}
          {f.collapse && <span className="xs dim">{f.collapse}</span>}
          {!f.collapse && !f.structural && (
            <span className="stat">
              <span className="add-t">+{f.additions}</span> <span className="del-t">−{f.deletions}</span>
            </span>
          )}
          {isViewed && <Check className="i i-xs muted" aria-label="Viewed" />}
        </div>,
      );
    }
    return out;
  };

  return (
    <div className="col" style={{ gap: 1 }}>
      {renderDir(tree, 0)}
    </div>
  );
}
