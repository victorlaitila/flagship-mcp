// Types and constants shared by the API and the web app.
// The API is the source of truth; these types describe its wire format.

export const ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
};

export const FLAG_TYPES = ['boolean', 'percentage', 'multivariate'] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

export const FLAG_TYPE_LABELS: Record<FlagType, string> = {
  boolean: 'Boolean',
  percentage: 'Percentage rollout',
  multivariate: 'Multivariate',
};

export type FlagStatus = 'active' | 'archived';

export interface Variant {
  key: string;
  name: string;
}

export interface Flag {
  id: string;
  key: string;
  name: string;
  description: string;
  type: FlagType;
  owner: string;
  tags: string[];
  status: FlagStatus;
  /**
   * Multivariate only. The FIRST variant is the default (fallback) variant: it is served whenever
   * the flag evaluates off. Variants are fixed at creation, so the default cannot change later.
   */
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
}

/** The variant a multivariate flag serves when it evaluates off. Null for other flag types. */
export function defaultVariantKey(flag: Pick<Flag, 'type' | 'variants'>): string | null {
  return flag.type === 'multivariate' ? (flag.variants[0]?.key ?? null) : null;
}

// ---------------------------------------------------------------------------
// Targeting

export const USER_ATTRIBUTES = ['userId', 'country', 'accountType', 'segment'] as const;
export type UserAttribute = (typeof USER_ATTRIBUTES)[number];

export const USER_ATTRIBUTE_LABELS: Record<UserAttribute, string> = {
  userId: 'User ID',
  country: 'Country',
  accountType: 'Account type',
  segment: 'Segment',
};

export const OPERATORS = ['equals', 'not_equals', 'in', 'not_in'] as const;
export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  in: 'is in list',
  not_in: 'is not in list',
};

export const ACCOUNT_TYPES = ['regular', 'premium', 'employee'] as const;

/** For `segment` conditions the values are segment keys and the user "value" is their segment membership. */
export interface Condition {
  attribute: UserAttribute;
  operator: Operator;
  values: string[];
}

export type RuleEffect = 'include' | 'exclude';

/** All conditions of a rule must match (AND). */
export interface TargetingRule {
  id: string;
  description: string;
  effect: RuleEffect;
  conditions: Condition[];
  /** Variant served by an include rule on a multivariate flag; null otherwise. */
  variant: string | null;
}

export interface EnvironmentConfig {
  enabled: boolean;
  /** Boolean flags: result for users matched by no rule. Null for other types. */
  defaultEnabled: boolean | null;
  /** Percentage flags: share of non-targeted users who get the feature (0–100). Null for other types. */
  rolloutPercentage: number | null;
  /** Multivariate flags: variant key -> weight (0–100, total 100). Null for other types. */
  variantWeights: Record<string, number> | null;
  rules: TargetingRule[];
  /** Keys of flags that must evaluate enabled for the same user and environment. */
  prerequisites: string[];
}

export interface FlagWithConfigs extends Flag {
  environments: Record<Environment, EnvironmentConfig>;
}

export interface UserContext {
  userId: string;
  country: string;
  accountType: string;
}

export interface DemoUser extends UserContext {
  name: string;
  email: string;
  description: string;
  loyaltyPoints: number;
}

export interface Segment {
  id: string;
  key: string;
  name: string;
  description: string;
  /** All conditions must match. `segment` is not allowed as an attribute here. */
  conditions: Condition[];
  createdAt: string;
  updatedAt: string;
}

export interface SegmentReference {
  flagKey: string;
  environment: Environment;
  ruleId: string;
}

export interface SegmentWithUsage extends Segment {
  matchingDemoUserIds: string[];
  references: SegmentReference[];
}

// ---------------------------------------------------------------------------
// Evaluation

export type EvaluationReason =
  | 'FLAG_ARCHIVED'
  | 'FLAG_DISABLED'
  | 'PREREQUISITE_FAILED'
  | 'TARGETING_EXCLUDED'
  | 'TARGETING_MATCH'
  | 'ROLLOUT_INCLUDED'
  | 'ROLLOUT_EXCLUDED'
  | 'VARIANT_ASSIGNED'
  | 'DEFAULT';

export interface EvaluationMatch {
  type: 'rule' | 'prerequisite' | 'rollout' | 'variant' | 'default';
  ruleId?: string;
  ruleDescription?: string;
  prerequisiteKey?: string;
  /** Deterministic bucket of the user for this flag, 0–99.99. */
  bucket?: number;
  rolloutPercentage?: number;
}

export interface EvaluationResult {
  flagKey: string;
  environment: Environment;
  userId: string;
  enabled: boolean;
  /** Multivariate flags always return a variant (the default variant when off); other types return null. */
  variant: string | null;
  reason: EvaluationReason;
  explanation: string;
  match: EvaluationMatch | null;
}

// ---------------------------------------------------------------------------
// Identity & permissions

export const ROLES = ['developer', 'release_manager', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  developer: 'Developer',
  release_manager: 'Release Manager',
  admin: 'Admin',
};

export const ROLE_ENVIRONMENTS: Record<Role, readonly Environment[]> = {
  developer: ['development'],
  release_manager: ['development', 'staging'],
  admin: ENVIRONMENTS,
};

export function canManageEnvironment(role: Role, environment: Environment): boolean {
  return ROLE_ENVIRONMENTS[role].includes(environment);
}

/** Archiving flags and editing segments affect production, so they require admin. */
export function canManageGlobalConfig(role: Role): boolean {
  return role === 'admin';
}

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

// ---------------------------------------------------------------------------
// Audit

export const AUDIT_OPERATIONS = [
  'flag.created',
  'flag.updated',
  'flag.archived',
  'flag.restored',
  'config.updated',
  'config.rolled_back',
  'segment.created',
  'segment.updated',
  'segment.deleted',
] as const;
export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];

export interface AuditEntry {
  id: number;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  operation: AuditOperation;
  flagKey: string | null;
  segmentKey: string | null;
  environment: Environment | null;
  previous: unknown;
  next: unknown;
  /** Set on `config.rolled_back` entries: the entry whose previous configuration was restored. */
  rollbackOf: number | null;
}

// ---------------------------------------------------------------------------
// API payloads

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CONFIRMATION_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    issues?: ValidationIssue[];
    details?: unknown;
  };
}

export interface CreateFlagInput {
  key: string;
  name: string;
  description: string;
  type: FlagType;
  owner: string;
  tags: string[];
  variants?: Variant[];
}

export interface UpdateFlagInput {
  name?: string;
  description?: string;
  owner?: string;
  tags?: string[];
}

export interface UpdateConfigInput {
  config: EnvironmentConfig;
  /** Required (true) for production changes. */
  confirmProduction?: boolean;
}

export interface SegmentInput {
  key: string;
  name: string;
  description: string;
  conditions: Condition[];
}

export interface PreviewInput {
  config: EnvironmentConfig;
  /** Demo user ids to evaluate; defaults to all demo users. */
  userIds?: string[];
}

export interface PreviewUserResult {
  user: DemoUser;
  current: EvaluationResult;
  proposed: EvaluationResult | null;
  changed: boolean;
}

export interface PreviewResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** The normalized configuration that saving this input would store; null when invalid. */
  config: EnvironmentConfig | null;
  results: PreviewUserResult[];
}

export type ConfigField = 'enabled' | 'default' | 'rollout' | 'variants' | 'rules' | 'prerequisites';

export interface EnvironmentComparisonRow {
  flag: FlagWithConfigs;
  differences: ConfigField[];
}

export interface ChangeEvent {
  entity: 'flag' | 'config' | 'segment';
  auditId: number;
  flagKey?: string;
  segmentKey?: string;
  environment?: Environment;
}
