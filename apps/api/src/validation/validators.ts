import {
  FLAG_TYPES,
  OPERATORS,
  USER_ATTRIBUTES,
  type Condition,
  type CreateFlagInput,
  type EnvironmentConfig,
  type Flag,
  type FlagType,
  type SegmentInput,
  type TargetingRule,
  type UpdateFlagInput,
  type ValidationIssue,
  type Variant,
} from '@flagship/shared';

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

type Issues = ValidationIssue[];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export interface Validated<T> {
  value: T | null;
  issues: Issues;
}

function validateConditions(
  input: unknown,
  path: string,
  issues: Issues,
  segmentKeys: Set<string>,
  allowSegment: boolean,
): Condition[] {
  if (!Array.isArray(input) || input.length === 0) {
    issues.push({ path, message: 'At least one condition is required.' });
    return [];
  }
  return input.map((raw, i) => {
    const p = `${path}[${i}]`;
    if (!isRecord(raw)) {
      issues.push({ path: p, message: 'Condition must be an object.' });
      return { attribute: 'userId', operator: 'equals', values: [] };
    }
    const attribute = raw.attribute as Condition['attribute'];
    const operator = raw.operator as Condition['operator'];
    if (!USER_ATTRIBUTES.includes(attribute) || (!allowSegment && attribute === 'segment')) {
      const allowed = USER_ATTRIBUTES.filter((a) => allowSegment || a !== 'segment').join(', ');
      issues.push({ path: `${p}.attribute`, message: `Unsupported attribute "${String(raw.attribute)}". Use one of: ${allowed}.` });
    }
    if (!OPERATORS.includes(operator)) {
      issues.push({ path: `${p}.operator`, message: `Unsupported operator "${String(raw.operator)}". Use one of: ${OPERATORS.join(', ')}.` });
    }
    const values = isStringArray(raw.values) ? raw.values.map((v) => v.trim()).filter(Boolean) : [];
    if (values.length === 0) {
      issues.push({ path: `${p}.values`, message: 'At least one non-empty value is required.' });
    } else if ((operator === 'equals' || operator === 'not_equals') && values.length !== 1) {
      issues.push({ path: `${p}.values`, message: `Operator "${operator}" takes exactly one value.` });
    }
    if (attribute === 'segment') {
      for (const key of values) {
        if (!segmentKeys.has(key)) issues.push({ path: `${p}.values`, message: `Unknown segment "${key}".` });
      }
    }
    return { attribute, operator, values };
  });
}

export interface ConfigContext {
  flag: Flag;
  /** All flags, to resolve prerequisites. */
  flags: Map<string, Flag>;
  /** Prerequisites of every flag in the same environment (current, persisted state). */
  prerequisitesByFlag: Map<string, string[]>;
  segmentKeys: Set<string>;
}

/** Validates a proposed environment config and normalizes fields that do not apply to the flag type to null. */
export function validateEnvironmentConfig(input: unknown, ctx: ConfigContext): Validated<EnvironmentConfig> {
  const issues: Issues = [];
  const { flag } = ctx;
  if (!isRecord(input)) return { value: null, issues: [{ path: 'config', message: 'Config must be an object.' }] };

  if (typeof input.enabled !== 'boolean') issues.push({ path: 'enabled', message: 'Must be true or false.' });
  if (input.enabled === true && flag.status === 'archived') {
    issues.push({ path: 'enabled', message: 'Archived flags cannot be enabled.' });
  }

  let defaultEnabled: boolean | null = null;
  let rolloutPercentage: number | null = null;
  let variantWeights: Record<string, number> | null = null;

  if (flag.type === 'boolean') {
    if (typeof input.defaultEnabled !== 'boolean') {
      issues.push({ path: 'defaultEnabled', message: 'Boolean flags need a default (true or false).' });
    } else defaultEnabled = input.defaultEnabled;
  }

  if (flag.type === 'percentage') {
    const p = input.rolloutPercentage;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) {
      issues.push({ path: 'rolloutPercentage', message: 'Rollout must be a number between 0 and 100.' });
    } else rolloutPercentage = Math.round(p * 100) / 100;
  }

  if (flag.type === 'multivariate') {
    const w = input.variantWeights;
    if (!isRecord(w)) {
      issues.push({ path: 'variantWeights', message: 'Variant weights are required.' });
    } else {
      variantWeights = {};
      const known = new Set(flag.variants.map((v) => v.key));
      for (const key of Object.keys(w)) {
        if (!known.has(key)) issues.push({ path: `variantWeights.${key}`, message: `Unknown variant "${key}".` });
      }
      let total = 0;
      for (const { key } of flag.variants) {
        const weight = w[key];
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100) {
          issues.push({ path: `variantWeights.${key}`, message: 'Weight must be a number between 0 and 100.' });
          continue;
        }
        variantWeights[key] = weight;
        total += weight;
      }
      if (Math.abs(total - 100) > 0.001) {
        issues.push({ path: 'variantWeights', message: `Variant weights must total 100% (currently ${total}%).` });
      }
    }
  }

  const rules: TargetingRule[] = [];
  if (!Array.isArray(input.rules)) {
    issues.push({ path: 'rules', message: 'Rules must be a list.' });
  } else {
    const ids = new Set<string>();
    input.rules.forEach((raw, i) => {
      const p = `rules[${i}]`;
      if (!isRecord(raw)) return issues.push({ path: p, message: 'Rule must be an object.' });
      const id = nonEmpty(raw.id) ? raw.id : '';
      if (!id) issues.push({ path: `${p}.id`, message: 'Rule id is required.' });
      else if (ids.has(id)) issues.push({ path: `${p}.id`, message: `Duplicate rule id "${id}".` });
      ids.add(id);
      const effect = raw.effect;
      if (effect !== 'include' && effect !== 'exclude') {
        issues.push({ path: `${p}.effect`, message: 'Effect must be "include" or "exclude".' });
      }
      let variant: string | null = null;
      if (flag.type === 'multivariate' && effect === 'include') {
        if (typeof raw.variant !== 'string' || !flag.variants.some((v) => v.key === raw.variant)) {
          issues.push({ path: `${p}.variant`, message: 'Include rules on multivariate flags must select an existing variant.' });
        } else variant = raw.variant;
      }
      const conditions = validateConditions(raw.conditions, `${p}.conditions`, issues, ctx.segmentKeys, true);
      rules.push({
        id,
        description: typeof raw.description === 'string' ? raw.description.trim() : '',
        effect: effect as TargetingRule['effect'],
        conditions,
        variant,
      });
    });
  }

  let prerequisites: string[] = [];
  if (!isStringArray(input.prerequisites)) {
    issues.push({ path: 'prerequisites', message: 'Prerequisites must be a list of flag keys.' });
  } else {
    prerequisites = [...new Set(input.prerequisites)];
    for (const key of prerequisites) {
      const target = ctx.flags.get(key);
      if (key === flag.key) issues.push({ path: 'prerequisites', message: 'A flag cannot be its own prerequisite.' });
      else if (!target) issues.push({ path: 'prerequisites', message: `Prerequisite "${key}" does not exist.` });
      else if (target.status === 'archived') issues.push({ path: 'prerequisites', message: `Prerequisite "${key}" is archived.` });
    }
    const cycle = findCycle(flag.key, prerequisites, ctx.prerequisitesByFlag);
    if (cycle) issues.push({ path: 'prerequisites', message: `Circular prerequisite: ${cycle.join(' → ')}.` });
  }

  if (issues.length > 0) return { value: null, issues };
  return {
    value: { enabled: input.enabled as boolean, defaultEnabled, rolloutPercentage, variantWeights, rules, prerequisites },
    issues,
  };
}

/** Returns the cycle path if adding `prerequisites` to `flagKey` would create one. */
export function findCycle(
  flagKey: string,
  prerequisites: string[],
  prerequisitesByFlag: Map<string, string[]>,
): string[] | null {
  const graph = new Map(prerequisitesByFlag);
  graph.set(flagKey, prerequisites);
  const walk = (key: string, path: string[]): string[] | null => {
    for (const next of graph.get(key) ?? []) {
      if (next === flagKey) return [...path, next];
      if (path.includes(next)) continue;
      const found = walk(next, [...path, next]);
      if (found) return found;
    }
    return null;
  };
  return walk(flagKey, [flagKey]);
}

function validateTags(input: unknown, issues: Issues): string[] {
  if (!isStringArray(input)) {
    issues.push({ path: 'tags', message: 'Tags must be a list of strings.' });
    return [];
  }
  return [...new Set(input.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

export function validateCreateFlag(input: unknown, existingKeys: Set<string>): Validated<CreateFlagInput> {
  const issues: Issues = [];
  if (!isRecord(input)) return { value: null, issues: [{ path: '', message: 'Body must be an object.' }] };
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!KEY_PATTERN.test(key)) {
    issues.push({ path: 'key', message: 'Key must be 2–64 chars: lowercase letters, digits and underscores, starting with a letter.' });
  } else if (existingKeys.has(key)) issues.push({ path: 'key', message: `A flag with key "${key}" already exists.` });
  if (!nonEmpty(input.name)) issues.push({ path: 'name', message: 'Name is required.' });
  if (!nonEmpty(input.owner)) issues.push({ path: 'owner', message: 'Owner is required.' });
  const type = input.type as FlagType;
  if (!FLAG_TYPES.includes(type)) issues.push({ path: 'type', message: `Type must be one of: ${FLAG_TYPES.join(', ')}.` });
  const tags = validateTags(input.tags ?? [], issues);

  let variants: Variant[] = [];
  if (type === 'multivariate') {
    if (!Array.isArray(input.variants) || input.variants.length < 2) {
      issues.push({ path: 'variants', message: 'Multivariate flags need at least two variants.' });
    } else {
      const seen = new Set<string>();
      variants = input.variants.map((raw, i) => {
        const v = isRecord(raw) ? raw : {};
        const vKey = typeof v.key === 'string' ? v.key.trim() : '';
        if (!KEY_PATTERN.test(vKey)) issues.push({ path: `variants[${i}].key`, message: 'Variant key must be lowercase letters, digits and underscores.' });
        else if (seen.has(vKey)) issues.push({ path: `variants[${i}].key`, message: `Duplicate variant "${vKey}".` });
        seen.add(vKey);
        if (!nonEmpty(v.name)) issues.push({ path: `variants[${i}].name`, message: 'Variant name is required.' });
        return { key: vKey, name: typeof v.name === 'string' ? v.name.trim() : '' };
      });
    }
  }
  if (issues.length > 0) return { value: null, issues };
  return {
    value: {
      key,
      name: (input.name as string).trim(),
      description: typeof input.description === 'string' ? input.description.trim() : '',
      type,
      owner: (input.owner as string).trim(),
      tags,
      variants,
    },
    issues,
  };
}

export function validateUpdateFlag(input: unknown): Validated<UpdateFlagInput> {
  const issues: Issues = [];
  if (!isRecord(input)) return { value: null, issues: [{ path: '', message: 'Body must be an object.' }] };
  const value: UpdateFlagInput = {};
  if (input.name !== undefined) {
    if (!nonEmpty(input.name)) issues.push({ path: 'name', message: 'Name cannot be empty.' });
    else value.name = input.name.trim();
  }
  if (input.owner !== undefined) {
    if (!nonEmpty(input.owner)) issues.push({ path: 'owner', message: 'Owner cannot be empty.' });
    else value.owner = input.owner.trim();
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') issues.push({ path: 'description', message: 'Description must be text.' });
    else value.description = input.description.trim();
  }
  if (input.tags !== undefined) value.tags = validateTags(input.tags, issues);
  return issues.length > 0 ? { value: null, issues } : { value, issues };
}

export function validateSegment(
  input: unknown,
  existingKeys: Set<string>,
  currentKey: string | null,
): Validated<SegmentInput> {
  const issues: Issues = [];
  if (!isRecord(input)) return { value: null, issues: [{ path: '', message: 'Body must be an object.' }] };
  const key = currentKey ?? (typeof input.key === 'string' ? input.key.trim() : '');
  if (currentKey === null) {
    if (!KEY_PATTERN.test(key)) issues.push({ path: 'key', message: 'Key must be lowercase letters, digits and underscores.' });
    else if (existingKeys.has(key)) issues.push({ path: 'key', message: `A segment with key "${key}" already exists.` });
  }
  if (!nonEmpty(input.name)) issues.push({ path: 'name', message: 'Name is required.' });
  const conditions = validateConditions(input.conditions, 'conditions', issues, new Set(), false);
  if (issues.length > 0) return { value: null, issues };
  return {
    value: {
      key,
      name: (input.name as string).trim(),
      description: typeof input.description === 'string' ? input.description.trim() : '',
      conditions,
    },
    issues,
  };
}
