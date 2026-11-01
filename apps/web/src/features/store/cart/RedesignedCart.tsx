import { ArrowRight, Lock, Minus, Plus, Trash, Truck } from 'lucide-react';
import { Link } from 'react-router';
import { euro } from '../../../lib/format';
import { useCart, useCartTotals } from '../CartContext';
import { ProductVisual } from '../components/ProductCard';
import { TotalsRows } from '../components/TotalsRows';
import { FREE_SHIPPING_THRESHOLD } from '../pricing';
import { useFlag } from '../StoreContext';
import { btnPrimary, cardClass } from '../ui';

/** The redesigned card-based cart with steppers, free-shipping progress and a summary sidebar. */
export function RedesignedCart() {
  const { lines, setQuantity, remove } = useCart();
  const totals = useCartTotals();
  const freeShipping = useFlag('free_shipping_banner').enabled;

  return (
    <div className="grid animate-fade-in gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      <ul className="space-y-3">
        {lines.map(({ product, quantity }) => (
          <li key={product.id} className={`${cardClass} flex gap-4 p-3 sm:p-4`}>
            <Link to={`/store/products/${product.id}`} className="shrink-0 overflow-hidden rounded-xl">
              <ProductVisual product={product} className="size-20 sm:size-24" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/store/products/${product.id}`} className="block truncate font-medium hover:underline">
                    {product.name}
                  </Link>
                  <p className="truncate text-sm text-stone-500">{product.tagline}</p>
                </div>
                <button type="button" onClick={() => remove(product.id)} aria-label={`Remove ${product.name}`} className="rounded-full p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-700">
                  <Trash className="size-4" />
                </button>
              </div>
              <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                <div className="inline-flex items-center rounded-full border border-stone-200 bg-stone-50">
                  <button type="button" onClick={() => (quantity > 1 ? setQuantity(product.id, quantity - 1) : remove(product.id))} aria-label="Decrease quantity" className="grid size-8 place-items-center text-stone-600 hover:text-stone-900">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
                  <button type="button" onClick={() => setQuantity(product.id, quantity + 1)} disabled={quantity >= 10} aria-label="Increase quantity" className="grid size-8 place-items-center text-stone-600 hover:text-stone-900 disabled:opacity-30">
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <p className="font-medium tabular-nums">{euro(product.price * quantity)}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside className={`${cardClass} p-5 lg:sticky lg:top-24`}>
        <h2 className="font-medium">Order summary</h2>
        {freeShipping && <FreeShippingProgress subtotal={totals.subtotal} />}
        <div className="mt-4">
          <TotalsRows totals={totals} />
        </div>
        <Link to="/store/checkout" className={`${btnPrimary} mt-5 w-full`}>
          Checkout <ArrowRight className="size-4" />
        </Link>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-stone-500">
          <Lock className="size-3" /> Secure checkout
        </p>
      </aside>
    </div>
  );
}

function FreeShippingProgress({ subtotal }: { subtotal: number }) {
  const remaining = FREE_SHIPPING_THRESHOLD - subtotal;
  const progress = Math.min(1, subtotal / FREE_SHIPPING_THRESHOLD);
  return (
    <div className="mt-4 rounded-xl bg-emerald-50 p-3">
      <p className="flex items-center gap-1.5 text-xs text-emerald-900">
        <Truck className="size-3.5" />
        {remaining > 0 ? (
          <>
            Add <strong className="font-semibold">{euro(remaining)}</strong> more for free shipping
          </>
        ) : (
          'You qualify for free shipping'
        )}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-100">
        <div className="h-full rounded-full bg-emerald-700 transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
