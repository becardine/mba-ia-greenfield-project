import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { StorageService } from '../storage/storage.service';
import { storageTestConfig } from '../test/storage-test-config';
import { generateVideoFixture } from '../test/video-fixture';
import { MediaProbeService } from './media-probe.service';
import { NoVideoStreamError, ProbeFailedError } from './media.errors';

describe('MediaProbeService (integration)', () => {
  const storage = new StorageService(storageTestConfig());
  const media = new MediaProbeService();
  const keys: string[] = [];

  beforeAll(async () => {
    await storage.onModuleInit();
  });

  afterAll(async () => {
    await Promise.all(
      keys.map((key) => storage.deleteObject(storage.videosBucket, key)),
    );
  });

  async function uploadAndSign(body: Buffer, contentType: string) {
    const key = `media-test/${randomUUID()}`;
    keys.push(key);
    await storage.putObject(storage.videosBucket, key, body, contentType);
    return storage.presignGet(storage.videosBucket, key, {
      publicUrl: false,
      ttlSeconds: 300,
    });
  }

  async function uploadFixture(withVideo: boolean): Promise<string> {
    const path = generateVideoFixture({ withVideo });
    try {
      return await uploadAndSign(readFileSync(path), 'video/mp4');
    } finally {
      rmSync(path, { force: true });
    }
  }

  describe('probe', () => {
    it('should extract duration, dimensions and codecs over a presigned URL', async () => {
      const url = await uploadFixture(true);

      const meta = await media.probe(url);

      expect(meta.durationSeconds).toBeGreaterThanOrEqual(1.9);
      expect(meta.durationSeconds).toBeLessThanOrEqual(2.1);
      expect(meta).toMatchObject({
        width: 320,
        height: 240,
        videoCodec: 'h264',
        audioCodec: 'aac',
      });
      expect(meta.bitrate).toBeGreaterThan(0);
      expect(meta.formatName).toContain('mp4');
    }, 30000);

    it('should reject a file without a video stream', async () => {
      const url = await uploadFixture(false);

      await expect(media.probe(url)).rejects.toThrow(NoVideoStreamError);
    }, 30000);

    it('should reject bytes that are not media', async () => {
      const url = await uploadAndSign(
        Buffer.from('definitely not a video'),
        'video/mp4',
      );

      const error = (await media.probe(url).catch((e: unknown) => e)) as Error;
      expect(error).toBeInstanceOf(ProbeFailedError);
      expect((error as ProbeFailedError).reason).toMatch(/^PROBE_FAILED: /);
    }, 30000);
  });

  describe('extractThumbnail', () => {
    it('should return a JPEG frame', async () => {
      const url = await uploadFixture(true);

      const jpeg = await media.extractThumbnail(url, 0.2);

      expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    }, 30000);
  });
});
