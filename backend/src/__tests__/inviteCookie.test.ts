/**
 * The `__Host-sb_invite` cookie (spec Key Decisions → "Invite carrier"):
 * HMAC-SHA256 under an HKDF key from BETTER_AUTH_SECRET, carrying
 * `{inviteId, nonce, exp}` and never the invite code. Self-host-runnable: no
 * database, and invites.ts loads no hosted package.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  clearInviteCookie,
  COOKIE_NAME,
  generateInviteCode,
  inviteCookieKey,
  readInviteCookie,
  serializeInviteCookie,
  signInviteCookie,
  verifyInviteCookie,
  type InvitePayload,
} from '../invites.js';

const SECRET = 'fake-auth-secret-for-invite-cookie-tests-Qm7x2';
const OTHER_SECRET = 'fake-auth-secret-different-deployment-Zp4k9w';
const NOW = 1_800_000_000_000;

const payload: InvitePayload = {
  inviteId: '6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
  nonce: 'AbCdEfGhIjKlMnOpQrStUv',
  exp: NOW + 900_000,
};

describe('invite cookie', () => {
  const key = inviteCookieKey(SECRET);

  it('round-trips: a signed value verifies to the same payload', () => {
    expect(verifyInviteCookie(key, signInviteCookie(key, payload), NOW)).toEqual(payload);
  });

  it('the key is 32 bytes and depends on the secret', () => {
    expect(key.length).toBe(32);
    expect(inviteCookieKey(SECRET).equals(key)).toBe(true);
    expect(inviteCookieKey(OTHER_SECRET).equals(key)).toBe(false);
  });

  it('any single flipped byte fails verification', () => {
    const signed = signInviteCookie(key, payload);
    for (let i = 0; i < signed.length; i += 1) {
      if (signed[i] === '.') continue;
      const flipped = signed.slice(0, i) + (signed[i] === 'A' ? 'B' : 'A') + signed.slice(i + 1);
      expect(verifyInviteCookie(key, flipped, NOW), `position ${i}`).toBeNull();
    }
  });

  it('an expired cookie fails, and one expiring exactly now fails', () => {
    const signed = signInviteCookie(key, payload);
    expect(verifyInviteCookie(key, signed, payload.exp + 1)).toBeNull();
    expect(verifyInviteCookie(key, signed, payload.exp)).toBeNull();
    expect(verifyInviteCookie(key, signed, payload.exp - 1)).toEqual(payload);
  });

  it('a cookie signed under a different secret fails', () => {
    const signed = signInviteCookie(inviteCookieKey(OTHER_SECRET), payload);
    expect(verifyInviteCookie(key, signed, NOW)).toBeNull();
  });

  it('malformed values fail without throwing (wrong MAC length, extra parts, bad JSON, bad fields)', () => {
    const signed = signInviteCookie(key, payload);
    const [body, macPart] = signed.split('.') as [string, string];
    const cases = [
      '',
      '.',
      body,
      `${body}.${macPart}.x`,
      `${body}.${macPart.slice(0, -2)}`,
      `${body}.${macPart}AA`,
      `${body}.not*base64`,
    ];
    for (const value of cases) expect(verifyInviteCookie(key, value, NOW), value).toBeNull();

    // A validly MACed payload with a bad shape is still refused.
    const badShapes: unknown[] = [
      'string',
      { ...payload, inviteId: 'not-a-uuid' },
      { ...payload, nonce: 'short' },
      { ...payload, exp: '1800000900000' },
    ];
    for (const shape of badShapes) {
      // MACed with the real key, so only the shape check can refuse it.
      const encoded = Buffer.from(JSON.stringify(shape)).toString('base64url');
      const reMac = createHmac('sha256', key).update(encoded).digest('base64url');
      expect(verifyInviteCookie(key, `${encoded}.${reMac}`, NOW), JSON.stringify(shape)).toBeNull();
    }
  });

  it('the payload holds only inviteId, nonce and exp: no invite code', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const signed = signInviteCookie(key, payload);
    const decoded = Buffer.from(signed.split('.')[0]!, 'base64url').toString('utf8');
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(['exp', 'inviteId', 'nonce']);
    expect(signed).not.toContain(code);
    expect(decoded).not.toContain(code);
    // Extra fields handed to the signer are dropped, so a code can't ride along.
    const withCode = { ...payload, code } as InvitePayload;
    const decodedWithCode = Buffer.from(signInviteCookie(key, withCode).split('.')[0]!, 'base64url').toString('utf8');
    expect(decodedWithCode).not.toContain(code);
  });

  it('Set-Cookie has the __Host- name and exactly the 5 attributes', () => {
    const header = serializeInviteCookie(signInviteCookie(key, payload));
    const [nameValue, ...attributes] = header.split('; ');
    expect(nameValue!.startsWith(`${COOKIE_NAME}=`)).toBe(true);
    expect(COOKIE_NAME).toBe('__Host-sb_invite');
    expect(attributes).toEqual(['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=900']);
    expect(header).not.toMatch(/Domain=/i);
  });

  it('the clearing Set-Cookie keeps the same attributes with Max-Age=0', () => {
    expect(clearInviteCookie()).toBe('__Host-sb_invite=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  });

  it('reads the cookie out of a raw Cookie header', () => {
    expect(readInviteCookie(undefined)).toBeUndefined();
    expect(readInviteCookie('a=1; b=2')).toBeUndefined();
    expect(readInviteCookie(`a=1; ${COOKIE_NAME}=v.m; b=2`)).toBe('v.m');
    expect(readInviteCookie(`sb_invite=wrong; ${COOKIE_NAME}=right`)).toBe('right');
  });
});
