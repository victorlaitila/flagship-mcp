import { Link } from 'react-router';
import { euro } from '../../../lib/format';
import { useCart, useCartTotals } from '../CartContext';
import { ProductVisual } from '../components/ProductCard';
import { TotalsRows } from '../components/TotalsRows';
import { btnPrimary, btnSecondary } from '../ui';

const QUANTITIES = Array.from({ length: 10 }, (_, i) => i + 1);

/** The original table-style cart. */
export function ClassicCart() {
  const { lines, setQuantity, remove } = useCart();
  const totals = useCartTotals();

  return (
    <div className="animate-fade-in">
      <table className="w-full table-fixed border-y border-stone-300 text-sm">
        <thead className="border-b border-stone-300 bg-stone-100 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">Product</th>
            <th className="hidden w-28 px-3 py-2 text-right font-medium sm:table-cell">Price</th>
            <th className="w-20 px-3 py-2 font-medium sm:w-24">Qty</th>
            <th className="w-24 px-3 py-2 text-right font-medium sm:w-28">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200 bg-white">
          {lines.map(({ product, quantity }) => (
            <tr key={product.id}>
              <td className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <ProductVisual product={product} size="sm" className="hidden size-12 shrink-0 rounded sm:grid" />
                  <div className="min-w-0">
                    <Link to={`/store/products/${product.id}`} className="block truncate font-medium text-stone-900 hover:underline">
                      {product.name}
                    </Link>
                    <button type="button" onClick={() => remove(product.id)} className="text-xs text-stone-500 underline hover:text-red-700">
                      Remove
                    </button>
                  </div>
                </div>
              </td>
              <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{euro(product.price)}</td>
              <td className="px-3 py-3">
                <select
                  value={quantity}
                  onChange={(e) => setQuantity(product.id, Number(e.target.value))}
                  aria-label={`Quantity of ${product.name}`}
                  className="w-full rounded border border-stone-300 bg-white px-1.5 py-1"
                >
                  {QUANTITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-3 text-right font-medium tabular-nums">{euro(product.price * quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex flex-col-reverse gap-6 sm:flex-row sm:items-start sm:justify-between">
        <Link to="/store/products" className={btnSecondary}>
          Continue shopping
        </Link>
        <div className="w-full sm:w-80">
          <TotalsRows totals={totals} />
          <Link to="/store/checkout" className={`${btnPrimary} mt-5 w-full`}>
            Proceed to checkout
          </Link>
        </div>
      </div>
    </div>
  );
}
