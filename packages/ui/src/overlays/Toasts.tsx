import { AlertTriangle, Info, X } from 'lucide-react';
import { useUI } from '../state';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} className={`popover toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.kind === 'error' ? (
            <AlertTriangle className="i i-sm" style={{ color: 'var(--risk-critical)', marginTop: 1 }} />
          ) : (
            <Info className="i i-sm muted" style={{ marginTop: 1 }} />
          )}
          <span className="grow">{t.message}</span>
          <button className="btn btn-ghost btn-icon btn-xs muted" type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X className="i i-xs" />
          </button>
        </div>
      ))}
    </div>
  );
}
