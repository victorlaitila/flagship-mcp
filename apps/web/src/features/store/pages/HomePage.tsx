import { ArrowRight, Award } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PRODUCTS, findProduct, type Product } from '../catalog';
import { ProductCard, ProductGrid, ProductVisual } from '../components/ProductCard';
import { picksFor } from '../recommendations';
import { useFlag, useStore } from '../StoreContext';
import { btnPrimary, btnSecondary, eyebrowClass, headingClass } from '../ui';

const HERO_PRODUCTS = ['kaamos-wool-throw', 'kuksa-birch-cup', 'valo-beeswax-candles'].flatMap((id) => findProduct(id) ?? []);

function greeting(hour: number) {
  return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** `personalized_homepage`: greeting + tailored picks when enabled, generic hero + featured products otherwise. */
export function HomePage() {
  const personalized = useFlag('personalized_homepage').enabled;
  return personalized ? <PersonalizedHome /> : <GenericHome />;
}

function GenericHome() {
  return (
    <>
      <Hero
        eyebrow="Autumn / Winter collection"
        title="Warmth for the long northern evenings"
        lead="Wool, linen, birch and beeswax — honest materials made by small Nordic workshops, chosen to last for decades."
      />
      <Section eyebrow="Featured" title="Our most-loved pieces" products={PRODUCTS.filter((p) => p.featured).slice(0, 4)} />
    </>
  );
}

function PersonalizedHome() {
  const { user } = useStore();
  const loyalty = useFlag('loyalty_program').enabled;
  const picks = picksFor(user);
  const firstName = user.name.split(' ')[0];

  return (
    <>
      <Hero
        eyebrow={`Welcome back, ${firstName}`}
        title={`${greeting(new Date().getHours())}, ${firstName}.`}
        lead={`${picks.reason}. We've gathered a few things we think you'll love.`}
      >
        {loyalty && (
          <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1.5 text-sm text-amber-900">
            <Award className="size-4" /> You have {user.loyaltyPoints.toLocaleString('en')} points to use
          </p>
        )}
      </Hero>
      <Section eyebrow="Tailored for you" title={picks.title} products={picks.products} />
    </>
  );
}

function Hero({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children?: ReactNode }) {
  return (
    <section className="grid items-center gap-8 md:grid-cols-[1.1fr_1fr] md:gap-12">
      <div className="animate-slide-up">
        <p className={eyebrowClass}>{eyebrow}</p>
        <h1 className={`${headingClass} mt-3 text-4xl leading-[1.05] sm:text-5xl lg:text-6xl`}>{title}</h1>
        <p className="mt-5 max-w-lg text-base leading-relaxed text-stone-600">{lead}</p>
        {children}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/store/products" className={btnPrimary}>
            Shop the collection <ArrowRight className="size-4" />
          </Link>
          <Link to="/store/orders" className={btnSecondary}>
            Track an order
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-2 grid-rows-2 gap-3">
        {HERO_PRODUCTS.map((p, i) => (
          <Link key={p.id} to={`/store/products/${p.id}`} className={`overflow-hidden rounded-2xl ${i === 0 ? 'row-span-2' : ''}`}>
            <ProductVisual product={p} size={i === 0 ? 'lg' : 'md'} className={`h-full transition duration-500 hover:scale-[1.03] ${i === 0 ? 'min-h-72' : 'min-h-32'}`} />
          </Link>
        ))}
      </div>
    </section>
  );
}

function Section({ eyebrow, title, products }: { eyebrow: string; title: string; products: Product[] }) {
  return (
    <section className="mt-16">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className={eyebrowClass}>{eyebrow}</p>
          <h2 className={`${headingClass} mt-1 text-2xl sm:text-3xl`}>{title}</h2>
        </div>
        <Link to="/store/products" className="inline-flex shrink-0 items-center gap-1 text-sm text-emerald-900 hover:underline">
          View all <ArrowRight className="size-4" />
        </Link>
      </div>
      <ProductGrid>
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </ProductGrid>
    </section>
  );
}
