import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyHmac, safeEqual } from '../hmac';

const SECRET = 'test-secret';

function sign(body: string, secret = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyHmac', () => {
  it('accepts a valid signature', () => {
    const body = '{"hello":"world"}';
    expect(verifyHmac(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a forged signature with the same length', () => {
    const body = '{"hello":"world"}';
    const real = sign(body).replace('sha256=', '');
    const forged = 'sha256=' + 'f'.repeat(real.length);
    expect(verifyHmac(body, forged, SECRET)).toBe(false);
  });

  it('rejects when the body has been tampered with', () => {
    const sig = sign('{"hello":"world"}');
    expect(verifyHmac('{"hello":"WORLD"}', sig, SECRET)).toBe(false);
  });

  it('rejects malformed header (md5 prefix)', () => {
    const body = 'x';
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyHmac(body, `md5=${sig}`, SECRET)).toBe(false);
  });

  it('rejects header missing the sha256= prefix', () => {
    const body = 'x';
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyHmac(body, sig, SECRET)).toBe(false);
  });

  it('rejects header with non-hex characters', () => {
    expect(verifyHmac('x', 'sha256=ZZZZ', SECRET)).toBe(false);
  });

  it('rejects empty signature header', () => {
    expect(verifyHmac('x', '', SECRET)).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    expect(verifyHmac('x', sign('x'), '')).toBe(false);
  });

  it('rejects on length mismatch without throwing', () => {
    expect(verifyHmac('x', 'sha256=deadbeef', SECRET)).toBe(false);
  });

  it('handles UTF-8 bodies with non-ASCII characters', () => {
    const body = JSON.stringify({ subject: 'Probléme deliverabilité — déjà vu 🚀' });
    expect(verifyHmac(body, sign(body), SECRET)).toBe(true);
  });
});

describe('safeEqual', () => {
  it('accepts two identical tokens', () => {
    expect(safeEqual('cb-token', 'cb-token')).toBe(true);
  });

  it('rejects differing tokens', () => {
    expect(safeEqual('cb-token', 'nope')).toBe(false);
  });

  it('rejects differing tokens of the same length without leaking length', () => {
    expect(safeEqual('abcdef', 'abcxyz')).toBe(false);
  });

  it('fails closed on empty / missing inputs', () => {
    expect(safeEqual('', 'cb-token')).toBe(false);
    expect(safeEqual('cb-token', '')).toBe(false);
    expect(safeEqual(undefined, 'cb-token')).toBe(false);
    expect(safeEqual('cb-token', null)).toBe(false);
    expect(safeEqual('', '')).toBe(false);
  });
});
