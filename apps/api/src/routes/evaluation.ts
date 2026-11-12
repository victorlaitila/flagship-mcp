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
  router.get('/', async (req, res) =>
    void res.json(await evaluateAll(ctx.store, parseEnvironment(req.query.environment), resolveUser(req.query.userId))));
  router.post('/', async (req, res) =>
    void res.json(await evaluateAll(ctx.store, parseEnvironment(req.body?.environment), resolveUser(req.body?.user))));
  router.get('/:flagKey', async (req, res) =>
    void res.json(await evaluateOne(ctx.store, req.params.flagKey, parseEnvironment(req.query.environment), resolveUser(req.query.userId))));
  router.post('/:flagKey', async (req, res) =>
    void res.json(await evaluateOne(ctx.store, req.params.flagKey, parseEnvironment(req.body?.environment), resolveUser(req.body?.user))));
  return router;
}
