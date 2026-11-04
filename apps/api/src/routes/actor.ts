import type { Actor } from '@flagship/shared';
import type { Request } from 'express';
import { ACTORS, SERVICE_ACTORS } from '../demo.js';
import { AppError } from '../errors.js';

/** Simulated identity: the client picks a demo actor and sends its id. Permissions are derived server-side from it. */
export function requireActor(req: Request): Actor {
  const id = req.header('x-actor-id');
  const actor = [...ACTORS, ...SERVICE_ACTORS].find((a) => a.id === id);
  if (!actor) throw new AppError('UNAUTHENTICATED', 'Select a demo identity (X-Actor-Id header) to make changes.');
  return actor;
}
