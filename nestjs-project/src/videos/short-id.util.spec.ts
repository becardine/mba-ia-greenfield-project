import { generateShortId, SHORT_ID_PATTERN } from './short-id.util';

describe('generateShortId', () => {
  it('should produce 11 base62 characters', () => {
    const id = generateShortId();

    expect(id).toHaveLength(11);
    expect(id).toMatch(SHORT_ID_PATTERN);
  });

  it('should not repeat across 10 000 generations', () => {
    const ids = new Set(Array.from({ length: 10_000 }, generateShortId));

    expect(ids.size).toBe(10_000);
  });

  it('should use the whole base62 alphabet', () => {
    const seen = new Set(
      Array.from({ length: 2_000 }, generateShortId).join(''),
    );

    expect(seen.size).toBe(62);
  });
});

describe('SHORT_ID_PATTERN', () => {
  it.each(['abc', 'AAAAAAAAAAAA', 'AAAAAAAAAA-', 'AAAAAAAAAA_'])(
    'should reject %p',
    (value) => {
      expect(SHORT_ID_PATTERN.test(value)).toBe(false);
    },
  );
});
