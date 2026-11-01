import { Router } from 'express';
import { AppError } from '../errors.js';
import * as audit from '../services/audit.js';
import type { ServiceContext } from '../services/context.js';
import { requireActor } from './actor.js';

export function auditRoutes(ctx: ServiceContext): Router {
  const router = Router();
  router.get('/', (req, res) => void res.json(audit.listAudit(ctx, req.query)));
  router.post('/:id/rollback', (req, res) => {
    const actor = requireActor(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError('BAD_REQUEST', 'Audit id must be an integer.');
    res.json(audit.rollback(ctx, actor, id, req.body?.confirmProduction));
  });
  return router;
}
