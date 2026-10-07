import { useEffect } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { useApp, type Toast } from '../state/store';

const ICON = { info: Info, success: CircleCheck, warn: TriangleAlert, error: CircleX };

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useApp((s) => s.dismissToast);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.ttl);
    return () => clearTimeout(timer);
  }, [t.id, t.ttl, dismiss]);
  const I = ICON[t.level];
  return (
    <div className={`toast toast--${t.level}`} role={t.level === 'error' ? 'alert' : 'status'}>
      <I size={17} className="toast__icon" aria-hidden />
      <div className="toast__body">
        <p className="toast__title">{t.title}</p>
        {t.detail && <p className="toast__detail">{t.detail}</p>}
        {t.action && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              t.action?.run();
              dismiss(t.id);
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
