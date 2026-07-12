// Pure email-allowlist helpers, separated from auth.ts so they can be
// imported by tests without pulling NextAuth (and its `next/server`
// dependency) into the unit-test runner.

export function parseAllowlist(csv: string | undefined | null): string[] {
  return (csv || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Decide whether an email may sign in.
// Fail closed: an empty/unset allowlist denies everyone. ALLOWED_EMAILS must
// be configured for any account to sign in — an unconfigured allowlist must
// never grant access to arbitrary Google accounts.
export function isEmailAllowed(
  email: string | undefined | null,
  allowlistCsv: string | undefined | null
): boolean {
  if (!email) return false;
  const list = parseAllowlist(allowlistCsv);
  if (list.length === 0) return false;
  return list.includes(email.toLowerCase());
}
