import type { Environment } from '@flagship/shared';
import type { Totals } from './pricing';

export interface ShippingAddress {
  name: string;
  email: string;
  street: string;
  postcode: string;
  city: string;
  country: string;
}

export type PaymentMethod = 'flagship_pay' | 'card';

export interface OrderLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  placedAt: string;
  userId: string;
  environment: Environment;
  lines: OrderLine[];
  totals: Totals;
  payment: PaymentMethod;
  cardLast4: string | null;
  address: ShippingAddress;
}

export const TRACKING_STAGES = [
  { label: 'Order confirmed', detail: 'We are packing your order at our Tampere warehouse.' },
  { label: 'Shipped', detail: 'Your parcel has been handed to the carrier.' },
  { label: 'Out for delivery', detail: 'The courier is on the way to your address.' },
  { label: 'Delivered', detail: 'Your parcel has been delivered. Enjoy!' },
] as const;

/** Demo pacing: the order advances one stage per minute, so tracking is deterministic from `placedAt`. */
export const STAGE_INTERVAL_MS = 60_000;
const LAST_STAGE = TRACKING_STAGES.length - 1;

export const stageIndex = (order: Order, now: number) =>
  Math.min(LAST_STAGE, Math.max(0, Math.floor((now - Date.parse(order.placedAt)) / STAGE_INTERVAL_MS)));

export const stageReachedAt = (order: Order, index: number) => new Date(Date.parse(order.placedAt) + index * STAGE_INTERVAL_MS);

export const deliveryProgress = (order: Order, now: number) =>
  Math.min(1, Math.max(0, (now - Date.parse(order.placedAt)) / (LAST_STAGE * STAGE_INTERVAL_MS)));

export const etaOf = (order: Order) => stageReachedAt(order, LAST_STAGE);

/** Fictional carriers: tracking is simulated, no real logistics provider is involved. */
export const carrierFor = (country: string) => (country === 'FI' || country === 'SE' ? 'Nordic Parcel (simulated)' : 'Global Courier (simulated)');

/** Readable, unique-enough id for a client-side demo order. */
export const newOrderId = () => `NH-${Date.now().toString(36).toUpperCase().slice(-6)}`;
