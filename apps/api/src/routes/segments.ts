import { Router } from 'express';
import type { ServiceContext } from '../services/context.js';
import * as segments from '../services/segments.js';
import { requireActor } from './actor.js';

export function segmentRoutes(ctx: ServiceContext): Router {
  const router = Router();
  router.get('/', async (_req, res) => void res.json(await segments.listSegments(ctx)));
  router.post('/', async (req, res) => void res.status(201).json(await segments.createSegment(ctx, requireActor(req), req.body)));
  router.get('/:key', async (req, res) => void res.json(await segments.getSegment(ctx, req.params.key)));
  router.put('/:key', async (req, res) => void res.json(await segments.updateSegment(ctx, requireActor(req), req.params.key, req.body)));
  router.delete('/:key', async (req, res) => {
    await segments.deleteSegment(ctx, requireActor(req), req.params.key);
    res.status(204).end();
  });
  return router;
}
