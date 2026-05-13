import { describe, it, expect } from 'vitest';
import { isEmailAllowed, parseAllowlist } from '../allowlist';

describe('parseAllowlist', () => {
  it('returns [] for undefined / null / empty', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist(null)).toEqual([]);
    expect(parseAllowlist('')).toEqual([]);
  });

  it('splits, trims, lowercases, drops empties', () => {
    expect(parseAllowlist('Foo@x.com, BAR@x.com ,, baz@x.com')).toEqual([
      'foo@x.com',
      'bar@x.com',
      'baz@x.com',
    ]);
  });
});

describe('isEmailAllowed', () => {
  it('rejects when email is missing', () => {
    expect(isEmailAllowed(undefined, 'foo@x.com')).toBe(false);
    expect(isEmailAllowed(null, 'foo@x.com')).toBe(false);
    expect(isEmailAllowed('', 'foo@x.com')).toBe(false);
  });

  it('allows everyone when allowlist is empty / unset', () => {
    expect(isEmailAllowed('whoever@x.com', '')).toBe(true);
    expect(isEmailAllowed('whoever@x.com', undefined)).toBe(true);
    expect(isEmailAllowed('whoever@x.com', '   ,   ')).toBe(true);
  });

  it('matches case-insensitively against the allowlist', () => {
    expect(isEmailAllowed('Foo@X.com', 'foo@x.com,bar@x.com')).toBe(true);
    expect(isEmailAllowed('foo@x.com', 'FOO@X.COM,BAR@X.COM')).toBe(true);
  });

  it('tolerates whitespace inside the allowlist string', () => {
    expect(isEmailAllowed('foo@x.com', '  foo@x.com ,  bar@x.com  ')).toBe(true);
  });

  it('rejects an email that is not in the allowlist', () => {
    expect(isEmailAllowed('other@x.com', 'foo@x.com,bar@x.com')).toBe(false);
  });
});
