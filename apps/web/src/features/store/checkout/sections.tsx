import { Award, CreditCard, TriangleAlert, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { euro } from '../../../lib/format';
import { useCart } from '../CartContext';
import { ProductVisual } from '../components/ProductCard';
import { TotalsRows } from '../components/TotalsRows';
import type { PaymentMethod, ShippingAddress } from '../orders';
import { POINTS_PER_BLOCK, EUROS_PER_BLOCK, maxRedemption, type Totals } from '../pricing';
import { useFlag, useStore } from '../StoreContext';
import { cardClass, inputClass } from '../ui';
import { SHIPPING_COUNTRIES, type CardDetails, type FieldErrors } from './form';

const regionName = new Intl.DisplayNames(['en'], { type: 'region' });

function Field({ label, error, className = '', children }: { label: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

const fieldClass = (error?: string) => `${inputClass} ${error ? 'border-red-400' : ''}`;

export function ShippingFields({ address, errors, onChange }: { address: ShippingAddress; errors: FieldErrors; onChange: (a: ShippingAddress) => void }) {
  const set = (key: keyof ShippingAddress) => (e: { target: { value: string } }) => onChange({ ...address, [key]: e.target.value });
  const countries = SHIPPING_COUNTRIES.includes(address.country) ? SHIPPING_COUNTRIES : [address.country, ...SHIPPING_COUNTRIES];
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label="Full name" error={errors.name} className="sm:col-span-3">
        <input value={address.name} onChange={set('name')} autoComplete="name" className={fieldClass(errors.name)} />
      </Field>
      <Field label="Email" error={errors.email} className="sm:col-span-3">
        <input type="email" value={address.email} onChange={set('email')} autoComplete="email" className={fieldClass(errors.email)} />
      </Field>
      <Field label="Street address" error={errors.street} className="sm:col-span-6">
        <input value={address.street} onChange={set('street')} autoComplete="street-address" placeholder="Hämeenkatu 12 B 4" className={fieldClass(errors.street)} />
      </Field>
      <Field label="Postcode" error={errors.postcode} className="sm:col-span-2">
        <input value={address.postcode} onChange={set('postcode')} autoComplete="postal-code" className={fieldClass(errors.postcode)} />
      </Field>
      <Field label="City" error={errors.city} className="sm:col-span-2">
        <input value={address.city} onChange={set('city')} autoComplete="address-level2" className={fieldClass(errors.city)} />
      </Field>
      <Field label="Country" className="sm:col-span-2">
        <select value={address.country} onChange={set('country')} className={inputClass}>
          {countries.map((c) => (
            <option key={c} value={c}>
              {regionName.of(c) ?? c}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function CardFields({ card, errors, onChange }: { card: CardDetails; errors: FieldErrors; onChange: (c: CardDetails) => void }) {
  const set = (key: keyof CardDetails) => (e: { target: { value: string } }) => onChange({ ...card, [key]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <p className="text-xs text-stone-500 sm:col-span-4">
        Demo only — nothing is charged. Don't enter real card details; any test number such as 4242 4242 4242 4242 works.
      </p>
      <Field label="Name on card" error={errors.holder} className="sm:col-span-4">
        <input value={card.holder} onChange={set('holder')} autoComplete="off" className={fieldClass(errors.holder)} />
      </Field>
      <Field label="Card number" error={errors.number} className="sm:col-span-2">
        <input value={card.number} onChange={set('number')} inputMode="numeric" autoComplete="off" placeholder="4242 4242 4242 4242" className={fieldClass(errors.number)} />
      </Field>
      <Field label="Expiry" error={errors.expiry}>
        <input value={card.expiry} onChange={set('expiry')} autoComplete="off" placeholder="MM/YY" className={fieldClass(errors.expiry)} />
      </Field>
      <Field label="CVC" error={errors.cvc}>
        <input value={card.cvc} onChange={set('cvc')} inputMode="numeric" autoComplete="off" placeholder="123" className={fieldClass(errors.cvc)} />
      </Field>
    </div>
  );
}

interface PaymentSectionProps {
  payment: PaymentMethod;
  card: CardDetails;
  errors: FieldErrors;
  onPaymentChange: (p: PaymentMethod) => void;
  onCardChange: (c: CardDetails) => void;
}

/** `new_payment_api` kill switch: Flagship Pay + cards when on, legacy card form with a fallback notice when off. */
export function PaymentSection({ payment, card, errors, onPaymentChange, onCardChange }: PaymentSectionProps) {
  const newPaymentApi = useFlag('new_payment_api').enabled;
  const { user } = useStore();

  if (!newPaymentApi) {
    return (
      <div className="space-y-4">
        <div role="status" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-medium">Express payments are temporarily unavailable</span> — using standard card processing.
          </p>
        </div>
        <CardFields card={card} errors={errors} onChange={onCardChange} />
      </div>
    );
  }

  const option = (method: PaymentMethod, icon: ReactNode, title: ReactNode, detail: string) => (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
        payment === method ? 'border-emerald-800 bg-emerald-50/60 ring-1 ring-emerald-800' : 'border-stone-200 bg-white hover:border-stone-300'
      }`}
    >
      <input type="radio" name="payment" checked={payment === method} onChange={() => onPaymentChange(method)} className="mt-1 accent-emerald-800" />
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-stone-100 text-stone-700">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-stone-900">{title}</span>
        <span className="block text-xs text-stone-500">{detail}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-3">
      {option(
        'flagship_pay',
        <Zap className="size-4 text-emerald-800" />,
        <>
          Flagship Pay <span className="ml-1 rounded-full bg-emerald-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Instant</span>
        </>,
        `Simulated one-click payment for ${user.email}. No card details needed.`,
      )}
      {option('card', <CreditCard className="size-4" />, 'Credit or debit card', 'Visa, Mastercard, American Express')}
      {payment === 'card' && (
        <div className="animate-fade-in pt-2">
          <CardFields card={card} errors={errors} onChange={onCardChange} />
        </div>
      )}
    </div>
  );
}

/** `loyalty_rewards`: redeem points for a discount. Renders nothing when the flag is off. */
function RedeemPoints({ subtotal, checked, onChange }: { subtotal: number; checked: boolean; onChange: (v: boolean) => void }) {
  const rewards = useFlag('loyalty_rewards').enabled;
  const { user } = useStore();
  if (!rewards) return null;
  const max = maxRedemption(user.loyaltyPoints, subtotal);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      {max.points > 0 ? (
        <label className="flex cursor-pointer items-start gap-2.5">
          <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-amber-700" />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              <Award className="size-4" /> Redeem {max.points.toLocaleString('en')} points for −{euro(max.discount)}
            </span>
            <span className="text-xs text-amber-800">
              You have {user.loyaltyPoints.toLocaleString('en')} pts · {POINTS_PER_BLOCK} pts = {euro(EUROS_PER_BLOCK)}, up to 20% of your order
            </span>
          </span>
        </label>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-amber-800">
          <Award className="size-4" /> Rewards start at {POINTS_PER_BLOCK} points and cover up to 20% of your order.
        </p>
      )}
    </div>
  );
}

export function OrderSummary({ totals, redeemPoints, onRedeemChange, footer }: { totals: Totals; redeemPoints: boolean; onRedeemChange: (v: boolean) => void; footer?: ReactNode }) {
  const { lines } = useCart();
  return (
    <aside className={`${cardClass} space-y-5 p-5`}>
      <h2 className="font-medium">Order summary</h2>
      <ul className="space-y-3">
        {lines.map(({ product, quantity }) => (
          <li key={product.id} className="flex items-center gap-3 text-sm">
            <div className="relative shrink-0">
              <ProductVisual product={product} size="sm" className="size-12 rounded-lg" />
              <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-stone-700 text-[10px] font-semibold text-white">{quantity}</span>
            </div>
            <span className="min-w-0 flex-1 truncate">{product.name}</span>
            <span className="tabular-nums">{euro(product.price * quantity)}</span>
          </li>
        ))}
      </ul>
      <RedeemPoints subtotal={totals.subtotal} checked={redeemPoints} onChange={onRedeemChange} />
      <TotalsRows totals={totals} />
      {footer}
    </aside>
  );
}
