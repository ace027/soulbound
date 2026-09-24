/**
 * Hosted mode's account system: one Better Auth instance with every
 * security-relevant option set explicitly, invite-only sign-up, and a
 * magic-link sender that can't be used to spam or enumerate (spec R24a, R24c,
 * R24f). Built here, mounted by 06-04:
 *
 *   app.all('/api/auth/*splat', withInviteContext, handler)   // BEFORE express.json
 *
 * Why each option is what it is, with the installed-source line that proves
 * the option's name and default, is in 06-03-SUMMARY.md ("Task 1").
 *
 * Invite flow (Key Decisions → "Invite carrier", "Invite atomicity"):
 *  - `withInviteContext` verifies the `__Host-sb_invite` cookie and runs the
 *    rest of the request inside `inviteContext` (AsyncLocalStorage). Task 1
 *    proved the store is visible in `sendMagicLink` and in every database
 *    hook (hosted/alsPropagation.test.ts).
 *  - `user.create.before` refuses a missing or unverified email, then needs a
 *    valid invite and reserves it for the cookie's nonce.
 *  - `user.create.after` consumes the reservation. If that fails, it deletes
 *    the user it was called for (compensation) and throws.
 *  Every method (magic link, Google, Discord) creates users through the same
 *  hook, so this is the single gate (spec Open Question 3).
 *
 * `better-auth` is imported dynamically inside `createAuth`, so importing this
 * module loads nothing hosted (the same rule as db.ts).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { INVITE_INVALID, INVITE_REQUIRED } from '@soulbound/shared';
import { cancelAccountDeletion } from './account.js';
import {
  COOKIE_NAME,
  consumeInvite as consumeInviteSql,
  inviteCookieKey,
  inviteUsable,
  normalizeEmail,
  readInviteCookie,
  reserveInvite,
  verifyInviteCookie,
  type InvitePayload,
  type Queryable,
} from './invites.js';

/** One outgoing email. */
export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** Sends one email. Production: `createResendSender`; tests: a spy. */
export type SendEmail = (message: EmailMessage) => Promise<void>;

/** What the invite wrapper puts in AsyncLocalStorage for the request. */
export interface InviteStore {
  invite?: InvitePayload;
  ip?: string;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AuthDeps {
  pool: Pool;
  /** `BETTER_AUTH_URL`: a bare https origin (config.ts validates it). */
  publicUrl: string;
  /** `BETTER_AUTH_SECRET`. Also the HKDF input for the invite cookie's key. */
  secret: string;
  emailFrom: string;
  sendEmail: SendEmail;
  google?: OAuthCredentials;
  discord?: OAuthCredentials;
  /** Clock (epoch ms) for the invite cookie's expiry and the send limiters. */
  now?: () => number;
  /** Called after every session is created, after the hook has cancelled any pending deletion. */
  onSessionCreated?: (userId: string) => Promise<void> | void;
  /** Test seam: replaces the consume step, to inject an `after` failure. */
  consumeInvite?: typeof consumeInviteSql;
  /** config.ts's `redact()`, applied to every line Better Auth logs. */
  redact?: (input: string) => string;
}

/** Session lifetime: 30 days, rolling (spec R24a). */
export const SESSION_EXPIRES_IN_SECONDS = 2_592_000;
/** How often a used session's expiry is pushed forward: daily. */
export const SESSION_UPDATE_AGE_SECONDS = 86_400;
/** Magic-link sends allowed per email address, and per invite nonce, per window. */
export const MAGIC_LINK_SENDS_PER_WINDOW = 3;
/** The send limiters' window: 15 minutes. */
export const MAGIC_LINK_WINDOW_MS = 15 * 60_000;
/** Most keys each send limiter tracks before new keys share one overflow bucket. */
const MAX_TRACKED_KEYS = 10_000;
const OVERFLOW_KEY = '\u0000overflow';

/** The only message a sign-up without a usable invite cookie ever gets (spec "Invite carrier"). */
export const INVITE_REQUIRED_MESSAGE =
  'An invite is required to create an account. Open the sign-in link in the browser where you entered your invite.';
export const INVITE_INVALID_MESSAGE = 'This invite is no longer valid.';
export const EMAIL_REQUIRED_MESSAGE = 'An email address is required to create an account';
export const EMAIL_UNVERIFIED_MESSAGE = 'Your sign-in provider has not verified this email address';

/**
 * Better Auth endpoints we do not use. Each answers 404 (disabledPaths is an
 * exact-match list, api/index.mjs:166-168). Derived from the installed
 * `auth.api` (see the SUMMARY); `auth.test.ts` enumerates `auth.api` and fails
 * if a new endpoint appears that is neither here nor allowed. The two
 * parameterised paths (`/reset-password/:token`, and the provider callbacks)
 * can't be listed here; `handler`'s allow-list covers them.
 */
export const DISABLED_PATHS = [
  '/sign-up/email',
  '/sign-in/email',
  '/reset-password',
  '/verify-password',
  '/verify-email',
  '/send-verification-email',
  '/change-email',
  '/change-password',
  '/update-session',
  '/update-user',
  '/delete-user',
  '/request-password-reset',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/link-social',
  '/list-accounts',
  '/delete-user/callback',
  '/unlink-account',
  '/refresh-token',
  '/get-access-token',
  '/account-info',
  '/ok',
  '/error',
] as const;

/** Where Better Auth is mounted (its default basePath, stated explicitly). */
export const AUTH_BASE_PATH = '/api/auth';

/** The auth paths the app uses, for the configured providers. Everything else is 404 before Better Auth runs. */
export function allowedAuthPaths(providers: { google: boolean; discord: boolean }): string[] {
  const paths = ['/sign-in/magic-link', '/magic-link/verify', '/get-session', '/sign-out'];
  if (providers.google || providers.discord) paths.push('/sign-in/social');
  if (providers.google) paths.push('/callback/google');
  if (providers.discord) paths.push('/callback/discord');
  return paths.map((p) => `${AUTH_BASE_PATH}${p}`);
}

/**
 * A fixed-window counter per key, with the same sweep and hard cap as
 * accessGate.ts's limiter (a sweep at most once per window; past the cap, new
 * keys share one overflow bucket, failing toward throttling).
 *
 * In memory because hosted mode runs as one instance (spec, "Purge
 * scheduling"). Phase 13 revisits this if it ever runs as more than one.
 */
function createSendLimiter(opts: { max: number; windowMs: number; now: () => number }) {
  const buckets = new Map<string, { count: number; windowStart: number }>();
  let lastSweep = opts.now();
  return {
    /** Counts one send for `key`; false (and nothing counted) if it is over the limit. */
    take(rawKey: string): boolean {
      const t = opts.now();
      if (t - lastSweep >= opts.windowMs) {
        lastSweep = t;
        for (const [k, b] of buckets) if (t - b.windowStart >= opts.windowMs) buckets.delete(k);
      }
      let key = rawKey;
      if (!buckets.has(key) && buckets.size >= MAX_TRACKED_KEYS) key = OVERFLOW_KEY;
      let bucket = buckets.get(key);
      if (bucket === undefined || t - bucket.windowStart >= opts.windowMs) {
        bucket = { count: 0, windowStart: t };
        buckets.set(key, bucket);
      }
      if (bucket.count >= opts.max) return false;
      bucket.count += 1;
      return true;
    },
    size: () => buckets.size,
  };
}

/** Sends email through Resend's HTTP API (no SDK). `fetchImpl` is for tests. */
export function createResendSender(apiKey: string, fetchImpl: typeof fetch = fetch): SendEmail {
  return async (message) => {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!response.ok) {
      // Status only: the body could echo the address.
      throw new Error(`Resend responded ${response.status}`);
    }
  };
}

function magicLinkEmail(from: string, to: string, url: string): EmailMessage {
  return {
    from,
    to,
    subject: 'Your sign-in link for The Soulbound Chronicles',
    text:
      'Use this link to sign in to The Soulbound Chronicles. It works once and expires in 5 minutes.\n\n' +
      `${url}\n\n` +
      "If you didn't ask for this, you can ignore this email.",
  };
}

export async function createAuth(deps: AuthDeps) {
  const [{ betterAuth }, { magicLink }, { toNodeHandler }, { APIError }] = await Promise.all([
    import('better-auth'),
    import('better-auth/plugins/magic-link'),
    import('better-auth/node'),
    import('better-auth/api'),
  ]);

  const { pool, publicUrl, secret } = deps;
  const now = deps.now ?? Date.now;
  const consume = deps.consumeInvite ?? consumeInviteSql;
  const cookieKey = inviteCookieKey(secret);
  const inviteContext = new AsyncLocalStorage<InviteStore>();
  const perEmail = createSendLimiter({ max: MAGIC_LINK_SENDS_PER_WINDOW, windowMs: MAGIC_LINK_WINDOW_MS, now });
  const perNonce = createSendLimiter({ max: MAGIC_LINK_SENDS_PER_WINDOW, windowMs: MAGIC_LINK_WINDOW_MS, now });
  const db: Queryable = pool;
  const redact = deps.redact ?? ((input: string) => input);

  /** The invite for this request, if its cookie verified. */
  const currentInvite = (): InvitePayload | undefined => inviteContext.getStore()?.invite;

  const google = deps.google;
  const discord = deps.discord;
  const socialProviders = {
    ...(google ? { google: { clientId: google.clientId, clientSecret: google.clientSecret } } : {}),
    ...(discord ? { discord: { clientId: discord.clientId, clientSecret: discord.clientSecret } } : {}),
  };

  const auth = betterAuth({
    database: pool,
    baseURL: publicUrl,
    basePath: AUTH_BASE_PATH,
    secret,
    trustedOrigins: [publicUrl],
    telemetry: { enabled: false },
    // Message only: Better Auth passes raw error objects as extra arguments
    // (api/index.mjs router onError), and a driver error's detail can carry
    // the row being inserted, email included. Those arguments are dropped.
    logger: {
      level: 'warn',
      log: (level, message) => {
        const line = `[auth] ${level}: ${redact(String(message))}`;
        if (level === 'error') console.error(line);
        else console.warn(line);
      },
    },
    // Ours run in front (per-IP, per-user, the send caps below). Better Auth's
    // own trusts the client-supplied first X-Forwarded-For value (R24f).
    rateLimit: { enabled: false },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // Off, so a revoked session is refused at once (R24d), not after a cache lifetime.
      cookieCache: { enabled: false },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
        allowDifferentEmails: false,
      },
    },
    advanced: {
      useSecureCookies: true,
      // Both default to "skip" when NODE_ENV=test (create-context.mjs:210-211);
      // pinned so tests exercise exactly what production runs.
      disableCSRFCheck: false,
      disableOriginCheck: false,
      // Never derive the base URL from X-Forwarded-Host (it is fixed by baseURL anyway).
      trustedProxyHeaders: false,
    },
    onAPIError: { errorURL: '/' },
    disabledPaths: [...DISABLED_PATHS],
    socialProviders,
    plugins: [
      magicLink({
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          const key = normalizeEmail(email);
          const invite = currentInvite();
          const [existing, inviteOk] = await Promise.all([
            db.query('SELECT 1 FROM "user" WHERE email = $1', [key]),
            invite === undefined ? Promise.resolve(false) : inviteUsable(db, invite),
          ]);
          const hasAccount = existing.rows.length > 0;
          if (!hasAccount && !inviteOk) return;
          if (!hasAccount && invite !== undefined && !perNonce.take(invite.nonce)) return;
          if (!perEmail.take(key)) return;
          // Not awaited, so both answers take the same time whether or not an
          // email goes out. Errors are logged without the address or the link.
          void deps.sendEmail(magicLinkEmail(deps.emailFrom, email, url)).catch((err: unknown) => {
            const status = err instanceof Error ? /\b\d{3}\b/.exec(err.message)?.[0] : undefined;
            console.error(`[auth] magic-link email was not sent${status ? ` (status ${status})` : ''}`);
          });
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = typeof user.email === 'string' ? user.email.trim() : '';
            if (email === '') {
              throw new APIError('BAD_REQUEST', { code: 'EMAIL_REQUIRED', message: EMAIL_REQUIRED_MESSAGE });
            }
            if (user.emailVerified !== true) {
              throw new APIError('FORBIDDEN', { code: 'EMAIL_NOT_VERIFIED', message: EMAIL_UNVERIFIED_MESSAGE });
            }
            const invite = currentInvite();
            if (invite === undefined) {
              throw new APIError('FORBIDDEN', { code: INVITE_REQUIRED, message: INVITE_REQUIRED_MESSAGE });
            }
            const reserved = await reserveInvite(db, { inviteId: invite.inviteId, nonce: invite.nonce, email });
            if (!reserved) {
              throw new APIError('FORBIDDEN', { code: INVITE_INVALID, message: INVITE_INVALID_MESSAGE });
            }
          },
          after: async (user, context) => {
            const invite = currentInvite();
            const consumed =
              invite !== undefined &&
              (await consume(db, { inviteId: invite.inviteId, nonce: invite.nonce, userId: user.id }));
            if (!consumed) {
              // Compensation: an account never outlives a failed consume.
              await db.query('DELETE FROM "user" WHERE id = $1', [user.id]);
              throw new APIError('FORBIDDEN', { code: INVITE_INVALID, message: INVITE_INVALID_MESSAGE });
            }
            // The invite is spent; drop the cookie that named it.
            context?.setCookie(COOKIE_NAME, '', {
              maxAge: 0,
              path: '/',
              secure: true,
              httpOnly: true,
              sameSite: 'lax',
            });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            // A sign-in within the grace period cancels a pending deletion (R24d).
            await cancelAccountDeletion(db, session.userId);
            await deps.onSessionCreated?.(session.userId);
          },
        },
      },
    },
  });

  const allowed = new Set(allowedAuthPaths({ google: google !== undefined, discord: discord !== undefined }));
  const nodeHandler = toNodeHandler(auth);

  /**
   * Better Auth's Node handler behind an exact, case-sensitive path
   * allow-list: anything else under /api/auth gets the app's JSON 404 without
   * reaching Better Auth.
   */
  const handler = (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse): Promise<void> | void => {
    let pathname: string;
    try {
      pathname = new URL(req.originalUrl ?? req.url ?? '/', 'http://placeholder.invalid').pathname;
    } catch {
      pathname = '';
    }
    if (!allowed.has(pathname)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { message: 'Not found', code: 'NOT_FOUND' } }));
      return;
    }
    return nodeHandler(req, res);
  };

  /**
   * Express middleware for the auth mount: verifies `__Host-sb_invite` from
   * the raw Cookie header and runs the rest of the request inside
   * `inviteContext`. An absent, forged or expired cookie simply means "no
   * invite"; it is never an error here.
   */
  const withInviteContext = (req: Request, _res: Response, next: NextFunction): void => {
    const raw = readInviteCookie(req.headers.cookie);
    const invite = raw === undefined ? undefined : (verifyInviteCookie(cookieKey, raw, now()) ?? undefined);
    inviteContext.run({ invite, ip: req.ip }, () => next());
  };

  /** Deletes every session a user has (06-05's account deletion). */
  const revokeUserSessions = async (userId: string): Promise<void> => {
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUserSessions(userId);
  };

  return {
    auth,
    handler,
    withInviteContext,
    inviteContext,
    revokeUserSessions,
    /** Test-only view of the send limiters' tracked-key counts. */
    __sendLimiterSizes: () => ({ perEmail: perEmail.size(), perNonce: perNonce.size() }),
  };
}

export type HostedAuth = Awaited<ReturnType<typeof createAuth>>;
