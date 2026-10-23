import { thumbnailOffset } from './media-probe.service';

describe('thumbnailOffset', () => {
  it('should take the frame at 10% of the duration', () => {
    expect(thumbnailOffset(120)).toBe(12);
    expect(thumbnailOffset(2.04)).toBe(0.204);
  });

  it.each([0, 0.5, 0.999, null])(
    'should use the first frame for a duration of %p',
    (duration) => {
      expect(thumbnailOffset(duration)).toBe(0);
    },
  );
});
