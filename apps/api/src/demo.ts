import type { Actor, DemoUser } from '@flagship/shared';

/** Simulated dashboard identities. Selected by the client via the X-Actor-Id header. */
export const ACTORS: Actor[] = [
  { id: 'leo', name: 'Leo Nieminen', role: 'developer' },
  { id: 'ida', name: 'Ida Salo', role: 'release_manager' },
  { id: 'sara', name: 'Sara Koskinen', role: 'admin' },
];

export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'System seed', role: 'admin' };

/** Storefront customers used to demonstrate targeting and rollouts. */
export const DEMO_USERS: DemoUser[] = [
  {
    userId: 'u_aino', name: 'Aino Mäkinen', email: 'aino.makinen@example.fi', country: 'FI', accountType: 'regular',
    description: 'Regular customer from Helsinki', loyaltyPoints: 1240,
  },
  {
    userId: 'u_eero', name: 'Eero Lehtonen', email: 'eero.lehtonen@example.fi', country: 'FI', accountType: 'premium',
    description: 'Premium member from Tampere', loyaltyPoints: 8650,
  },
  {
    userId: 'u_sanna', name: 'Sanna Korhonen', email: 'sanna.korhonen@nordhem.example', country: 'FI', accountType: 'employee',
    description: 'Internal employee (dogfooding)', loyaltyPoints: 3200,
  },
  {
    userId: 'u_jonas', name: 'Jonas Lindqvist', email: 'jonas.lindqvist@example.se', country: 'SE', accountType: 'regular',
    description: 'Beta tester from Stockholm', loyaltyPoints: 2100,
  },
  {
    userId: 'u_emma', name: 'Emma Clarke', email: 'emma.clarke@example.com', country: 'US', accountType: 'regular',
    description: 'Regular customer from Boston', loyaltyPoints: 450,
  },
];
