import type { ErrorCode, ValidationIssue } from '@flagship/shared';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CONFIRMATION_REQUIRED: 428,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues?: ValidationIssue[],
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found.`);
export const invalid = (issues: ValidationIssue[], message = 'Validation failed.') =>
  new AppError('VALIDATION_FAILED', message, issues);
