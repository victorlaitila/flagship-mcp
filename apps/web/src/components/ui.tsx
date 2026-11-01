import type { Environment } from '@flagship/shared';
import { ENVIRONMENT_LABELS } from '@flagship/shared';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-[#0b0e1a] hover:bg-accent-strong font-semibold',
  secondary: 'bg-raised text-fg border border-line-strong hover:border-faint',
  ghost: 'text-muted hover:text-fg hover:bg-raised',
  danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
};

export function Button({
  variant = 'secondary', size = 'md', loading, className, children, disabled, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8.5 px-3.5 text-sm',
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {loading && <LoaderCircle className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

const fieldClass =
  'h-8.5 w-full rounded-md border border-line-strong bg-canvas px-2.5 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent focus:outline-none disabled:opacity-60';

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={cx(fieldClass, className)} />
);

export const Select = ({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={cx(fieldClass, 'pr-7', className)}>
    {children}
  </select>
);

export function Field({ label, hint, children, error }: { label: string; hint?: string; children: ReactNode; error?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="block text-xs text-danger">{error}</span> : hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-on/50 bg-on/80' : 'border-line-strong bg-raised',
      )}
    >
      <span className={cx('size-3.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  );
}

export function Panel({ title, actions, children, className, bodyClassName }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
          {actions}
        </header>
      )}
      <div className={bodyClassName ?? 'p-4'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

const ENV_DOT: Record<Environment, string> = { development: 'bg-dev', staging: 'bg-staging', production: 'bg-prod' };
const ENV_TEXT: Record<Environment, string> = { development: 'text-dev', staging: 'text-staging', production: 'text-prod' };
export const envTextClass = (env: Environment) => ENV_TEXT[env];
export const ENV_SHORT_LABELS: Record<Environment, string> = { development: 'Dev', staging: 'Stag', production: 'Prod' };

export const EnvLabel = ({ env, short }: { env: Environment; short?: boolean }) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
    <span className={cx('size-1.5 rounded-full', ENV_DOT[env])} />
    {short ? ENV_SHORT_LABELS[env] : ENVIRONMENT_LABELS[env]}
  </span>
);

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'on' | 'danger' | 'warn'; className?: string }) {
  const tones = {
    neutral: 'border-line-strong text-muted',
    accent: 'border-accent/30 text-accent bg-accent/10',
    on: 'border-on/30 text-on bg-on/10',
    danger: 'border-danger/30 text-danger bg-danger/10',
    warn: 'border-staging/30 text-staging bg-staging/10',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium', tones[tone], className)}>{children}</span>;
}

/** Compact on/off pill used in tables. */
export const StatusPill = ({ on, label }: { on: boolean; label?: string }) => (
  <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium', on ? 'text-on' : 'text-faint')}>
    <span className={cx('size-1.5 rounded-full', on ? 'bg-on shadow-[0_0_6px] shadow-on/60' : 'bg-faint')} />
    {label ?? (on ? 'On' : 'Off')}
  </span>
);

export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <code className={cx('font-mono text-[12px] text-muted', className)}>{children}</code>
);

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted animate-fade-in">
      <LoaderCircle className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-6 py-10 text-center animate-fade-in">
      <CircleAlert className="size-5 text-danger" />
      <p className="text-sm text-fg">{error.message}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export const EmptyState = ({ title, description }: { title: string; description?: string }) => (
  <div className="px-6 py-12 text-center">
    <p className="text-sm font-medium text-fg">{title}</p>
    {description && <p className="mt-1 text-sm text-muted">{description}</p>}
  </div>
);

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-[2px] animate-fade-in sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cx('flex max-h-[90vh] w-full flex-col rounded-lg border border-line-strong bg-surface shadow-2xl animate-slide-up', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-raised hover:text-fg" aria-label="Close"><X className="size-4" /></button>
        </header>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Banner({ tone, children }: { tone: 'danger' | 'warn' | 'info'; children: ReactNode }) {
  const tones = {
    danger: 'border-danger/30 bg-danger/5 text-danger',
    warn: 'border-staging/30 bg-staging/5 text-staging',
    info: 'border-accent/30 bg-accent/5 text-accent',
  };
  return <div className={cx('rounded-md border px-3 py-2 text-sm', tones[tone])}>{children}</div>;
}
