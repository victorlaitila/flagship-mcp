import { ShoppingBag } from 'lucide-react';
import { Link } from 'react-router';
import { useCart } from '../CartContext';
import { Recommendations } from '../components/Recommendations';
import { useFlag } from '../StoreContext';
import { btnPrimary, headingClass } from '../ui';
import { ClassicCart } from './ClassicCart';
import { RedesignedCart } from './RedesignedCart';

/** `cart_redesign`: `redesigned` card-based cart; `classic` (default variant) table cart. */
export function CartPage() {
  const { lines } = useCart();
  const { variant } = useFlag('cart_redesign');

  return (
    <>
      <h1 className={`${headingClass} mb-8 text-3xl sm:text-4xl`}>Your cart</h1>
      {lines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 px-6 py-16 text-center">
          <ShoppingBag className="mx-auto size-8 text-stone-400" strokeWidth={1.5} />
          <p className="mt-4 font-serif text-xl text-stone-800">Your cart is empty</p>
          <p className="mt-1 text-sm text-stone-500">Find something warm for the season.</p>
          <Link to="/store/products" className={`${btnPrimary} mt-6`}>
            Browse the collection
          </Link>
        </div>
      ) : variant === 'redesigned' ? (
        <RedesignedCart />
      ) : (
        <ClassicCart />
      )}
      <Recommendations seeds={lines.map((l) => l.product)} exclude={[]} />
    </>
  );
}
