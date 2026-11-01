import { ArrowLeft, Award, Check, Minus, Plus, ShoppingBag, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { euro } from '../../../lib/format';
import { useCart } from '../CartContext';
import { findProduct } from '../catalog';
import { ProductVisual, Rating } from '../components/ProductCard';
import { Recommendations } from '../components/Recommendations';
import { FREE_SHIPPING_THRESHOLD } from '../pricing';
import { useFlag } from '../StoreContext';
import { btnPrimary, btnSecondary, eyebrowClass, headingClass } from '../ui';

export function ProductPage() {
  const { productId = '' } = useParams();
  const product = findProduct(productId);
  const { add, lines } = useCart();
  const loyalty = useFlag('loyalty_program').enabled;
  const freeShipping = useFlag('free_shipping_banner').enabled;
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setQuantity(1);
    setAdded(false);
  }, [productId]);

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(false), 2000);
    return () => clearTimeout(timer);
  }, [added]);

  if (!product) {
    return (
      <div className="py-16 text-center">
        <h1 className={`${headingClass} text-3xl`}>Product not found</h1>
        <Link to="/store/products" className={`${btnSecondary} mt-6`}>
          Back to the shop
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link to="/store/products" className="mb-6 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900">
        <ArrowLeft className="size-4" /> All products
      </Link>
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <ProductVisual product={product} size="lg" className="aspect-square rounded-3xl" />
        <div className="flex flex-col">
          <p className={eyebrowClass}>{product.category}</p>
          <h1 className={`${headingClass} mt-2 text-3xl sm:text-4xl`}>{product.name}</h1>
          <p className="mt-1 text-stone-500">{product.tagline}</p>
          <div className="mt-3">
            <Rating product={product} />
          </div>
          <p className="mt-6 text-2xl font-medium">{euro(product.price)}</p>
          {loyalty && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-amber-900">
              <Award className="size-4" /> Earn {Math.floor(product.price)} points with this item
            </p>
          )}
          <p className="mt-6 leading-relaxed text-stone-600">{product.description}</p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-full border border-stone-300 bg-white">
              <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity" className="grid size-10 place-items-center text-stone-600 hover:text-stone-900">
                <Minus className="size-4" />
              </button>
              <span className="w-8 text-center text-sm tabular-nums">{quantity}</span>
              <button type="button" onClick={() => setQuantity((q) => Math.min(10, q + 1))} aria-label="Increase quantity" className="grid size-10 place-items-center text-stone-600 hover:text-stone-900">
                <Plus className="size-4" />
              </button>
            </div>
            <button
              type="button"
              className={`${btnPrimary} flex-1 sm:flex-none`}
              onClick={() => {
                add(product.id, quantity);
                setAdded(true);
              }}
            >
              {added ? <Check className="size-4" /> : <ShoppingBag className="size-4" />}
              {added ? 'Added to cart' : 'Add to cart'}
            </button>
          </div>
          {added && (
            <Link to="/store/cart" className="mt-3 animate-fade-in text-sm text-emerald-900 hover:underline">
              View cart and check out →
            </Link>
          )}

          <ul className="mt-8 space-y-2 border-t border-stone-200 pt-6 text-sm text-stone-600">
            {product.details.map((d) => (
              <li key={d} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-stone-400" /> {d}
              </li>
            ))}
            <li className="flex items-center gap-2 pt-2 text-stone-500">
              <Truck className="size-4" />
              {freeShipping ? `Free shipping on orders over ${euro(FREE_SHIPPING_THRESHOLD)}` : 'Ships in 1–3 business days'}
            </li>
          </ul>
        </div>
      </div>
      <Recommendations seeds={[product]} exclude={lines.map((l) => l.product.id)} />
    </>
  );
}
