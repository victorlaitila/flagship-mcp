import type { ErrorCode, ValidationIssue } from '@flagship/shared';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CONFIRMATION_REQUIRED: 428,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
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
/** A store refused a commit because something else was committed after the service read its revision. */
export const changedMeanwhile = () =>
  new AppError('CONFLICT', 'Flagship changed while this change was being saved, so nothing was saved. Review the current state and try again.');
export const invalid = (issues: ValidationIssue[], message = 'Validation failed.') =>
  new AppError('VALIDATION_FAILED', message, issues);
