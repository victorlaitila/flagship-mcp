export const SHIPPING_FEE = 5.9;
export const FREE_SHIPPING_THRESHOLD = 50;
/** Loyalty rewards: points are redeemed in blocks of 500 pts = €5, capped at 20% of the subtotal. */
export const POINTS_PER_BLOCK = 500;
export const EUROS_PER_BLOCK = 5;
const MAX_DISCOUNT_SHARE = 0.2;

export interface PricedLine {
  price: number;
  quantity: number;
}

export interface Totals {
  subtotal: number;
  shipping: number;
  discount: number;
  pointsRedeemed: number;
  total: number;
  /** Points the order earns (1 per whole euro spent on products); 0 when the loyalty program is off. */
  pointsEarned: number;
}

export interface PricingOptions {
  /** `free_shipping_banner` flag: free shipping above the threshold. */
  freeShipping: boolean;
  /** `loyalty_program` flag: orders earn points. */
  earnPoints: boolean;
  /** Points the customer chose to redeem (0 when not redeeming or `loyalty_rewards` is off). */
  availablePoints: number;
}

const cents = (amount: number) => Math.round(amount * 100) / 100;

export const subtotalOf = (lines: PricedLine[]) => cents(lines.reduce((sum, l) => sum + l.price * l.quantity, 0));

/** The largest redemption allowed for this balance and subtotal. */
export function maxRedemption(availablePoints: number, subtotal: number): { points: number; discount: number } {
  const blocks = Math.max(0, Math.min(Math.floor(availablePoints / POINTS_PER_BLOCK), Math.floor((subtotal * MAX_DISCOUNT_SHARE) / EUROS_PER_BLOCK)));
  return { points: blocks * POINTS_PER_BLOCK, discount: blocks * EUROS_PER_BLOCK };
}

export function computeTotals(lines: PricedLine[], options: PricingOptions): Totals {
  const subtotal = subtotalOf(lines);
  const qualifiesForFree = options.freeShipping && subtotal >= FREE_SHIPPING_THRESHOLD;
  const shipping = subtotal === 0 || qualifiesForFree ? 0 : SHIPPING_FEE;
  const { points, discount } = maxRedemption(options.availablePoints, subtotal);
  return {
    subtotal,
    shipping,
    discount,
    pointsRedeemed: points,
    total: cents(subtotal - discount + shipping),
    pointsEarned: options.earnPoints ? Math.floor(subtotal - discount) : 0,
  };
}
