/**
 * `startHostedApp()` — the real hosted pipeline for a hosted test file: the
 * production `buildHostedDeps()` (pool, pending-migration check, a real
 * Better Auth from `createAuth`) on a `withTestDb()` schema, passed to the
 * production `buildApp()` and bound to an ephemeral port. Only the email
 * sender is replaced (an in-memory list), so nothing reaches the network.
 *
 * Requests go through `node:http` (a spoofed Host or Origin needs it; see
 * routes.test.ts's header) with a hard per-request timeout: a hang, such as
 * Better Auth mounted after `express.json` (better-auth #3295), fails the test
 * instead of stalling it (spec "Hosted middleware order": 2 s).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { EmailMessage } from '../../auth.js';
import { buildApp, buildHostedDeps, type AppConfig, type HostedDeps } from '../../server.js';
import type { TestDb } from './withTestDb.js';

export const PUBLIC_URL = 'https://play.example';
export const SECRET = 'fake-better-auth-secret-hosted-order-tests-9fQ2mZ7x';
export const SESSION_COOKIE = '__Secure-better-auth.session_token';
export const REQUEST_TIMEOUT_MS = 2000;

export interface HostedAppOptions {
  /** Per-IP limit (step 6). High by default so it never interferes. */
  ratePerMinute?: number;
  /** Per-user limit (step 12). */
  userRatePerMinute?: number;
  trustProxy?: AppConfig['TRUST_PROXY'];
  staticDir?: string;
  /** The limiters' clock. */
  now?: () => number;
  /**
   * `DELETE /api/account` (step 14). Omitted: the route is NOT mounted (the
   * production deps' function is stripped, so 06-04's "absent → 404" pin keeps
   * testing `buildApp`'s condition). A function: a spy replaces it. `'real'`:
   * the production `requestAccountDeletion` that `buildHostedDeps` built.
   */
  requestAccountDeletion?: HostedDeps['requestAccountDeletion'] | 'real';
}

export interface Result {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: unknown;
}

export interface RequestOptions {
  method: string;
  path: string;
  headers?: Record<string, string>;
  /** Serialised as JSON, with a JSON content type. */
  json?: unknown;
  /** Sent as is (overrides `json`). */
  raw?: string;
}

export interface HostedApp {
  port: number;
  deps: HostedDeps;
  sent: EmailMessage[];
  request(options: RequestOptions): Promise<Result>;
  /** Signs in (creating the account first if needed); returns the `Cookie` header value. */
  signIn(email?: string): Promise<{ cookie: string; userId: string; email: string }>;
  close(): Promise<void>;
}

export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

function httpRequest(port: number, options: RequestOptions): Promise<Result> {
  const body = options.raw ?? (options.json === undefined ? undefined : JSON.stringify(options.json));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: {
          ...(body !== undefined
            ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }
            : {}),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          clearTimeout(timer);
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data, json });
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new Error(`${options.method} ${options.path} timed out after ${REQUEST_TIMEOUT_MS} ms`));
    }, REQUEST_TIMEOUT_MS);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export function setCookies(res: Result): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : raw;
}

export async function startHostedApp(db: TestDb, options: HostedAppOptions = {}): Promise<HostedApp> {
  const sent: EmailMessage[] = [];
  const deps = await buildHostedDeps({
    databaseUrl: db.url,
    schema: db.schema,
    betterAuthSecret: SECRET,
    resendApiKey: 're_fake_resend_key_never_used_0000',
    publicOrigin: PUBLIC_URL,
    emailFrom: 'Soulbound <auth@play.example>',
    userRateLimitPerMinute: options.userRatePerMinute ?? 600,
    redact: (input) => input,
    sendEmail: async (message) => {
      sent.push(message);
    },
  });
  const { requestAccountDeletion: realDeletion, ...withoutDeletion } = deps;
  const hosted: HostedDeps =
    options.requestAccountDeletion === undefined
      ? withoutDeletion
      : options.requestAccountDeletion === 'real'
        ? { ...withoutDeletion, ...(realDeletion === undefined ? {} : { requestAccountDeletion: realDeletion }) }
        : { ...withoutDeletion, requestAccountDeletion: options.requestAccountDeletion };
  const app = buildApp({
    FRONTEND_ORIGIN: PUBLIC_URL,
    ALLOWED_HOSTS: ['127.0.0.1'],
    redact: (input) => input,
    checkPassphrase: () => {
      throw new Error('checkPassphrase called in hosted mode');
    },
    RATE_LIMIT_PER_MINUTE: options.ratePerMinute ?? 600,
    TRUST_PROXY: options.trustProxy ?? false,
    ...(options.staticDir === undefined ? {} : { STATIC_DIR: options.staticDir }),
    ...(options.now === undefined ? {} : { now: options.now }),
    hosted,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;

  const request = (o: RequestOptions) => httpRequest(port, o);

  const signIn = async (emailIn?: string) => {
    const email = (emailIn ?? uniqueEmail('player')).toLowerCase();
    const existing = await deps.pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
    if (existing.rows.length === 0) {
      await deps.pool.query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, '', $2, true)`, [
        randomUUID(),
        email,
      ]);
    }
    const send = await request({
      method: 'POST',
      path: '/api/auth/sign-in/magic-link',
      json: { email },
      headers: { origin: PUBLIC_URL },
    });
    if (send.status !== 200) throw new Error(`magic-link send answered ${send.status}`);
    const message = [...sent].reverse().find((m) => m.to === email);
    const url = message === undefined ? null : /https:\/\/\S+/.exec(message.text);
    if (url === null) throw new Error(`no magic link was sent to ${email}`);
    const link = new URL(url[0]);
    const verify = await request({ method: 'GET', path: `${link.pathname}${link.search}` });
    const session = setCookies(verify).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (session === undefined) throw new Error(`verify answered ${verify.status} with no session cookie`);
    const { rows } = await deps.pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
    return { cookie: session.split(';')[0]!, userId: rows[0]!.id, email };
  };

  return {
    port,
    deps: hosted,
    sent,
    request,
    signIn,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await deps.pool.end();
    },
  };
}
