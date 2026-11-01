import { ArrowLeft, Check, Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { euro } from '../../../lib/format';
import { useCart, useCartTotals } from '../CartContext';
import { carrierFor, newOrderId, type Order, type PaymentMethod } from '../orders';
import { useFlag, useStore } from '../StoreContext';
import { btnPrimary, btnSecondary, cardClass, headingClass } from '../ui';
import { hasErrors, initialForm, validateAddress, validateCard, type CheckoutForm, type FieldErrors } from './form';
import { OrderSummary, PaymentSection, ShippingFields } from './sections';

/** Everything both checkout variants share: form state, validation and placing the order. */
function useCheckout() {
  const { user, environment } = useStore();
  const { lines, clear, addOrder } = useCart();
  const newPaymentApi = useFlag('new_payment_api').enabled;
  const navigate = useNavigate();
  const [form, setForm] = useState<CheckoutForm>(() => initialForm(user));
  const [errors, setErrors] = useState<FieldErrors>({});
  const totals = useCartTotals(form.redeemPoints);
  // The kill switch can flip mid-checkout; without the new payment API only cards are possible.
  const payment: PaymentMethod = newPaymentApi ? form.payment : 'card';

  const check = (sections: { address?: boolean; payment?: boolean }) => {
    const next = {
      ...(sections.address ? validateAddress(form.address) : {}),
      ...(sections.payment && payment === 'card' ? validateCard(form.card) : {}),
    };
    setErrors(next);
    return next;
  };

  /** Returns the validation errors that blocked the order, or null when it was placed. */
  const placeOrder = (): FieldErrors | null => {
    const invalid = check({ address: true, payment: true });
    if (hasErrors(invalid)) return invalid;
    const order: Order = {
      id: newOrderId(),
      placedAt: new Date().toISOString(),
      userId: user.userId,
      environment,
      lines: lines.map(({ product, quantity }) => ({ productId: product.id, name: product.name, price: product.price, quantity })),
      totals,
      payment,
      cardLast4: payment === 'card' ? form.card.number.replace(/\s/g, '').slice(-4) : null,
      address: { ...form.address },
    };
    addOrder(order);
    clear();
    navigate(`/store/orders/${order.id}?placed=1`);
    return null;
  };

  return { form, setForm, errors, totals, payment, check, placeOrder, isEmpty: lines.length === 0 };
}

type Checkout = ReturnType<typeof useCheckout>;

/** `new_checkout`: `single_page` puts everything on one page; `multi_step` (default variant) is the stepped checkout. */
export function CheckoutPage() {
  const checkout = useCheckout();
  const { variant } = useFlag('new_checkout');

  if (checkout.isEmpty) {
    return (
      <div className="py-16 text-center">
        <h1 className={`${headingClass} text-3xl`}>Nothing to check out</h1>
        <p className="mt-2 text-sm text-stone-500">Your cart is empty.</p>
        <Link to="/store/products" className={`${btnPrimary} mt-6`}>
          Browse the collection
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link to="/store/cart" className="mb-6 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900">
        <ArrowLeft className="size-4" /> Back to cart
      </Link>
      <h1 className={`${headingClass} mb-8 text-3xl sm:text-4xl`}>Checkout</h1>
      {variant === 'single_page' ? <SinglePageCheckout checkout={checkout} /> : <MultiStepCheckout checkout={checkout} />}
    </>
  );
}

function Panel({ title, step, children }: { title: string; step?: number; children: ReactNode }) {
  return (
    <section className={`${cardClass} p-5 sm:p-6`}>
      <h2 className="mb-5 flex items-center gap-2.5 font-medium">
        {step !== undefined && <span className="grid size-6 place-items-center rounded-full bg-stone-900 text-xs text-white">{step}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Summary({ checkout, footer }: { checkout: Checkout; footer?: ReactNode }) {
  const { form, setForm, totals } = checkout;
  return <OrderSummary totals={totals} redeemPoints={form.redeemPoints} onRedeemChange={(redeemPoints) => setForm({ ...form, redeemPoints })} footer={footer} />;
}

function Payment({ checkout }: { checkout: Checkout }) {
  const { form, setForm, errors, payment } = checkout;
  return (
    <PaymentSection
      payment={payment}
      card={form.card}
      errors={errors}
      onPaymentChange={(p) => setForm({ ...form, payment: p })}
      onCardChange={(card) => setForm({ ...form, card })}
    />
  );
}

function PlaceOrderButton({ checkout, onInvalid }: { checkout: Checkout; onInvalid?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        const errors = checkout.placeOrder();
        if (errors) onInvalid?.();
      }}
      className={`${btnPrimary} w-full`}>
      <Lock className="size-4" /> {checkout.payment === 'flagship_pay' ? 'Pay instantly (demo)' : 'Place demo order'} · {euro(checkout.totals.total)}
    </button>
  );
}

function SinglePageCheckout({ checkout }: { checkout: Checkout }) {
  const { form, setForm, errors } = checkout;
  return (
    <div className="grid animate-fade-in gap-6 lg:grid-cols-[1fr_24rem] lg:items-start">
      <div className="space-y-6">
        <Panel title="Contact & shipping">
          <ShippingFields address={form.address} errors={errors} onChange={(address) => setForm({ ...form, address })} />
        </Panel>
        <Panel title="Payment">
          <Payment checkout={checkout} />
        </Panel>
      </div>
      <div className="lg:sticky lg:top-24">
        <Summary checkout={checkout} footer={<PlaceOrderButton checkout={checkout} />} />
      </div>
    </div>
  );
}

const STEPS = ['Shipping', 'Payment', 'Review'] as const;

function MultiStepCheckout({ checkout }: { checkout: Checkout }) {
  const { form, setForm, errors, check, payment } = checkout;
  const [step, setStep] = useState(0);
  const next = () => {
    if (!hasErrors(check(step === 0 ? { address: true } : { payment: true }))) setStep(step + 1);
  };
  // e.g. the payment kill switch flipped while reviewing: send the customer back to the step that needs input.
  const showInvalidStep = () => setStep(hasErrors(validateAddress(form.address)) ? 0 : 1);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div>
        <ol className="mb-6 flex items-center gap-2 text-sm">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                disabled={i > step}
                onClick={() => setStep(i)}
                className={`flex items-center gap-2 ${i === step ? 'font-medium text-stone-900' : i < step ? 'text-emerald-900' : 'text-stone-400'}`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs transition ${
                    i < step ? 'border-emerald-900 bg-emerald-900 text-white' : i === step ? 'border-stone-900 text-stone-900' : 'border-stone-300'
                  }`}
                >
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < step ? 'bg-emerald-900' : 'bg-stone-300'}`} />}
            </li>
          ))}
        </ol>

        <div key={step} className="animate-slide-up">
          {step === 0 && (
            <Panel title="Shipping details" step={1}>
              <ShippingFields address={form.address} errors={errors} onChange={(address) => setForm({ ...form, address })} />
            </Panel>
          )}
          {step === 1 && (
            <Panel title="Payment method" step={2}>
              <Payment checkout={checkout} />
            </Panel>
          )}
          {step === 2 && (
            <Panel title="Review your order" step={3}>
              <dl className="grid gap-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">Ship to</dt>
                  <dd className="mt-1 text-stone-800">
                    {form.address.name}
                    <br />
                    {form.address.street}
                    <br />
                    {form.address.postcode} {form.address.city}, {form.address.country}
                    <br />
                    <span className="text-stone-500">via {carrierFor(form.address.country)}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">Payment</dt>
                  <dd className="mt-1 text-stone-800">
                    {payment === 'flagship_pay' ? 'Flagship Pay (instant)' : `Card ending ${form.card.number.replace(/\s/g, '').slice(-4)}`}
                  </dd>
                </div>
              </dl>
            </Panel>
          )}
        </div>

        <div className="mt-6 flex justify-between gap-3">
          {step > 0 ? (
            <button type="button" onClick={() => setStep(step - 1)} className={btnSecondary}>
              Back
            </button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={next} className={btnPrimary}>
              Continue to {STEPS[step + 1].toLowerCase()}
            </button>
          ) : (
            <div className="w-full max-w-xs">
              <PlaceOrderButton checkout={checkout} onInvalid={showInvalidStep} />
            </div>
          )}
        </div>
      </div>
      <Summary checkout={checkout} />
    </div>
  );
}
