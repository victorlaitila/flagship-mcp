import { canManageEnvironment, canManageGlobalConfig, ENVIRONMENT_LABELS, PRODUCTION_READ_ONLY_MESSAGE, ROLE_LABELS, type Actor, type ChangeEvent, type Environment } from '@flagship/shared';
import type { Store } from '../database/store.js';
import { AppError } from '../errors.js';
import type { ChangePublisher } from '../events.js';

export interface ServiceContext {
  store: Store;
  notifier: ChangePublisher;
  now: () => Date;
  /** Public deployment: refuse every change that would alter Production evaluation. */
  productionReadOnly: boolean;
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

/** Checked wherever a change can alter Production evaluation, before Production confirmation. */
export function assertProductionWritable(ctx: ServiceContext): void {
  if (ctx.productionReadOnly) throw new AppError('FORBIDDEN', PRODUCTION_READ_ONLY_MESSAGE);
}

/** Announces a committed change. A failed delivery must not turn the saved change into an error response. */
export async function publishChange(ctx: ServiceContext, event: ChangeEvent): Promise<void> {
  try {
    await ctx.notifier.publish(event);
  } catch (error) {
    console.error('Publishing a change failed', error);
  }
}
