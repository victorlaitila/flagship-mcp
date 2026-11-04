import type { ApiErrorBody, ValidationIssue } from '@flagship/shared';

/** A failed backend call, carrying the backend's error code so tools can explain it. */
export class FlagshipError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

export interface ApiResponse<T> {
  body: T;
  auditId: number | null;
}

/** Thin HTTP client for the Flagship REST API. Every request carries the configured identity. */
export class FlagshipApi {
  constructor(
    readonly baseUrl: string,
    readonly actorId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-actor-id': this.actorId },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new FlagshipError('UNAVAILABLE', `The Flagship API is not reachable at ${this.baseUrl}. Start it with \`npm run dev\` (or \`npm run dev -w @flagship/api\`).`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new FlagshipError('BAD_RESPONSE', `The Flagship API returned an unreadable response (HTTP ${res.status}).`);
    }
    if (!res.ok) {
      const error = (json as Partial<ApiErrorBody>)?.error;
      throw new FlagshipError(error?.code ?? 'BAD_RESPONSE', error?.message ?? `HTTP ${res.status}`, error?.issues ?? []);
    }
    const auditId = res.headers.get('x-audit-id');
    return { body: json as T, auditId: auditId === null ? null : Number(auditId) };
  }

  async get<T>(path: string): Promise<T> {
    return (await this.request<T>('GET', path)).body;
  }
}
