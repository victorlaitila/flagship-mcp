import { Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CATEGORIES, PRODUCTS, type Category, type Product } from '../catalog';
import { ProductCard, ProductGrid } from '../components/ProductCard';
import { useFlag } from '../StoreContext';
import { eyebrowClass, headingClass, inputClass } from '../ui';

/** `new_search`: `enhanced` gets instant search with filters, sort and highlighting; `basic` (default variant) a plain name filter. */
export function ProductsPage() {
  const { variant } = useFlag('new_search');
  return (
    <>
      <div className="mb-8">
        <p className={eyebrowClass}>The collection</p>
        <h1 className={`${headingClass} mt-1 text-3xl sm:text-4xl`}>Shop Nordhem</h1>
      </div>
      {variant === 'enhanced' ? <EnhancedSearch /> : <BasicSearch />}
    </>
  );
}

function BasicSearch() {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const results = PRODUCTS.filter((p) => p.name.toLowerCase().includes(needle));
  return (
    <>
      <div className="mb-8 flex max-w-md gap-2">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products by name" className={inputClass} aria-label="Search products" />
      </div>
      <Results products={results} />
    </>
  );
}

type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'rating';
const SORTS: Record<SortKey, { label: string; compare: (a: Product, b: Product) => number }> = {
  featured: { label: 'Featured', compare: (a, b) => Number(b.featured) - Number(a.featured) },
  'price-asc': { label: 'Price: low to high', compare: (a, b) => a.price - b.price },
  'price-desc': { label: 'Price: high to low', compare: (a, b) => b.price - a.price },
  rating: { label: 'Top rated', compare: (a, b) => b.rating - a.rating },
};

function matches(product: Product, needle: string) {
  if (!needle) return true;
  return [product.name, product.category, product.tagline, ...product.tags].some((text) => text.toLowerCase().includes(needle));
}

function EnhancedSearch() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [sort, setSort] = useState<SortKey>('featured');
  const needle = query.trim().toLowerCase();
  const results = PRODUCTS.filter((p) => (!category || p.category === category) && matches(p, needle)).sort(SORTS[sort].compare);

  return (
    <>
      <div className="mb-8 space-y-4">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search wool, sauna, birch, candles…"
            className={`${inputClass} rounded-full py-2.5 pl-10 pr-10`}
            aria-label="Search products"
            autoFocus
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {[null, ...CATEGORIES].map((c) => (
              <button
                key={c ?? 'all'}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                  category === c ? 'border-emerald-900 bg-emerald-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400'
                }`}
              >
                {c ?? 'All'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-500">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={`${inputClass} w-auto py-1.5`}>
              {Object.entries(SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm text-stone-500" aria-live="polite">
          {results.length} {results.length === 1 ? 'product' : 'products'}
          {needle && (
            <>
              {' '}
              for “<span className="text-stone-800">{query.trim()}</span>”
            </>
          )}
          {category && <> in {category}</>}
        </p>
      </div>
      <Results products={results} highlight={needle} />
    </>
  );
}

function Highlight({ text, needle }: { text: string; needle: string }): ReactNode {
  const start = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (start < 0) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-amber-200/70 px-0.5 text-stone-900">{text.slice(start, start + needle.length)}</mark>
      {text.slice(start + needle.length)}
    </>
  );
}

function Results({ products, highlight }: { products: Product[]; highlight?: string }) {
  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 px-6 py-16 text-center">
        <p className="font-serif text-xl text-stone-800">Nothing found</p>
        <p className="mt-1 text-sm text-stone-500">Try a different search term.</p>
      </div>
    );
  }
  return (
    <ProductGrid>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} name={highlight ? <Highlight text={p.name} needle={highlight} /> : undefined} />
      ))}
    </ProductGrid>
  );
}
