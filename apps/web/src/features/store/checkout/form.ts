import type { DemoUser } from '@flagship/shared';
import type { PaymentMethod, ShippingAddress } from '../orders';

export interface CardDetails {
  holder: string;
  number: string;
  expiry: string;
  cvc: string;
}

export interface CheckoutForm {
  address: ShippingAddress;
  payment: PaymentMethod;
  card: CardDetails;
  redeemPoints: boolean;
}

export type FieldErrors = Partial<Record<keyof ShippingAddress | keyof CardDetails, string>>;

export const SHIPPING_COUNTRIES = ['FI', 'SE', 'NO', 'DK', 'EE', 'DE', 'US'];

export const initialForm = (user: DemoUser): CheckoutForm => ({
  address: { name: user.name, email: user.email, street: '', postcode: '', city: '', country: user.country },
  payment: 'flagship_pay',
  card: { holder: user.name, number: '', expiry: '', cvc: '' },
  redeemPoints: false,
});

export function validateAddress(a: ShippingAddress): FieldErrors {
  const errors: FieldErrors = {};
  if (!a.name.trim()) errors.name = 'Enter your full name';
  if (!/^\S+@\S+\.\S+$/.test(a.email.trim())) errors.email = 'Enter a valid email address';
  if (!a.street.trim()) errors.street = 'Enter your street address';
  if (!/^[A-Za-z0-9 -]{3,10}$/.test(a.postcode.trim())) errors.postcode = 'Enter a valid postcode';
  if (!a.city.trim()) errors.city = 'Enter your city';
  return errors;
}

/** Demo card validation only (format, not a real card check). */
export function validateCard(card: CardDetails): FieldErrors {
  const errors: FieldErrors = {};
  if (!card.holder.trim()) errors.holder = 'Enter the name on the card';
  if (!/^\d{16}$/.test(card.number.replace(/\s/g, ''))) errors.number = 'Card number must be 16 digits';
  const expiry = /^(\d{2})\s*\/\s*(\d{2})$/.exec(card.expiry.trim());
  if (!expiry || Number(expiry[1]) < 1 || Number(expiry[1]) > 12) errors.expiry = 'Use MM/YY';
  if (!/^\d{3,4}$/.test(card.cvc.trim())) errors.cvc = '3–4 digits';
  return errors;
}

export const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;
