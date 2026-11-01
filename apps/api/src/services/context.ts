import { canManageEnvironment, canManageGlobalConfig, ENVIRONMENT_LABELS, ROLE_LABELS, type Actor, type Environment } from '@flagship/shared';
import type { Db } from '../database/db.js';
import { AppError } from '../errors.js';
import type { ChangeNotifier } from '../events.js';

export interface ServiceContext {
  db: Db;
  notifier: ChangeNotifier;
  now: () => Date;
}

export function assertCanManageEnvironment(actor: Actor, environment: Environment): void {
  if (!canManageEnvironment(actor.role, environment)) {
    throw new AppError('FORBIDDEN', `${ROLE_LABELS[actor.role]}s cannot change ${ENVIRONMENT_LABELS[environment]}.`);
  }
}

export function assertCanManageGlobal(actor: Actor, what: string): void {
  if (!canManageGlobalConfig(actor.role)) {
    throw new AppError('FORBIDDEN', `Only admins can ${what}.`);
  }
}

export function assertProductionConfirmed(environment: Environment, confirmed: unknown): void {
  if (environment === 'production' && confirmed !== true) {
    throw new AppError('CONFIRMATION_REQUIRED', 'Production changes require explicit confirmation (confirmProduction: true).');
  }
}
