import { ENVIRONMENT_LABELS } from '@flagship/shared';
import { Flag, X } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../StoreContext';

/** Demo aid: shows how every flag evaluated for the current customer. The store itself reacts to these values. */
export function FlagInspector() {
  const [open, setOpen] = useState(false);
  const { evaluations, user, environment } = useStore();
  const results = evaluations ? [...evaluations.values()] : [];
  const active = results.filter((r) => r.reason !== 'FLAG_ARCHIVED');

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 font-sans">
      {open && (
        <div className="flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] animate-slide-up flex-col overflow-hidden rounded-xl border border-line-strong bg-surface text-fg shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <p className="text-sm font-medium text-fg">Flag inspector</p>
              <p className="text-xs text-muted">
                {user.name} · {ENVIRONMENT_LABELS[environment]}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close flag inspector" className="rounded p-1 text-muted hover:bg-raised hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
          <ul className="divide-y divide-line overflow-y-auto">
            {results.map((r) => (
              <li key={r.flagKey} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate font-mono text-xs text-fg">{r.flagKey}</code>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {r.variant && <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">{r.variant}</code>}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.enabled ? 'bg-on/15 text-on' : 'bg-raised text-muted'}`}
                    >
                      {r.enabled ? 'ON' : 'OFF'}
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  <span className="font-mono text-faint">{r.reason}</span> · {r.explanation}
                </p>
              </li>
            ))}
            {results.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted">No evaluations available.</li>}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-fg shadow-lg transition hover:bg-raised"
      >
        <Flag className="size-3.5 text-on" />
        Flags
        <span className="rounded-full bg-line-strong px-1.5 text-[10px] text-muted">
          {active.filter((r) => r.enabled).length}/{active.length}
        </span>
      </button>
    </div>
  );
}
