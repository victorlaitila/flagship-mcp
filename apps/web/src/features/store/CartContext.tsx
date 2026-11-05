import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { findProduct, type Product } from './catalog';
import type { Order } from './orders';
import { computeTotals, type Totals } from './pricing';
import { readStored, writeStored } from './storage';
import { useFlag, useStore } from './StoreContext';

const CART_KEY = 'nordhem.cart';
const ORDERS_KEY = 'nordhem.orders';
const MAX_QUANTITY = 10;

interface StoredLine {
  productId: string;
  quantity: number;
}

export interface CartLine {
  product: Product;
  quantity: number;
  /** Exposed for pricing helpers that take `{ price, quantity }`. */
  price: number;
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  add: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  orders: Order[];
  addOrder: (order: Order) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside <CartProvider>');
  return value;
}

const clampQuantity = (q: number) => Math.min(MAX_QUANTITY, Math.max(1, Math.round(q)));

// Stored data can be outdated or hand-edited: drop entries that would crash rendering.
const isStoredLine = (l: Partial<StoredLine> | null): l is StoredLine =>
  typeof l?.productId === 'string' && typeof l.quantity === 'number';
const isOrder = (o: Partial<Order> | null): o is Order =>
  typeof o?.id === 'string' && typeof o.placedAt === 'string' && Array.isArray(o.lines) && o.lines.every(isStoredLine)
  && typeof o.totals === 'object' && o.totals !== null && typeof o.address?.name === 'string';

/** Cart and placed orders are client-side demo state, persisted to localStorage. */
export function CartProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredLine[]>(() =>
    readStored<StoredLine[]>(CART_KEY, []).filter((l) => isStoredLine(l) && findProduct(l.productId) && l.quantity > 0),
  );
  const [orders, setOrders] = useState<Order[]>(() => readStored<Order[]>(ORDERS_KEY, []).filter(isOrder));

  useEffect(() => { writeStored(CART_KEY, stored); }, [stored]);
  useEffect(() => { writeStored(ORDERS_KEY, orders); }, [orders]);

  const value = useMemo<CartContextValue>(() => {
    const lines = stored.flatMap((l): CartLine[] => {
      const product = findProduct(l.productId);
      return product ? [{ product, quantity: l.quantity, price: product.price }] : [];
    });
    return {
      lines,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      add: (productId, quantity = 1) =>
        setStored((current) => {
          const existing = current.find((l) => l.productId === productId);
          return existing
            ? current.map((l) => (l.productId === productId ? { ...l, quantity: clampQuantity(l.quantity + quantity) } : l))
            : [...current, { productId, quantity: clampQuantity(quantity) }];
        }),
      setQuantity: (productId, quantity) =>
        setStored((current) => current.map((l) => (l.productId === productId ? { ...l, quantity: clampQuantity(quantity) } : l))),
      remove: (productId) => setStored((current) => current.filter((l) => l.productId !== productId)),
      clear: () => setStored([]),
      orders,
      addOrder: (order) => setOrders((current) => [order, ...current]),
    };
  }, [stored, orders]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * Totals for the current cart under the evaluated flags:
 * `free_shipping_banner` (free shipping threshold), `loyalty_program` (points earned), `loyalty_rewards` (redemption).
 */
export function useCartTotals(redeemPoints = false): Totals {
  const { lines } = useCart();
  const { user } = useStore();
  const freeShipping = useFlag('free_shipping_banner').enabled;
  const earnPoints = useFlag('loyalty_program').enabled;
  const rewards = useFlag('loyalty_rewards').enabled;
  return computeTotals(lines, { freeShipping, earnPoints, availablePoints: redeemPoints && rewards ? user.loyaltyPoints : 0 });
}
