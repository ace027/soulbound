/**
 * `ipv6Slash64` and the rate limiter's `keyFor` (hostedGate.ts, accessGate.ts;
 * spec R24f, plan 06-04 critique 3 and 7). Self-host-runnable: no database.
 */
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../accessGate.js';
import { ipKey, ipv6Slash64 } from '../hostedGate.js';

describe('ipv6Slash64', () => {
  it('every spelling of one /64 is one key (the address is expanded first)', () => {
    const key = '2001:db8:0:0::/64';
    expect(ipv6Slash64('2001:db8::1')).toBe(key);
    expect(ipv6Slash64('2001:db8:0:0::2')).toBe(key);
    expect(ipv6Slash64('2001:0db8:0000:0000:0000:0000:0000:0003')).toBe(key);
    expect(ipv6Slash64('2001:DB8::ffff:1:2:3')).toBe(key);
  });

  it('a different /64 is a different key', () => {
    expect(ipv6Slash64('2001:db8:0:1::1')).toBe('2001:db8:0:1::/64');
    expect(ipv6Slash64('2001:db8:0:1::1')).not.toBe(ipv6Slash64('2001:db8::1'));
  });

  it('a zone index is dropped', () => {
    expect(ipv6Slash64('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ipv6Slash64('fe80::2%1')).toBe(ipv6Slash64('fe80::3'));
  });

  it('IPv4-mapped IPv6 becomes the IPv4 address, in either notation', () => {
    expect(ipv6Slash64('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(ipv6Slash64('::FFFF:7f00:1')).toBe('127.0.0.1');
    expect(ipv6Slash64('0:0:0:0:0:ffff:c000:0201')).toBe('192.0.2.1');
  });

  it('IPv4 is unchanged, and two IPv4 addresses never share a key', () => {
    expect(ipv6Slash64('192.0.2.1')).toBe('192.0.2.1');
    expect(ipv6Slash64('192.0.2.2')).not.toBe(ipv6Slash64('192.0.2.1'));
  });

  it('loopback and the unspecified address', () => {
    expect(ipv6Slash64('::1')).toBe('0:0:0:0::/64');
    expect(ipv6Slash64('::')).toBe('0:0:0:0::/64');
  });

  it('anything that is not an IP address is returned unchanged (still a key)', () => {
    for (const value of ['unknown', '', 'not:an:ip', '1.2.3.4.5', '2001:db8::1::2']) {
      expect(ipv6Slash64(value)).toBe(value);
    }
  });

  it('ipKey: no req.ip shares the "unknown" bucket', () => {
    expect(ipKey({ ip: undefined } as unknown as Request)).toBe('unknown');
    expect(ipKey({ ip: '2001:db8::5' } as unknown as Request)).toBe('2001:db8:0:0::/64');
  });
});

describe('createRateLimiter keyFor', () => {
  function drive(limiter: ReturnType<typeof createRateLimiter>, ip: string): number {
    let status = 200;
    const res = {
      setHeader: () => undefined,
      status(code: number) {
        status = code;
        return this;
      },
      json: () => undefined,
      locals: {},
    } as unknown as Response;
    limiter({ ip } as Request, res, () => undefined);
    return status;
  }

  it('with keyFor, the key is whatever it returns', () => {
    const limiter = createRateLimiter({ perMinute: 1, now: () => 0, keyFor: (req) => ipv6Slash64(req.ip ?? '') });
    expect(drive(limiter, '2001:db8::1')).toBe(200);
    expect(drive(limiter, '2001:db8::2')).toBe(429);
    expect(limiter.__trackedKeyCount()).toBe(1);
  });

  it('without keyFor, each address is still its own key', () => {
    const limiter = createRateLimiter({ perMinute: 1, now: () => 0 });
    expect(drive(limiter, '2001:db8::1')).toBe(200);
    expect(drive(limiter, '2001:db8::2')).toBe(200);
    expect(limiter.__trackedKeyCount()).toBe(2);
  });
});
