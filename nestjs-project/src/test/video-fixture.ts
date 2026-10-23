import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FixtureOptions {
  durationSeconds?: number;
  /** false → audio-only file (no video stream). */
  withVideo?: boolean;
}

/**
 * Generates a small media file with FFmpeg's lavfi test sources, so tests need
 * no binary fixtures in the repository. Returns the file path.
 */
export function generateVideoFixture({
  durationSeconds = 2,
  withVideo = true,
}: FixtureOptions = {}): string {
  const path = join(tmpdir(), `streamtube-fixture-${randomUUID()}.mp4`);
  const audio = ['-f', 'lavfi', '-i', `sine=duration=${durationSeconds}`];
  const video = [
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${durationSeconds}:size=320x240:rate=25`,
  ];
  const args = withVideo
    ? [
        ...video,
        ...audio,
        '-shortest',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
      ]
    : [...audio, '-c:a', 'aac'];

  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path]);
  return path;
}
