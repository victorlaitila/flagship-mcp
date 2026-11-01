import { ArrowLeft, CircleCheck, CreditCard, Zap } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { euro } from '../../../lib/format';
import { useCart } from '../CartContext';
import { findProduct } from '../catalog';
import { OrderTracking } from '../components/OrderTracking';
import { ProductVisual } from '../components/ProductCard';
import { TotalsRows } from '../components/TotalsRows';
import { cardClass, headingClass } from '../ui';

/** Order confirmation (after checkout, `?placed=1`) and order tracking. */
export function OrderPage() {
  const { orderId } = useParams();
  const [params] = useSearchParams();
  const order = useCart().orders.find((o) => o.id === orderId);

  if (!order) {
    return (
      <div className="py-16 text-center">
        <h1 className={`${headingClass} text-3xl`}>Order not found</h1>
        <Link to="/store/orders" className="mt-4 inline-block text-sm text-emerald-900 hover:underline">
          View all orders
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link to="/store/orders" className="mb-6 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900">
        <ArrowLeft className="size-4" /> All orders
      </Link>

      {params.get('placed') && (
        <div className="mb-8 flex animate-slide-up gap-4 rounded-2xl bg-emerald-900 p-5 text-emerald-50 sm:p-6">
          <CircleCheck className="size-7 shrink-0 text-emerald-300" strokeWidth={1.5} />
          <div>
            <h1 className="font-serif text-2xl text-white sm:text-3xl">Thank you, {order.address.name.split(' ')[0]}!</h1>
            <p className="mt-1 text-sm text-emerald-100">
              Demo order {order.id} is confirmed. Nothing was charged and no email was sent.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">Order {order.id}</p>
            <h2 className={`${headingClass} text-2xl`}>Tracking</h2>
          </div>
          <OrderTracking order={order} />
          <section className={`${cardClass} grid gap-5 p-5 text-sm sm:grid-cols-2`}>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Shipping to</p>
              <p className="mt-1 text-stone-800">
                {order.address.name}
                <br />
                {order.address.street}
                <br />
                {order.address.postcode} {order.address.city}, {order.address.country}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Paid with</p>
              <p className="mt-1 flex items-center gap-1.5 text-stone-800">
                {order.payment === 'flagship_pay' ? <Zap className="size-4 text-emerald-800" /> : <CreditCard className="size-4" />}
                {order.payment === 'flagship_pay' ? 'Flagship Pay' : `Card ending ${order.cardLast4}`}
              </p>
            </div>
          </section>
        </div>

        <aside className={`${cardClass} space-y-5 p-5`}>
          <h2 className="font-medium">Items</h2>
          <ul className="space-y-3">
            {order.lines.map((line) => {
              const product = findProduct(line.productId);
              return (
                <li key={line.productId} className="flex items-center gap-3 text-sm">
                  {product && <ProductVisual product={product} size="sm" className="size-12 shrink-0 rounded-lg" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{line.name}</span>
                    <span className="text-xs text-stone-500">Qty {line.quantity}</span>
                  </span>
                  <span className="tabular-nums">{euro(line.price * line.quantity)}</span>
                </li>
              );
            })}
          </ul>
          <TotalsRows totals={order.totals} />
        </aside>
      </div>
    </>
  );
}
