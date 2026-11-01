import { Check, Clock, MapPin, Package, PackageCheck, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dateTime } from '../../../lib/format';
import { carrierFor, deliveryProgress, etaOf, stageIndex, stageReachedAt, TRACKING_STAGES, type Order } from '../orders';
import { useFlag } from '../StoreContext';
import { cardClass } from '../ui';

/** Re-renders every few seconds so time-derived tracking status advances on screen. */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const STAGE_ICONS = [Package, Truck, MapPin, PackageCheck];

/** `order_tracking_v2`: rich milestone timeline when enabled, a single status line otherwise. */
export function OrderTracking({ order }: { order: Order }) {
  const v2 = useFlag('order_tracking_v2').enabled;
  const now = useNow();
  const stage = stageIndex(order, now);

  if (!v2) {
    return (
      <section className={`${cardClass} p-5`}>
        <p className="text-sm text-stone-600">
          Status: <span className="font-medium text-stone-900">{TRACKING_STAGES[stage].label}</span>
        </p>
      </section>
    );
  }

  const delivered = stage === TRACKING_STAGES.length - 1;
  const progress = deliveryProgress(order, now);
  return (
    <section className={`${cardClass} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{delivered ? 'Delivered' : 'Estimated delivery'}</p>
          <p className="mt-1 font-serif text-2xl text-stone-900">{dateTime(etaOf(order).toISOString())}</p>
        </div>
        <div className="text-right text-sm">
          <p className="text-stone-500">Carrier</p>
          <p className="font-medium">{carrierFor(order.address.country)}</p>
          <p className="font-mono text-xs text-stone-500">Tracking {order.id.replace('NH-', 'JJFI')}</p>
        </div>
      </div>

      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-emerald-700 transition-[width] duration-1000" style={{ width: `${Math.max(4, progress * 100)}%` }} />
      </div>

      <ol className="mt-6 space-y-0">
        {TRACKING_STAGES.map((s, i) => {
          const Icon = STAGE_ICONS[i];
          const reached = i <= stage;
          return (
            <li key={s.label} className="relative flex gap-4 pb-6 last:pb-0">
              {i < TRACKING_STAGES.length - 1 && <span className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px ${i < stage ? 'bg-emerald-700' : 'bg-stone-200'}`} />}
              <span
                className={`relative grid size-8 shrink-0 place-items-center rounded-full transition ${
                  i === stage && !delivered ? 'bg-emerald-900 text-white ring-4 ring-emerald-100' : reached ? 'bg-emerald-700 text-white' : 'bg-stone-100 text-stone-400'
                }`}
              >
                {reached && i < stage ? <Check className="size-4" /> : <Icon className="size-4" />}
              </span>
              <div className="min-w-0 pt-1">
                <p className={`text-sm font-medium ${reached ? 'text-stone-900' : 'text-stone-400'}`}>{s.label}</p>
                <p className={`text-xs ${reached ? 'text-stone-500' : 'text-stone-400'}`}>
                  {reached ? `${s.detail} · ${dateTime(stageReachedAt(order, i).toISOString())}` : (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" /> Expected {time(stageReachedAt(order, i))}
                    </span>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 border-t border-stone-100 pt-3 text-xs text-stone-400">Demo: tracking advances one milestone per minute.</p>
    </section>
  );
}
