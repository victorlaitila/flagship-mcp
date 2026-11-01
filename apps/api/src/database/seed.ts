import { randomUUID } from 'node:crypto';
import type { Condition, Environment, EnvironmentConfig, Flag, Segment, TargetingRule } from '@flagship/shared';
import { ACTORS, SYSTEM_ACTOR } from '../demo.js';
import { insertAuditEntry } from '../repositories/audit.js';
import { insertFlag, setConfig } from '../repositories/flags.js';
import { upsertSegment } from '../repositories/segments.js';
import { transaction, type Db } from './db.js';

const [leo, ida, sara] = ACTORS;
const DAY = 24 * 60 * 60 * 1000;

const config = (c: Partial<EnvironmentConfig>): EnvironmentConfig => ({
  enabled: true,
  defaultEnabled: null,
  rolloutPercentage: null,
  variantWeights: null,
  rules: [],
  prerequisites: [],
  ...c,
});
const segmentIs = (...keys: string[]): Condition => ({ attribute: 'segment', operator: 'in', values: keys });
const include = (id: string, description: string, conditions: Condition[], variant: string | null = null): TargetingRule =>
  ({ id, description, effect: 'include', conditions, variant });
const exclude = (id: string, description: string, conditions: Condition[]): TargetingRule =>
  ({ id, description, effect: 'exclude', conditions, variant: null });

const SEGMENTS: Omit<Segment, 'id' | 'createdAt' | 'updatedAt'>[] = [
  { key: 'internal_employees', name: 'Internal Employees', description: 'Staff accounts used for dogfooding.',
    conditions: [{ attribute: 'accountType', operator: 'equals', values: ['employee'] }] },
  { key: 'premium_customers', name: 'Premium Customers', description: 'Customers on a paid premium membership.',
    conditions: [{ attribute: 'accountType', operator: 'equals', values: ['premium'] }] },
  { key: 'finnish_customers', name: 'Finnish Customers', description: 'Customers with a Finnish shipping address.',
    conditions: [{ attribute: 'country', operator: 'equals', values: ['FI'] }] },
  { key: 'beta_testers', name: 'Beta Testers', description: 'Hand-picked users enrolled in the beta programme.',
    conditions: [{ attribute: 'userId', operator: 'in', values: ['u_jonas', 'u_sanna'] }] },
];

interface SeedFlag {
  flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt' | 'status'>;
  configs: Record<Environment, EnvironmentConfig>;
}

const FLAGS: SeedFlag[] = [
  {
    flag: { key: 'new_checkout', name: 'New checkout', type: 'multivariate', owner: 'Checkout Team',
      description: 'Single-page checkout experiment replacing the classic multi-step flow.',
      tags: ['checkout', 'experiment', 'conversion'],
      variants: [{ key: 'multi_step', name: 'Original multi-step' }, { key: 'single_page', name: 'Single-page checkout' }] },
    configs: {
      development: config({ variantWeights: { multi_step: 0, single_page: 100 }, prerequisites: ['new_payment_api'] }),
      staging: config({ variantWeights: { multi_step: 50, single_page: 50 }, prerequisites: ['new_payment_api'],
        rules: [include('r_staff', 'Employees always get single-page', [segmentIs('internal_employees')], 'single_page')] }),
      production: config({ variantWeights: { multi_step: 60, single_page: 40 }, prerequisites: ['new_payment_api'],
        rules: [include('r_beta', 'Beta testers get single-page', [segmentIs('beta_testers')], 'single_page')] }),
    },
  },
  {
    flag: { key: 'new_payment_api', name: 'New payment API', type: 'boolean', owner: 'Payments Team',
      description: 'Routes payments through the new Flagship Pay integration. Kill switch: disable to fall back to legacy card processing.',
      tags: ['payments', 'kill-switch', 'critical'], variants: [] },
    configs: {
      development: config({ defaultEnabled: true }),
      staging: config({ defaultEnabled: true }),
      production: config({ defaultEnabled: true,
        rules: [exclude('r_us', 'Not yet certified for US cards', [{ attribute: 'country', operator: 'equals', values: ['US'] }])] }),
    },
  },
  {
    flag: { key: 'ai_recommendations', name: 'AI recommendations', type: 'percentage', owner: 'Discovery Team',
      description: 'ML-powered "recommended for you" product suggestions on product and cart pages.',
      tags: ['ml', 'recommendations', 'discovery'], variants: [] },
    configs: {
      development: config({ rolloutPercentage: 100 }),
      staging: config({ rolloutPercentage: 50 }),
      production: config({ rolloutPercentage: 25,
        rules: [include('r_staff', 'Employees always see recommendations', [segmentIs('internal_employees')])] }),
    },
  },
  {
    flag: { key: 'new_search', name: 'New search', type: 'multivariate', owner: 'Discovery Team',
      description: 'Enhanced search with instant results, category filters and sorting.',
      tags: ['search', 'experiment', 'discovery'],
      variants: [{ key: 'basic', name: 'Basic search' }, { key: 'enhanced', name: 'Enhanced search' }] },
    configs: {
      development: config({ variantWeights: { basic: 0, enhanced: 100 } }),
      staging: config({ variantWeights: { basic: 50, enhanced: 50 } }),
      production: config({ variantWeights: { basic: 80, enhanced: 20 },
        rules: [include('r_beta', 'Beta testers get enhanced search', [segmentIs('beta_testers')], 'enhanced')] }),
    },
  },
  {
    flag: { key: 'loyalty_program', name: 'Loyalty program', type: 'boolean', owner: 'Growth Team',
      description: 'Shows loyalty points balance and earning on orders. Launching in Finland first.',
      tags: ['loyalty', 'retention'], variants: [] },
    configs: {
      development: config({ defaultEnabled: true }),
      staging: config({ defaultEnabled: true }),
      production: config({ defaultEnabled: false,
        rules: [include('r_fi', 'Finnish launch + employees', [segmentIs('finnish_customers', 'internal_employees')])] }),
    },
  },
  {
    flag: { key: 'loyalty_rewards', name: 'Loyalty rewards', type: 'boolean', owner: 'Growth Team',
      description: 'Lets loyalty members redeem points for discounts. Requires loyalty_program.',
      tags: ['loyalty', 'checkout'], variants: [] },
    configs: {
      development: config({ defaultEnabled: true, prerequisites: ['loyalty_program'] }),
      staging: config({ defaultEnabled: false, prerequisites: ['loyalty_program'],
        rules: [include('r_premium', 'Premium members and beta testers', [segmentIs('premium_customers', 'beta_testers')])] }),
      production: config({ enabled: false, defaultEnabled: false, prerequisites: ['loyalty_program'] }),
    },
  },
  {
    flag: { key: 'cart_redesign', name: 'Cart redesign', type: 'multivariate', owner: 'Checkout Team',
      description: 'Redesigned cart with free-shipping progress and an order summary sidebar.',
      tags: ['cart', 'experiment', 'ux'],
      variants: [{ key: 'classic', name: 'Classic cart' }, { key: 'redesigned', name: 'Redesigned cart' }] },
    configs: {
      development: config({ variantWeights: { classic: 0, redesigned: 100 } }),
      staging: config({ variantWeights: { classic: 50, redesigned: 50 } }),
      production: config({ variantWeights: { classic: 100, redesigned: 0 },
        rules: [include('r_staff', 'Dogfood with employees', [segmentIs('internal_employees')], 'redesigned')] }),
    },
  },
  {
    flag: { key: 'order_tracking_v2', name: 'Order tracking v2', type: 'boolean', owner: 'Fulfillment Team',
      description: 'Live order timeline with carrier milestones and delivery estimate.',
      tags: ['orders', 'fulfillment'], variants: [] },
    configs: {
      development: config({ defaultEnabled: true }),
      staging: config({ defaultEnabled: false,
        rules: [include('r_beta', 'Beta testers and employees', [segmentIs('beta_testers', 'internal_employees')])] }),
      production: config({ defaultEnabled: false,
        rules: [include('r_beta', 'Beta testers', [segmentIs('beta_testers')])] }),
    },
  },
  {
    flag: { key: 'personalized_homepage', name: 'Personalized homepage', type: 'boolean', owner: 'Growth Team',
      description: 'Personal greeting, picks based on account and curated sections on the storefront homepage.',
      tags: ['personalization', 'homepage'], variants: [] },
    configs: {
      development: config({ defaultEnabled: true }),
      staging: config({ defaultEnabled: false,
        rules: [include('r_premium', 'Premium members and employees', [segmentIs('premium_customers', 'internal_employees')])] }),
      production: config({ defaultEnabled: false,
        rules: [include('r_premium', 'Premium members', [segmentIs('premium_customers')])] }),
    },
  },
  {
    flag: { key: 'free_shipping_banner', name: 'Free shipping banner', type: 'boolean', owner: 'Marketing Team',
      description: 'Nordic free-shipping campaign banner shown to eligible regions.',
      tags: ['promo', 'campaign', 'marketing'], variants: [] },
    configs: {
      development: config({ defaultEnabled: true }),
      staging: config({ defaultEnabled: false,
        rules: [include('r_nordics', 'Nordic customers', [{ attribute: 'country', operator: 'in', values: ['FI', 'SE'] }])] }),
      production: config({ defaultEnabled: false,
        rules: [
          exclude('r_staff', 'No promos for employees', [segmentIs('internal_employees')]),
          include('r_nordics', 'Nordic customers', [{ attribute: 'country', operator: 'in', values: ['FI', 'SE'] }]),
        ] }),
    },
  },
];

/** Historical changes. Each `next` equals the seeded current config so the history is consistent. */
const HISTORY: { daysAgo: number; actor: typeof leo; flagKey: string; environment: Environment; previous: (c: EnvironmentConfig) => EnvironmentConfig }[] = [
  { daysAgo: 9, actor: leo, flagKey: 'loyalty_rewards', environment: 'development', previous: (c) => ({ ...c, enabled: false }) },
  { daysAgo: 7, actor: sara, flagKey: 'new_payment_api', environment: 'production', previous: (c) => ({ ...c, enabled: false }) },
  { daysAgo: 5, actor: ida, flagKey: 'new_search', environment: 'staging', previous: (c) => ({ ...c, variantWeights: { basic: 80, enhanced: 20 } }) },
  { daysAgo: 4, actor: ida, flagKey: 'cart_redesign', environment: 'staging', previous: (c) => ({ ...c, enabled: false }) },
  { daysAgo: 3, actor: sara, flagKey: 'free_shipping_banner', environment: 'production', previous: (c) => ({ ...c, rules: c.rules.filter((r) => r.effect !== 'exclude') }) },
  { daysAgo: 2, actor: ida, flagKey: 'ai_recommendations', environment: 'staging', previous: (c) => ({ ...c, rolloutPercentage: 20 }) },
  { daysAgo: 1, actor: sara, flagKey: 'ai_recommendations', environment: 'production', previous: (c) => ({ ...c, rolloutPercentage: 10 }) },
];

export function isSeeded(db: Db): boolean {
  return (db.prepare('SELECT COUNT(*) AS n FROM flags').get() as { n: number }).n > 0;
}

export function seed(db: Db, now = Date.now()): void {
  transaction(db, () => {
    const at = (daysAgo: number, offsetMinutes = 0) => new Date(now - daysAgo * DAY + offsetMinutes * 60_000).toISOString();

    SEGMENTS.forEach((s) => {
      const timestamp = at(60);
      upsertSegment(db, { ...s, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp });
      insertAuditEntry(db, { timestamp, actor: SYSTEM_ACTOR, operation: 'segment.created', segmentKey: s.key, previous: null, next: s });
    });

    const flagIds = new Map<string, string>();
    FLAGS.forEach(({ flag, configs }, i) => {
      const created = at(50 - i * 3);
      const id = randomUUID();
      flagIds.set(flag.key, id);
      const lastChange = HISTORY.filter((h) => h.flagKey === flag.key).at(-1);
      const updatedAt = lastChange ? at(lastChange.daysAgo) : created;
      insertFlag(db, { ...flag, id, status: 'active', createdAt: created, updatedAt });
      for (const [environment, c] of Object.entries(configs) as [Environment, EnvironmentConfig][]) {
        setConfig(db, id, environment, c, updatedAt);
      }
      insertAuditEntry(db, { timestamp: created, actor: i % 2 ? leo : sara, operation: 'flag.created', flagKey: flag.key,
        previous: null, next: flag });
    });

    for (const h of HISTORY) {
      const current = FLAGS.find((f) => f.flag.key === h.flagKey)!.configs[h.environment];
      insertAuditEntry(db, { timestamp: at(h.daysAgo), actor: h.actor, operation: 'config.updated', flagKey: h.flagKey,
        environment: h.environment, previous: h.previous(current), next: current });
    }
  });
}
