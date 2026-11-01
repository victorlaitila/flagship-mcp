import { Award } from 'lucide-react';
import { euro } from '../../../lib/format';
import type { Totals } from '../pricing';

export function TotalsRows({ totals }: { totals: Totals }) {
  return (
    <dl className="space-y-2 text-sm">
      <Row label="Subtotal" value={euro(totals.subtotal)} />
      {totals.discount > 0 && (
        <Row label={`Points redeemed (${totals.pointsRedeemed.toLocaleString('en')} pts)`} value={`−${euro(totals.discount)}`} className="text-emerald-800" />
      )}
      <Row label="Shipping" value={totals.shipping === 0 ? 'Free' : euro(totals.shipping)} />
      <div className="flex items-baseline justify-between border-t border-stone-200 pt-3 text-base font-medium text-stone-900">
        <dt>Total</dt>
        <dd className="tabular-nums">{euro(totals.total)}</dd>
      </div>
      {totals.pointsEarned > 0 && (
        <p className="flex items-center gap-1.5 pt-1 text-xs text-amber-900">
          <Award className="size-3.5" /> You'll earn {totals.pointsEarned.toLocaleString('en')} points with this order
        </p>
      )}
    </dl>
  );
}

function Row({ label, value, className = 'text-stone-600' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${className}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
