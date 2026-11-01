import { Router } from 'express';
import type { ServiceContext } from '../services/context.js';
import { evaluateAll, evaluateOne, parseEnvironment, resolveUser } from '../services/evaluation.js';

/**
 * GET  /api/evaluate?environment=&userId=           all flags for a demo user
 * POST /api/evaluate { environment, user }           all flags for any user context
 * GET  /api/evaluate/:flagKey?environment=&userId=  (and POST) a single flag
 */
export function evaluationRoutes(ctx: ServiceContext): Router {
  const router = Router();
  router.get('/', (req, res) =>
    void res.json(evaluateAll(ctx.db, parseEnvironment(req.query.environment), resolveUser(req.query.userId))));
  router.post('/', (req, res) =>
    void res.json(evaluateAll(ctx.db, parseEnvironment(req.body?.environment), resolveUser(req.body?.user))));
  router.get('/:flagKey', (req, res) =>
    void res.json(evaluateOne(ctx.db, req.params.flagKey, parseEnvironment(req.query.environment), resolveUser(req.query.userId))));
  router.post('/:flagKey', (req, res) =>
    void res.json(evaluateOne(ctx.db, req.params.flagKey, parseEnvironment(req.body?.environment), resolveUser(req.body?.user))));
  return router;
}
