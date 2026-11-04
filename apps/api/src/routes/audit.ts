import { Router } from 'express';
import { AppError } from '../errors.js';
import * as audit from '../services/audit.js';
import type { ServiceContext } from '../services/context.js';
import { requireActor } from './actor.js';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw new AppError('BAD_REQUEST', 'Audit id must be an integer.');
  return id;
}

export function auditRoutes(ctx: ServiceContext): Router {
  const router = Router();
  router.get('/', (req, res) => void res.json(audit.listAudit(ctx, req.query)));
  router.get('/:id', (req, res) => void res.json(audit.getAudit(ctx, parseId(req.params.id))));
  router.post('/:id/rollback', (req, res) => {
    const actor = requireActor(req);
    const { config, auditId } = audit.rollback(ctx, actor, parseId(req.params.id), req.body?.confirmProduction, req.body?.expectedConfig);
    if (auditId !== null) res.set('X-Audit-Id', String(auditId));
    res.json(config);
  });
  return router;
}
