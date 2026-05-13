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
// Empty allowlist means "no allowlist configured" → allow everyone (used in
// dev / self-hosted setups). Otherwise email must be present in the list.
export function isEmailAllowed(
  email: string | undefined | null,
  allowlistCsv: string | undefined | null
): boolean {
  if (!email) return false;
  const list = parseAllowlist(allowlistCsv);
  if (list.length === 0) return true;
  return list.includes(email.toLowerCase());
}
