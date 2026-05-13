import { describe, it, expect } from 'vitest';
import { dedupConsecutive } from '../lib/dedup.js';

describe('dedupConsecutive', () => {
  it('returns empty for empty input', () => {
    expect(dedupConsecutive([])).toEqual([]);
  });

  it('passes through single-element input', () => {
    expect(dedupConsecutive(['a'])).toEqual(['a']);
  });

  it('collapses two adjacent duplicates', () => {
    expect(dedupConsecutive(['a', 'a'])).toEqual(['a']);
  });

  it('collapses long adjacent runs', () => {
    expect(dedupConsecutive(['a', 'a', 'a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('preserves non-consecutive duplicates', () => {
    expect(dedupConsecutive(['a', 'b', 'a', 'b'])).toEqual(['a', 'b', 'a', 'b']);
  });

  it('preserves order across mixed runs', () => {
    expect(dedupConsecutive(['a', 'a', 'b', 'c', 'c', 'a'])).toEqual(['a', 'b', 'c', 'a']);
  });

  it('treats empty strings as values', () => {
    expect(dedupConsecutive(['', '', 'x'])).toEqual(['', 'x']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'a', 'b'];
    dedupConsecutive(input);
    expect(input).toEqual(['a', 'a', 'b']);
  });
});
