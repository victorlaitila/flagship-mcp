import { Sparkles } from 'lucide-react';
import type { Product } from '../catalog';
import { popularProducts, similarProducts } from '../recommendations';
import { useFlag } from '../StoreContext';
import { eyebrowClass, headingClass } from '../ui';
import { ProductCard, ProductGrid } from './ProductCard';

/**
 * `ai_recommendations`: personalised similarity-based picks when enabled, top-rated fallback otherwise.
 * `seeds` are the products the customer is looking at; they and `exclude` are never recommended.
 */
export function Recommendations({ seeds, exclude }: { seeds: Product[]; exclude: string[] }) {
  const ai = useFlag('ai_recommendations');
  const excluded = new Set([...exclude, ...seeds.map((p) => p.id)]);
  const products = ai.enabled ? similarProducts(seeds, excluded) : popularProducts(excluded);
  if (products.length === 0) return null;

  return (
    <section className="mt-16 border-t border-stone-200 pt-10">
      <div className="mb-6">
        {ai.enabled ? (
          <p className={`${eyebrowClass} inline-flex items-center gap-1.5 text-emerald-800`}>
            <Sparkles className="size-3.5" /> Based on what you're browsing
          </p>
        ) : (
          <p className={eyebrowClass}>Customer favourites</p>
        )}
        <h2 className={`${headingClass} mt-1 text-2xl`}>{ai.enabled ? 'Recommended for you' : 'Popular products'}</h2>
      </div>
      <ProductGrid>
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </ProductGrid>
    </section>
  );
}
