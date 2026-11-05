import type {
  Actor,
  ApiErrorBody,
  AuditEntry,
  AuditOperation,
  CreateFlagInput,
  DemoUser,
  Environment,
  EnvironmentComparisonRow,
  EnvironmentConfig,
  EvaluationResult,
  FlagWithConfigs,
  PreviewResult,
  SegmentInput,
  SegmentWithUsage,
  UpdateFlagInput,
  ValidationIssue,
} from '@flagship/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorBody['error']['code'],
    message: string,
    readonly issues: ValidationIssue[] = [],
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let actorId: string | null = null;
/** The dashboard's selected demo identity; sent with every request. */
export const setActorId = (id: string | null) => {
  actorId = id;
};

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(actorId ? { 'X-Actor-Id': actorId } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'INTERNAL', 'Cannot reach the Flagship API. Is it running?');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, error?.code ?? 'INTERNAL', error?.message ?? `Request failed (${res.status})`, error?.issues, error?.details);
  }
  return data as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return search.size ? `?${search}` : '';
};

export const api = {
  actors: () => request<Actor[]>('/actors'),
  demoUsers: () => request<DemoUser[]>('/demo-users'),

  flags: () => request<FlagWithConfigs[]>('/flags'),
  flag: (key: string) => request<FlagWithConfigs>(`/flags/${key}`),
  createFlag: (input: CreateFlagInput) => request<FlagWithConfigs>('/flags', { method: 'POST', body: input }),
  updateFlag: (key: string, input: UpdateFlagInput) => request<FlagWithConfigs>(`/flags/${key}`, { method: 'PATCH', body: input }),
  archiveFlag: (key: string, confirmProduction = false) =>
    request<FlagWithConfigs>(`/flags/${key}/archive`, { method: 'POST', body: { confirmProduction } }),
  restoreFlag: (key: string, confirmProduction = false) =>
    request<FlagWithConfigs>(`/flags/${key}/restore`, { method: 'POST', body: { confirmProduction } }),
  config: (key: string, env: Environment) => request<EnvironmentConfig>(`/flags/${key}/environments/${env}`),
  /** `expectedConfig` is the stored config the edit was based on; the API answers 409 CONFLICT if it changed since. */
  updateConfig: (key: string, env: Environment, config: EnvironmentConfig, expectedConfig: EnvironmentConfig, confirmProduction = false) =>
    request<EnvironmentConfig>(`/flags/${key}/environments/${env}`, { method: 'PUT', body: { config, expectedConfig, confirmProduction } }),
  previewConfig: (key: string, env: Environment, config: EnvironmentConfig) =>
    request<PreviewResult>(`/flags/${key}/environments/${env}/preview`, { method: 'POST', body: { config } }),
  compare: () => request<EnvironmentComparisonRow[]>('/environments/compare'),

  evaluate: (environment: Environment, userId: string) =>
    request<EvaluationResult[]>(`/evaluate${qs({ environment, userId })}`),
  evaluateFlag: (flagKey: string, environment: Environment, userId: string) =>
    request<EvaluationResult>(`/evaluate/${flagKey}${qs({ environment, userId })}`),

  segments: () => request<SegmentWithUsage[]>('/segments'),
  createSegment: (input: SegmentInput) => request<SegmentWithUsage>('/segments', { method: 'POST', body: input }),
  updateSegment: (key: string, input: SegmentInput) => request<SegmentWithUsage>(`/segments/${key}`, { method: 'PUT', body: input }),
  deleteSegment: (key: string) => request<void>(`/segments/${key}`, { method: 'DELETE' }),

  audit: (filter: { flagKey?: string; environment?: Environment; operation?: AuditOperation; limit?: number } = {}) =>
    request<AuditEntry[]>(`/audit${qs({ ...filter, limit: filter.limit?.toString() })}`),
  rollback: (id: number, expectedConfig: EnvironmentConfig, confirmProduction = false) =>
    request<EnvironmentConfig>(`/audit/${id}/rollback`, { method: 'POST', body: { expectedConfig, confirmProduction } }),
};
