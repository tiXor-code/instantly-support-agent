import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Constant-time string comparison for shared secrets / tokens.
// Both inputs are hashed to a fixed-length digest first so timingSafeEqual
// never throws on a length mismatch and the secret's length is not leaked
// through timing. Returns false if either side is empty.
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Verify an HMAC-SHA256 signature on a raw request body.
// Header format: `sha256=<lowercase hex digest>`.
// Returns false on any malformed input rather than throwing — callers should
// treat false as "reject the request".
export function verifyHmac(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  if (!secret) return false;
  const match = signatureHeader.match(/^sha256=([a-f0-9]+)$/i);
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = match[1];
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(provided, 'hex')
    );
  } catch {
    return false;
  }
}
