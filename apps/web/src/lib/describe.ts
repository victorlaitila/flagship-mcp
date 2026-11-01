import {
  OPERATOR_LABELS,
  USER_ATTRIBUTE_LABELS,
  type Condition,
  type ConfigField,
  type EnvironmentConfig,
  type EvaluationReason,
  type TargetingRule,
} from '@flagship/shared';

export const conditionText = (c: Condition) =>
  `${USER_ATTRIBUTE_LABELS[c.attribute]} ${OPERATOR_LABELS[c.operator]} ${c.values.join(', ')}`;

export const ruleText = (r: TargetingRule) =>
  `${r.effect === 'include' ? 'Include' : 'Exclude'} if ${r.conditions.map(conditionText).join(' and ')}${r.variant ? ` → ${r.variant}` : ''}`;

export interface ConfigLine {
  field: ConfigField;
  label: string;
  values: string[];
}

/** Human-readable lines for the fields that apply to a config (null fields are omitted). */
export function configLines(c: EnvironmentConfig): ConfigLine[] {
  const lines: ConfigLine[] = [{ field: 'enabled', label: 'Status', values: [c.enabled ? 'Enabled' : 'Disabled'] }];
  if (c.defaultEnabled !== null) lines.push({ field: 'default', label: 'Default', values: [c.defaultEnabled ? 'Serve on' : 'Serve off'] });
  if (c.rolloutPercentage !== null) lines.push({ field: 'rollout', label: 'Rollout', values: [`${c.rolloutPercentage}%`] });
  if (c.variantWeights) {
    lines.push({ field: 'variants', label: 'Weights', values: Object.entries(c.variantWeights).map(([k, w]) => `${k} ${w}%`) });
  }
  lines.push({ field: 'rules', label: 'Rules', values: c.rules.length ? c.rules.map(ruleText) : ['None'] });
  lines.push({ field: 'prerequisites', label: 'Prerequisites', values: c.prerequisites.length ? c.prerequisites : ['None'] });
  return lines;
}

/** Short summary used in table cells, e.g. "25%" or "60 / 40". */
export function servingSummary(c: EnvironmentConfig): string | null {
  if (c.rolloutPercentage !== null) return `${c.rolloutPercentage}%`;
  if (c.variantWeights) return Object.values(c.variantWeights).join(' / ');
  if (c.defaultEnabled !== null && c.rules.length > 0) return c.defaultEnabled ? 'all + rules' : 'targeted';
  return null;
}

export const REASON_LABELS: Record<EvaluationReason, string> = {
  FLAG_ARCHIVED: 'Archived',
  FLAG_DISABLED: 'Disabled',
  PREREQUISITE_FAILED: 'Prerequisite',
  TARGETING_EXCLUDED: 'Excluded',
  TARGETING_MATCH: 'Targeted',
  ROLLOUT_INCLUDED: 'In rollout',
  ROLLOUT_EXCLUDED: 'Out of rollout',
  VARIANT_ASSIGNED: 'Variant split',
  DEFAULT: 'Default',
};
