import { Router } from 'express';
import type { ServiceContext } from '../services/context.js';
import { parseEnvironment } from '../services/evaluation.js';
import * as flags from '../services/flags.js';
import { requireActor } from './actor.js';

export function flagRoutes(ctx: ServiceContext): Router {
  const router = Router();
  router.get('/', async (_req, res) => void res.json(await flags.listFlags(ctx)));
  router.post('/', async (req, res) => void res.status(201).json(await flags.createFlag(ctx, requireActor(req), req.body)));
  router.get('/:key', async (req, res) => void res.json(await flags.getFlag(ctx, req.params.key)));
  router.patch('/:key', async (req, res) => void res.json(await flags.updateFlag(ctx, requireActor(req), req.params.key, req.body)));
  router.post('/:key/archive', async (req, res) => void res.json(await flags.setFlagStatus(ctx, requireActor(req), req.params.key, 'archived', req.body?.confirmProduction)));
  router.post('/:key/restore', async (req, res) => void res.json(await flags.setFlagStatus(ctx, requireActor(req), req.params.key, 'active', req.body?.confirmProduction)));
  router.get('/:key/environments/:env', async (req, res) =>
    void res.json(await flags.getConfig(ctx, req.params.key, parseEnvironment(req.params.env))));
  router.put('/:key/environments/:env', async (req, res) => {
    const actor = requireActor(req);
    const environment = parseEnvironment(req.params.env);
    const { config, auditId } = await flags.applyConfig(ctx, actor, req.params.key, environment, req.body?.config,
      req.body?.confirmProduction, { expectedConfig: req.body?.expectedConfig });
    if (auditId !== null) res.set('X-Audit-Id', String(auditId));
    res.json(config);
  });
  router.post('/:key/environments/:env/preview', async (req, res) =>
    void res.json(await flags.previewConfig(ctx, req.params.key, parseEnvironment(req.params.env), req.body?.config, req.body?.userIds)));
  return router;
}
