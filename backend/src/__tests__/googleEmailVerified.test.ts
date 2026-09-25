/**
 * `googleEmailVerified` (auth.ts), the check `account.create.before` runs on
 * every Google account row (review cycle 1, S3). Only a real boolean `true`
 * in the ID token's `email_verified` claim counts; everything else, including
 * truthy look-alikes and anything malformed, is unverified (review cycle 2,
 * F1). Pure function: no database, so it runs in the self-host suite.
 */
import { describe, expect, it } from 'vitest';
import { googleEmailVerified } from '../auth.js';

const b64url = (value: string) => Buffer.from(value).toString('base64url');
const token = (claims: Record<string, unknown>) =>
  `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ sub: 'g-1', ...claims }))}.sig`;

describe('googleEmailVerified', () => {
  it('accepts only the boolean true', () => {
    expect(googleEmailVerified(token({ email_verified: true }))).toBe(true);
  });

  it.each([
    ['the string "true"', { email_verified: 'true' }],
    ['the number 1', { email_verified: 1 }],
    ['false', { email_verified: false }],
    ['null', { email_verified: null }],
    ['an object', { email_verified: { value: true } }],
    ['the claim missing', {}],
  ])('treats %s as unverified', (_label, claims) => {
    expect(googleEmailVerified(token(claims))).toBe(false);
  });

  it.each([
    ['a payload that is not base64url JSON', `${b64url('{}')}.!!!not-base64!!!.sig`],
    ['a payload that decodes but is not JSON', `${b64url('{}')}.${b64url('email_verified=true')}.sig`],
    ['a JSON payload that is not an object', `${b64url('{}')}.${b64url('true')}.sig`],
    ['a JSON null payload', `${b64url('{}')}.${b64url('null')}.sig`],
    ['a token with no second segment', b64url(JSON.stringify({ email_verified: true }))],
    ['a token whose second segment is empty', `${b64url('{}')}..sig`],
    ['an empty string', ''],
  ])('treats %s as unverified', (_label, input) => {
    expect(googleEmailVerified(input)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 1],
    ['a boolean', true],
    ['an object', { email_verified: true }],
  ])('treats a non-string input (%s) as unverified', (_label, input) => {
    expect(googleEmailVerified(input)).toBe(false);
  });
});
