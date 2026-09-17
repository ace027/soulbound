/**
 * The Soulbound Chronicles backend entrypoint.
 *
 * Express app, JSON body parsing, a CORS policy for the frontend dev origin,
 * the health check, and a central error handler. Phase 2 adds the three
 * World Voice routes; this file stays minimal on purpose.
 */

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

async function main(): Promise<void> {
  // config.ts reads ANTHROPIC_API_KEY once, at import time, and throws a
  // clear, actionable error if it's missing. Importing it dynamically here
  // (rather than as a static top-level import) lets us report that failure
  // as a clean one-line message instead of a raw stack trace, while still
  // exiting non-zero before the app is built or the port is bound.
  let config: typeof import('./config.js');
  try {
    config = await import('./config.js');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const { PORT, FRONTEND_ORIGIN, redact } = config;

  const app = express();

  // CORS: allow only the configured frontend origin (defaults to Vite's dev
  // port). No `cors` package — this is the entire policy the plan asks for.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // Unmatched routes. Without this, Express answers with its default HTML
  // error page, which a JSON client cannot parse — the frontend's fetch
  // wrapper would fail on JSON.parse rather than surfacing a clean 404.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: { message: 'Not found', code: 'NOT_FOUND' },
    });
  });

  // Central error handler. Never forwards a stack trace, the API key, or a
  // raw upstream provider error body to the client — those are logged
  // server-side (redacted) and replaced with a sanitized shape.
  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const apiErr = err as ApiError;
    const statusCode = apiErr.statusCode ?? 500;
    const code = apiErr.code ?? (statusCode === 500 ? 'INTERNAL_ERROR' : 'ERROR');

    const rawMessage = err instanceof Error ? err.message : String(err);
    const rawStack = err instanceof Error ? err.stack : undefined;

    console.error(`[error] ${req.method} ${req.path}:`, redact(rawStack ?? rawMessage));

    const clientMessage = statusCode === 500 ? 'Internal server error' : redact(rawMessage);

    res.status(statusCode).json({
      error: {
        message: clientMessage,
        code,
      },
    });
  };

  app.use(errorHandler);

  app.listen(PORT, () => {
    console.log(`[soulbound-backend] listening on port ${PORT}`);
  });
}

main();
