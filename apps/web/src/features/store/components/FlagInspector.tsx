import { ENVIRONMENT_LABELS } from '@flagship/shared';
import { Flag, X } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../StoreContext';

/** Demo aid: shows how every flag evaluated for the current customer. The store itself reacts to these values. */
export function FlagInspector() {
  const [open, setOpen] = useState(false);
  const { evaluations, user, environment } = useStore();
  const results = evaluations ? [...evaluations.values()] : [];

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] animate-slide-up flex-col overflow-hidden rounded-xl border border-stone-700 bg-stone-900 text-stone-200 shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-stone-800 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-stone-100">Flag inspector</p>
              <p className="text-xs text-stone-400">
                {user.name} · {ENVIRONMENT_LABELS[environment]}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close flag inspector" className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100">
              <X className="size-4" />
            </button>
          </div>
          <ul className="divide-y divide-stone-800 overflow-y-auto">
            {results.map((r) => (
              <li key={r.flagKey} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate font-mono text-xs text-stone-100">{r.flagKey}</code>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {r.variant && <code className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] text-stone-300">{r.variant}</code>}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.enabled ? 'bg-emerald-400/15 text-emerald-300' : 'bg-stone-700/60 text-stone-400'}`}
                    >
                      {r.enabled ? 'ON' : 'OFF'}
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-stone-400">
                  <span className="font-mono text-stone-500">{r.reason}</span> · {r.explanation}
                </p>
              </li>
            ))}
            {results.length === 0 && <li className="px-4 py-6 text-center text-xs text-stone-400">No evaluations available.</li>}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-stone-700 bg-stone-900 px-4 py-2 text-xs font-medium text-stone-100 shadow-lg transition hover:bg-stone-800"
      >
        <Flag className="size-3.5 text-emerald-400" />
        Flags
        <span className="rounded-full bg-stone-700 px-1.5 text-[10px] text-stone-300">
          {results.filter((r) => r.enabled).length}/{results.length}
        </span>
      </button>
    </div>
  );
}
