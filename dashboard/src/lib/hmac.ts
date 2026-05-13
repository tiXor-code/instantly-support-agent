import { createHmac, timingSafeEqual } from 'node:crypto';

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
