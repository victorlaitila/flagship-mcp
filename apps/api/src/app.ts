import type { ApiErrorBody, ChangeEvent } from '@flagship/shared';
import express, { type ErrorRequestHandler } from 'express';
import { ACTORS, DEMO_USERS } from './demo.js';
import { AppError } from './errors.js';
import { auditRoutes } from './routes/audit.js';
import { evaluationRoutes } from './routes/evaluation.js';
import { flagRoutes } from './routes/flags.js';
import { segmentRoutes } from './routes/segments.js';
import type { ServiceContext } from './services/context.js';
import { requireActor } from './routes/actor.js';
import { parseEnvironment } from './services/evaluation.js';
import { compareEnvironments } from './services/flags.js';

/** Keep in sync with the web client's watchdog (`STALE_AFTER_MS` in apps/web/src/hooks/useLive.ts). */
export const SSE_HEARTBEAT_MS = 5000;

export function createApp(ctx: ServiceContext): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => void res.json({ ok: true }));
  app.get('/api/actors', (_req, res) => void res.json(ACTORS));
  app.get('/api/demo-users', (_req, res) => void res.json(DEMO_USERS));
  app.get('/api/whoami', (req, res) => void res.json(requireActor(req)));
  // ?environments=staging,production compares just those; default compares all three.
  app.get('/api/environments/compare', (req, res) => {
    const environments = typeof req.query.environments === 'string'
      ? [...new Set(req.query.environments.split(',').map(parseEnvironment))]
      : undefined;
    if (environments && environments.length < 2) throw new AppError('BAD_REQUEST', 'Compare at least two different environments.');
    res.json(compareEnvironments(ctx, environments));
  });
  app.use('/api/flags', flagRoutes(ctx));
  app.use('/api/segments', segmentRoutes(ctx));
  app.use('/api/audit', auditRoutes(ctx));
  app.use('/api/evaluate', evaluationRoutes(ctx));

  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    const send = (event: ChangeEvent) => res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = ctx.notifier.subscribe(send);
    // A named event (unlike an SSE comment) reaches client code, which uses it to detect a dead stream.
    const heartbeat = setInterval(() => res.write('event: heartbeat\ndata: {}\n\n'), SSE_HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'Endpoint not found.')));

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof AppError) {
      const body: ApiErrorBody = { error: { code: error.code, message: error.message, issues: error.issues, details: error.details } };
      return void res.status(error.status).json(body);
    }
    if (error?.type === 'entity.parse.failed') {
      return void res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body.' } } satisfies ApiErrorBody);
    }
    console.error(error);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error.' } } satisfies ApiErrorBody);
  };
  app.use(onError);
  return app;
}
