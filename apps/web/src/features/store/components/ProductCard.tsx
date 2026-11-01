import { Plus, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { euro } from '../../../lib/format';
import { useCart } from '../CartContext';
import type { Product } from '../catalog';

/** Product "photography": a soft colour field with the product's icon. */
export function ProductVisual({ product, size = 'md', className = '' }: { product: Product; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = product.icon;
  const iconSize = { sm: 'size-6', md: 'size-14', lg: 'size-28' }[size];
  return (
    <div className={`relative grid place-items-center overflow-hidden bg-gradient-to-br ${product.swatch} ${className}`}>
      <div className="absolute -bottom-1/4 -right-1/4 aspect-square w-3/4 rounded-full bg-white/40 blur-2xl" />
      <Icon className={`relative ${iconSize} ${product.ink}`} strokeWidth={1.25} aria-hidden />
    </div>
  );
}

export function Rating({ product }: { product: Product }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-stone-500">
      <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
      <span className="font-medium text-stone-700">{product.rating.toFixed(1)}</span>
      <span>({product.reviewCount})</span>
    </span>
  );
}

export function ProductCard({ product, name }: { product: Product; name?: ReactNode }) {
  const { add } = useCart();
  return (
    <article className="group relative flex flex-col">
      <Link to={`/store/products/${product.id}`} className="block overflow-hidden rounded-2xl">
        <ProductVisual product={product} className="aspect-[4/5] transition duration-500 group-hover:scale-[1.03]" />
      </Link>
      <button
        type="button"
        onClick={() => add(product.id)}
        aria-label={`Add ${product.name} to cart`}
        className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-white/90 text-stone-800 opacity-100 shadow-sm transition hover:bg-emerald-900 hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Plus className="size-4" />
      </button>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-stone-500">{product.category}</p>
          <Link to={`/store/products/${product.id}`} className="block font-medium text-stone-900 hover:underline">
            {name ?? product.name}
          </Link>
          <div className="mt-1">
            <Rating product={product} />
          </div>
        </div>
        <p className="shrink-0 font-medium text-stone-900">{euro(product.price)}</p>
      </div>
    </article>
  );
}

export function ProductGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-4">{children}</div>;
}
