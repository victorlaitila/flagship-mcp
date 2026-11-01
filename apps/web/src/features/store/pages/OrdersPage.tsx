import { ChevronRight, Package } from 'lucide-react';
import { Link } from 'react-router';
import { dateTime, euro } from '../../../lib/format';
import { useCart } from '../CartContext';
import { useNow } from '../components/OrderTracking';
import { stageIndex, TRACKING_STAGES } from '../orders';
import { useStore } from '../StoreContext';
import { btnPrimary, cardClass, headingClass } from '../ui';

/** All demo orders placed in this browser, newest first (across demo customers, so they can be compared). */
export function OrdersPage() {
  const { orders } = useCart();
  const { users } = useStore();
  const now = useNow();

  return (
    <>
      <h1 className={`${headingClass} mb-8 text-3xl sm:text-4xl`}>Orders</h1>
      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 px-6 py-16 text-center">
          <Package className="mx-auto size-8 text-stone-400" strokeWidth={1.5} />
          <p className="mt-4 font-serif text-xl text-stone-800">No orders yet</p>
          <p className="mt-1 text-sm text-stone-500">Orders you place will appear here with live tracking.</p>
          <Link to="/store/products" className={`${btnPrimary} mt-6`}>
            Start shopping
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => {
            const stage = stageIndex(order, now);
            const delivered = stage === TRACKING_STAGES.length - 1;
            const customer = users.find((u) => u.userId === order.userId)?.name ?? order.address.name;
            return (
              <li key={order.id}>
                <Link to={`/store/orders/${order.id}`} className={`${cardClass} flex items-center gap-4 p-4 transition hover:border-stone-300 hover:shadow-sm`}>
                  <span className={`grid size-10 shrink-0 place-items-center rounded-full ${delivered ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    <Package className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{order.id}</span>
                    <span className="block truncate text-xs text-stone-500">
                      {dateTime(order.placedAt)} · {customer} · {order.lines.reduce((n, l) => n + l.quantity, 0)} items
                    </span>
                  </span>
                  <span className="hidden text-right sm:block">
                    <span className="block text-sm font-medium tabular-nums">{euro(order.totals.total)}</span>
                    <span className="block text-xs text-stone-500">{TRACKING_STAGES[stage].label}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-stone-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
