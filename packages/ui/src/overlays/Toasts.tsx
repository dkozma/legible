import { AlertTriangle, Info, X } from 'lucide-react';

import { Button, cn } from '../components/ui';
import { useUI } from '../state';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="fixed right-4 bottom-4 z-[60] flex max-w-[420px] flex-col gap-2" aria-live="assertive" data-testid="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'flex items-start gap-2.5 rounded-lg border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-popover select-text',
            t.kind === 'error' && 'border-critical-border',
          )}
        >
          {t.kind === 'error' ? (
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-critical" />
          ) : (
            <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="grow">{t.message}</span>
          <Button variant="muted" size="icon-xs" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}
