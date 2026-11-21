import type { ApiErrorBody, ServerSettings } from '@flagship/shared';
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

export function createApp(ctx: ServiceContext): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Generous for any real config (a few KB) while keeping abusive payloads out.
  app.use(express.json({ limit: '64kb' }));
  // Deeply nested input could overflow the stack in validation or messages; real bodies nest about 6 levels.
  app.use((req, _res, next) => next(nestedDeeperThan(req.body, 16) ? new AppError('BAD_REQUEST', 'Request body is nested too deeply.') : undefined));

  app.get('/api/health', (_req, res) => void res.json({ ok: true }));
  app.get('/api/actors', (_req, res) => void res.json(ACTORS));
  app.get('/api/demo-users', (_req, res) => void res.json(DEMO_USERS));
  app.get('/api/whoami', (req, res) => void res.json(requireActor(req)));
  app.get('/api/settings', (_req, res) => void res.json({ productionReadOnly: ctx.productionReadOnly } satisfies ServerSettings));
  // ?environments=staging,production compares just those; default compares all three.
  app.get('/api/environments/compare', async (req, res) => {
    const environments = typeof req.query.environments === 'string'
      ? [...new Set(req.query.environments.split(',').map(parseEnvironment))]
      : undefined;
    if (environments && environments.length < 2) throw new AppError('BAD_REQUEST', 'Compare at least two different environments.');
    res.json(await compareEnvironments(ctx, environments));
  });
  app.use('/api/flags', flagRoutes(ctx));
  app.use('/api/segments', segmentRoutes(ctx));
  app.use('/api/audit', auditRoutes(ctx));
  app.use('/api/evaluate', evaluationRoutes(ctx));

  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'Endpoint not found.')));

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof AppError) {
      const body: ApiErrorBody = { error: { code: error.code, message: error.message, issues: error.issues, details: error.details } };
      return void res.status(error.status).json(body);
    }
    if (error?.type === 'entity.parse.failed') {
      return void res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body.' } } satisfies ApiErrorBody);
    }
    if (error?.type === 'entity.too.large') {
      return void res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is larger than 64 KB.' } } satisfies ApiErrorBody);
    }
    // Other client errors raised by Express or body-parser (bad encoding, broken gzip, undecodable URL).
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
      return void res.status(error.status).json({ error: { code: 'BAD_REQUEST', message: 'Malformed request.' } } satisfies ApiErrorBody);
    }
    console.error(error);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error.' } } satisfies ApiErrorBody);
  };
  app.use(onError);
  return app;
}

/** Iterative, so that checking the depth can't overflow the stack itself. */
function nestedDeeperThan(value: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (typeof v !== 'object' || v === null) continue;
    if (depth >= max) return true;
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
  }
  return false;
}
