/** Small, accessible UI primitives shared by every panel. */

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, children, className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} btn--${size} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} aria-hidden /> : null}
      {children !== undefined && <span>{children}</span>}
      {IconRight && <IconRight size={size === 'sm' ? 14 : 16} aria-hidden />}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tipSide?: 'top' | 'bottom' | 'left' | 'right';
  tone?: 'default' | 'danger';
}

export function IconButton({ icon: Icon, label, shortcut, active, size = 'md', tipSide = 'bottom', tone = 'default', className = '', ...rest }: IconButtonProps) {
  const px = size === 'sm' ? 15 : size === 'lg' ? 20 : 17;
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--${size} ${active ? 'is-active' : ''} ${tone === 'danger' ? 'icon-btn--danger' : ''} ${className}`}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-tip={shortcut ? `${label} · ${shortcut}` : label}
      data-tip-side={tipSide}
      {...rest}
    >
      <Icon size={px} aria-hidden />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

interface DialogProps {
  title: string;
  icon?: LucideIcon;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** element id or selector to focus on open; defaults to the first field */
  initialFocus?: string;
}

export function Dialog({ title, icon: Icon, onClose, children, footer, width = 440, initialFocus }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const target =
      (initialFocus && root?.querySelector<HTMLElement>(initialFocus)) ||
      root?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea') ||
      root?.querySelector<HTMLElement>('button');
    target?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && root) {
        // keep focus inside the dialog
        const f = [...root.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (el) => !el.hasAttribute('disabled'),
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    root?.addEventListener('keydown', onKey);
    return () => {
      root?.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [initialFocus]);

  return (
    <div className="dialog-layer" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width }}>
        <header className="dialog__head">
          {Icon && <Icon size={18} aria-hidden className="dialog__icon" />}
          <h2 id={titleId}>{title}</h2>
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} tipSide="left" />
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor, error }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; error?: string | null }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="field__error">{error}</p> : hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`segmented segmented--${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <o.icon size={14} aria-hidden />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <label className="switch" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden>
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{label}</span>
    </label>
  );
}

/** Progress meter: the fill carries state, the track is a darker step of the same hue. */
export function Meter({ value, tone = 'accent', label }: { value: number | null; tone?: 'accent' | 'good' | 'critical'; label: string }) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={`meter meter--${tone} ${pct === null ? 'is-indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
    >
      <div className="meter__fill" style={pct === null ? undefined : { width: `${pct}%` }} />
    </div>
  );
}

export type StatusTone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'accent';

/** Status always pairs a coloured icon with a text label — never colour alone. */
export function StatusPill({ tone, icon: Icon, children, title }: { tone: StatusTone; icon: LucideIcon; children: ReactNode; title?: string }) {
  return (
    <span className={`pill pill--${tone}`} title={title}>
      <Icon size={13} aria-hidden className="pill__icon" />
      <span className="pill__text">{children}</span>
    </span>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={22} aria-hidden className="empty__icon" />
      <p className="empty__title">{title}</p>
      {children && <div className="empty__body">{children}</div>}
    </div>
  );
}
