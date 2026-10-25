import type { Explanation, ExplanationJob } from '@legible/domain';
import { AlertTriangle, BookOpen, Loader2, RefreshCw, X } from 'lucide-react';
import { formatKey } from '../commands';
import { Inline, Kbd, usd } from '../components/Inline';

const MODEL_NAMES: Record<string, string> = {
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-opus-5-5': 'Claude Opus 5.5',
};

interface Props {
  job: ExplanationJob | null;
  explanation: Explanation | null;
  history: Explanation[];
  onShow(e: Explanation): void;
  onJump(e: Explanation): void;
  onRetry(force: boolean): void;
  onCancel(): void;
}

export function ExplainPanel({ job, explanation, history, onShow, onJump, onRetry, onCancel }: Props) {
  const running = job && (job.status === 'queued' || job.status === 'running');
  const shown = explanation ?? (job?.status === 'done' ? job.explanation : null);
  return (
    <div className="col" style={{ flex: '1 1 auto', minHeight: 0 }}>
      <div className="ltabs" role="tablist">
        <button className="ltab" role="tab" type="button" aria-selected="true">
          <BookOpen className="i i-sm" />
          Explain
        </button>
      </div>
      <div className="scroll" style={{ flex: '1 1 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {running && job && (
          <div className="col" style={{ gap: 12 }} aria-live="polite" data-testid="explain-running">
            <div className="row">
              <span className="eyebrow grow">Explaining</span>
              <button className="btn btn-ghost btn-xs muted" type="button" onClick={onCancel}>
                <X className="i i-xs" />
                Cancel
              </button>
            </div>
            <div className="mono sm truncate" title={job.label}>
              {job.label}
            </div>
            <div className="row xs muted">
              <Loader2 className="i i-xs spin" />
              {job.progress ?? 'Working'}
            </div>
            <div className="col" style={{ gap: 8 }}>
              <div className="skeleton" style={{ width: '40%' }} />
              <div className="skeleton" />
              <div className="skeleton" style={{ width: '85%' }} />
              <div className="skeleton" style={{ width: '60%' }} />
            </div>
          </div>
        )}
        {!running && job?.status === 'error' && (
          <div className="crit-box col" style={{ padding: '10px 12px', gap: 8 }} role="alert">
            <div className="row xs b" style={{ color: 'var(--risk-critical)' }}>
              <AlertTriangle className="i i-sm" />
              Couldn't explain {job.label}
            </div>
            <p className="sm ex-text">{job.error}</p>
            <div className="row">
              <button className="btn btn-outline btn-xs" type="button" onClick={() => onRetry(true)}>
                Try again
              </button>
            </div>
          </div>
        )}
        {!running && shown && <ExplanationCard e={shown} onJump={() => onJump(shown)} onRefresh={() => onRetry(true)} />}
        {!running && !shown && job?.status !== 'error' && <EmptyExplain />}

        {history.length > 0 && (
          <div className="col" style={{ gap: 4, marginTop: 8 }}>
            <div className="eyebrow" style={{ padding: '0 4px 4px' }}>
              Earlier in this Review
            </div>
            {history.map((h) => (
              <div key={h.id} className={`li${shown?.id === h.id ? ' active' : ''}`} onClick={() => onShow(h)}>
                <BookOpen className="i i-xs muted" />
                <span className="mono xs truncate grow" title={h.label}>
                  {h.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyExplain() {
  return (
    <div className="col" style={{ gap: 10 }}>
      <span className="eyebrow">Explanation</span>
      <p className="sm muted">
        Select lines by clicking or dragging their line numbers, then press <Kbd keys={['e']} />. Without a selection, <Kbd keys={['e']} />{' '}
        explains the current hunk and <Kbd keys={formatKey('shift+e')} /> the current file.
      </p>
      <p className="xs dim">
        Each Explanation says what the code did before, what it does now, and what changed, with up to two things to watch out for.
      </p>
    </div>
  );
}

function ExplanationCard({ e, onJump, onRefresh }: { e: Explanation; onJump(): void; onRefresh(): void }) {
  const b = e.body;
  return (
    <article className="col" style={{ gap: 12 }} data-testid="explanation">
      <header className="col" style={{ gap: 4 }}>
        <div className="row">
          <span className="eyebrow grow">Explanation</span>
          <span className="xs muted">
            Fast tier · {MODEL_NAMES[e.model] ?? e.model}
            {e.cached ? ' · cached' : ''}
          </span>
        </div>
        <button
          className="btn-link mono sm"
          style={{ textAlign: 'left', textDecoration: 'none', border: 0, cursor: 'pointer' }}
          type="button"
          onClick={onJump}
          title="Go to these lines"
        >
          {e.label}
        </button>
      </header>
      <div className="ex-section ex-text">
        <div className="xs b muted">Before</div>
        {b.before ? (
          <p className="sm">
            <Inline text={b.before} />
          </p>
        ) : (
          <p className="sm muted" style={{ fontStyle: 'italic' }}>
            Omitted. This code is new.
          </p>
        )}
        <div className="xs b muted">After</div>
        <p className="sm">
          <Inline text={b.after} />
        </p>
        {b.whatChanged.length > 0 && (
          <>
            <div className="xs b muted">What changed</div>
            <ul className="col sm" style={{ gap: 6 }}>
              {b.whatChanged.map((w, i) => (
                <li key={i} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <span
                    className={`g ${w.kind === 'connection' ? 'g-conn' : w.kind === 'intent' ? 'g-intent' : 'g-req'}`}
                    style={{ marginTop: 6 }}
                    title={w.kind}
                  />
                  <span>
                    <Inline text={w.text} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {b.watchOut.length > 0 && (
        <div className="elev-box col" style={{ padding: '10px 12px', gap: 6 }}>
          <div className="xs b row" style={{ gap: 6, color: 'var(--risk-elevated)' }}>
            <AlertTriangle className="i i-sm" />
            Watch out
          </div>
          <ol className="col sm ex-text" style={{ gap: 8 }}>
            {b.watchOut.map((w, i) => (
              <li key={i} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                <span className="mono xs" style={{ color: 'var(--risk-elevated)', marginTop: 1 }}>
                  {i + 1}
                </span>
                <span>
                  <Inline text={w} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <footer className="row xs muted">
        <button className="btn btn-ghost btn-xs muted" type="button" onClick={onRefresh} title="Ask again, ignoring the cache">
          <RefreshCw className="i i-xs" />
          Re-explain
        </button>
        <span className="grow" />
        {!e.cached && e.durationMs !== null && <span>{(e.durationMs / 1000).toFixed(1)}s</span>}
        {!e.cached && <span>{usd(e.costUsd)}</span>}
        {e.cached && <span>Cached for this Head</span>}
      </footer>
    </article>
  );
}
