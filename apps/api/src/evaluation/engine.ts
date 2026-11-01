import { createHash } from 'node:crypto';
import { defaultVariantKey } from '@flagship/shared';
import type {
  Condition,
  Environment,
  EnvironmentConfig,
  EvaluationMatch,
  EvaluationReason,
  EvaluationResult,
  Flag,
  Segment,
  UserContext,
} from '@flagship/shared';

/** Everything evaluation needs, held in memory so previews can swap in proposed configs. */
export interface EvaluationSnapshot {
  flags: Map<string, Flag>;
  configs: Map<string, Record<Environment, EnvironmentConfig>>;
  segments: Map<string, Segment>;
}

/** Deterministic bucket in [0, 100) with 0.01 granularity, stable per (flag, user). */
export function bucketFor(flagKey: string, userId: string): number {
  const hash = createHash('sha256').update(`${flagKey}:${userId}`).digest();
  return (hash.readUInt32BE(0) % 10000) / 100;
}

function userValue(condition: Condition, user: UserContext): string | null {
  switch (condition.attribute) {
    case 'userId':
      return user.userId;
    case 'country':
      return user.country;
    case 'accountType':
      return user.accountType;
    case 'segment':
      return null; // handled via membership
  }
}

export function matchesCondition(
  condition: Condition,
  user: UserContext,
  segments: Map<string, Segment>,
): boolean {
  if (condition.attribute === 'segment') {
    const inAny = condition.values.some((key) => {
      const segment = segments.get(key);
      return segment !== undefined && userInSegment(segment, user);
    });
    return condition.operator === 'equals' || condition.operator === 'in' ? inAny : !inAny;
  }
  const value = userValue(condition, user);
  const listed = value !== null && condition.values.includes(value);
  return condition.operator === 'equals' || condition.operator === 'in' ? listed : !listed;
}

export function userInSegment(segment: Segment, user: UserContext): boolean {
  // Segments cannot reference other segments, so an empty map is enough here.
  return segment.conditions.every((c) => matchesCondition(c, user, new Map()));
}

function result(
  flag: Flag,
  environment: Environment,
  user: UserContext,
  enabled: boolean,
  variant: string | null,
  reason: EvaluationReason,
  explanation: string,
  match: EvaluationMatch | null,
): EvaluationResult {
  return { flagKey: flag.key, environment, userId: user.userId, enabled, variant, reason, explanation, match };
}

/**
 * Evaluation order:
 * 1. Archived flags are off.
 * 2. Flags disabled in the environment are off.
 * 3. Every prerequisite must evaluate enabled for the same user/environment.
 * 4. Any matching exclude rule turns the flag off (beats inclusions and rollout).
 * 5. The first matching include rule turns it on (with the rule's variant for multivariate).
 * 6. Percentage flags: deterministic bucket < rollout. Multivariate: weighted variant by bucket.
 * 7. Boolean flags: the configured default.
 * Multivariate flags serve their default variant (see `defaultVariantKey`) whenever the result is off.
 */
export function evaluateFlag(
  snapshot: EvaluationSnapshot,
  flagKey: string,
  environment: Environment,
  user: UserContext,
  visiting: Set<string> = new Set(),
): EvaluationResult | null {
  const flag = snapshot.flags.get(flagKey);
  const configs = snapshot.configs.get(flagKey);
  if (!flag || !configs) return null;
  const config = configs[environment];
  const fallbackVariant = defaultVariantKey(flag);
  const off = (reason: EvaluationReason, explanation: string, match: EvaluationMatch | null = null) =>
    result(flag, environment, user, false, fallbackVariant, reason,
      fallbackVariant ? `${explanation} Serving default variant "${fallbackVariant}".` : explanation, match);

  if (flag.status === 'archived') return off('FLAG_ARCHIVED', 'Flag is archived.');
  if (!config.enabled) return off('FLAG_DISABLED', `Flag is disabled in ${environment}.`);

  // Validation forbids cycles; the guard keeps a corrupted database from recursing forever.
  visiting.add(flagKey);
  for (const prerequisiteKey of config.prerequisites) {
    const prerequisite = visiting.has(prerequisiteKey)
      ? null
      : evaluateFlag(snapshot, prerequisiteKey, environment, user, visiting);
    if (!prerequisite?.enabled) {
      visiting.delete(flagKey);
      return off(
        'PREREQUISITE_FAILED',
        `Prerequisite "${prerequisiteKey}" is not enabled for this user${prerequisite ? ` (${prerequisite.reason})` : ''}.`,
        { type: 'prerequisite', prerequisiteKey },
      );
    }
  }
  visiting.delete(flagKey);

  const matches = (conditions: Condition[]) =>
    conditions.every((c) => matchesCondition(c, user, snapshot.segments));

  const exclusion = config.rules.find((r) => r.effect === 'exclude' && matches(r.conditions));
  if (exclusion) {
    return off('TARGETING_EXCLUDED', `Excluded by rule "${exclusion.description || exclusion.id}".`, {
      type: 'rule',
      ruleId: exclusion.id,
      ruleDescription: exclusion.description,
    });
  }

  const inclusion = config.rules.find((r) => r.effect === 'include' && matches(r.conditions));
  if (inclusion) {
    const variant = flag.type === 'multivariate' ? (inclusion.variant ?? fallbackVariant) : null;
    return result(
      flag,
      environment,
      user,
      true,
      variant,
      'TARGETING_MATCH',
      `Included by rule "${inclusion.description || inclusion.id}"${variant ? ` → variant "${variant}"` : ''}.`,
      { type: 'rule', ruleId: inclusion.id, ruleDescription: inclusion.description },
    );
  }

  if (flag.type === 'percentage') {
    const bucket = bucketFor(flag.key, user.userId);
    const percentage = config.rolloutPercentage ?? 0;
    const match: EvaluationMatch = { type: 'rollout', bucket, rolloutPercentage: percentage };
    return bucket < percentage
      ? result(flag, environment, user, true, null, 'ROLLOUT_INCLUDED', `User bucket ${bucket} is within the ${percentage}% rollout.`, match)
      : off('ROLLOUT_EXCLUDED', `User bucket ${bucket} is outside the ${percentage}% rollout.`, match);
  }

  if (flag.type === 'multivariate') {
    const bucket = bucketFor(flag.key, user.userId);
    const weights = config.variantWeights ?? {};
    let cumulative = 0;
    // Iterate in the flag's declared variant order so assignment does not depend on JSON key order.
    for (const variant of flag.variants) {
      cumulative += weights[variant.key] ?? 0;
      if (bucket < cumulative) {
        return result(flag, environment, user, true, variant.key, 'VARIANT_ASSIGNED',
          `User bucket ${bucket} falls in variant "${variant.key}" (${weights[variant.key]}%).`,
          { type: 'variant', bucket });
      }
    }
    // Only reachable if weights don't total 100, which validation prevents.
    return result(flag, environment, user, true, fallbackVariant, 'DEFAULT', 'Weights did not cover the user bucket; serving default variant.', { type: 'default', bucket });
  }

  const enabled = config.defaultEnabled ?? false;
  return result(flag, environment, user, enabled, null, 'DEFAULT',
    enabled ? 'No rule matched; flag default is on.' : 'No rule matched; flag default is off.',
    { type: 'default' });
}
