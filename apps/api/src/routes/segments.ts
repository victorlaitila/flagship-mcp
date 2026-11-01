import { Router } from 'express';
import type { ServiceContext } from '../services/context.js';
import * as segments from '../services/segments.js';
import { requireActor } from './actor.js';

export function segmentRoutes(ctx: ServiceContext): Router {
  const router = Router();
  router.get('/', (_req, res) => void res.json(segments.listSegments(ctx)));
  router.post('/', (req, res) => void res.status(201).json(segments.createSegment(ctx, requireActor(req), req.body)));
  router.get('/:key', (req, res) => void res.json(segments.getSegment(ctx, req.params.key)));
  router.put('/:key', (req, res) => void res.json(segments.updateSegment(ctx, requireActor(req), req.params.key, req.body)));
  router.delete('/:key', (req, res) => {
    segments.deleteSegment(ctx, requireActor(req), req.params.key);
    res.status(204).end();
  });
  return router;
}
