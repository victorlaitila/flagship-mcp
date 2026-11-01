import type { DemoUser } from '@flagship/shared';
import { PRODUCTS, type Product } from './catalog';

const byRating = (a: Product, b: Product) => b.rating - a.rating || b.reviewCount - a.reviewCount;

/** Fallback when `ai_recommendations` is off: top-rated products. */
export function popularProducts(exclude: Set<string>, limit = 4): Product[] {
  return PRODUCTS.filter((p) => !exclude.has(p.id)).sort(byRating).slice(0, limit);
}

/** Deterministic content similarity: same category scores 3, every shared tag scores 1. */
export function similarProducts(seeds: Product[], exclude: Set<string>, limit = 4): Product[] {
  if (seeds.length === 0) return popularProducts(exclude, limit);
  const score = (candidate: Product) =>
    seeds.reduce(
      (sum, seed) => sum + (seed.category === candidate.category ? 3 : 0) + candidate.tags.filter((t) => seed.tags.includes(t)).length,
      0,
    );
  return PRODUCTS.filter((p) => !exclude.has(p.id))
    .map((product) => ({ product, score: score(product) }))
    .sort((a, b) => b.score - a.score || byRating(a.product, b.product))
    .slice(0, limit)
    .map((s) => s.product);
}

export interface Picks {
  title: string;
  reason: string;
  products: Product[];
}

const COUNTRY_PICKS: Record<string, { tag: string; reason: string }> = {
  FI: { tag: 'sauna', reason: 'Sauna essentials loved by customers in Finland' },
  SE: { tag: 'candlelight', reason: 'Candlelight favourites from our Swedish customers' },
};

/** Personalized homepage picks, tailored by account type, then country. */
export function picksFor(user: DemoUser, limit = 4): Picks {
  if (user.accountType === 'premium') {
    return { title: 'Premium picks', reason: 'Our finest pieces, selected for Premium members', products: [...PRODUCTS].sort((a, b) => b.price - a.price).slice(0, limit) };
  }
  if (user.accountType === 'employee') {
    return { title: 'New this season', reason: 'Fresh arrivals for the team to try first', products: PRODUCTS.filter((p) => p.tags.includes('new')).slice(0, limit) };
  }
  const local = COUNTRY_PICKS[user.country];
  if (local) {
    const matching = PRODUCTS.filter((p) => p.tags.includes(local.tag)).sort(byRating);
    const rest = PRODUCTS.filter((p) => !p.tags.includes(local.tag)).sort(byRating);
    return { title: 'Picked for you', reason: local.reason, products: [...matching, ...rest].slice(0, limit) };
  }
  return { title: 'Picked for you', reason: 'Customer favourites that ship worldwide', products: popularProducts(new Set(), limit) };
}
