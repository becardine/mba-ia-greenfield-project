import { randomUUID } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type storageConfig from '../config/storage.config';
import { storageTestConfig } from '../test/storage-test-config';
import { StorageService } from './storage.service';

const MIB = 1024 * 1024;

function testConfig(): ConfigType<typeof storageConfig> {
  return {
    ...storageTestConfig(),
    videosBucket: 'test-videos',
    thumbnailsBucket: 'test-thumbnails',
  };
}

async function putPart(url: string, body: Buffer): Promise<string> {
  const res = await fetch(url, { method: 'PUT', body: new Uint8Array(body) });
  expect(res.status).toBe(200);
  return res.headers.get('etag') ?? '';
}

describe('StorageService (integration)', () => {
  const config = testConfig();
  let storage: StorageService;

  beforeAll(async () => {
    storage = new StorageService(config);
    await storage.onModuleInit();
  });

  it('should create both buckets and tolerate a second bootstrap', async () => {
    await expect(storage.onModuleInit()).resolves.toBeUndefined();

    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
    });
    await expect(
      client.send(new HeadBucketCommand({ Bucket: 'test-videos' })),
    ).resolves.toBeDefined();
    await expect(
      client.send(new HeadBucketCommand({ Bucket: 'test-thumbnails' })),
    ).resolves.toBeDefined();
    client.destroy();
  });

  describe('multipart upload', () => {
    it('should accept direct PUTs on presigned part URLs and assemble the object', async () => {
      const key = `${randomUUID()}/source`;
      const part1 = Buffer.alloc(5 * MIB, 1);
      const part2 = Buffer.alloc(1024, 2);
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

      const urls = await storage.presignUploadParts(key, uploadId, [1, 2]);
      const etag1 = await putPart(urls[0].url, part1);
      const etag2 = await putPart(urls[1].url, part2);

      const listed = await storage.listParts(key, uploadId);
      expect(listed).toEqual([
        { partNumber: 1, etag: etag1.replace(/"/g, ''), size: part1.length },
        { partNumber: 2, etag: etag2.replace(/"/g, ''), size: part2.length },
      ]);

      await storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 2, etag: etag2 },
        { partNumber: 1, etag: etag1 },
      ]);

      const url = await storage.presignGet(config.videosBucket, key, {
        publicUrl: true,
        ttlSeconds: 60,
      });
      // The signature covers the method, so probe with a 1-byte ranged GET
      const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(
        `bytes 0-0/${part1.length + part2.length}`,
      );
    });

    it('should sign part URLs for the public endpoint host', async () => {
      const key = `${randomUUID()}/source`;
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

      const [part] = await storage.presignUploadParts(key, uploadId, [1]);

      expect(new URL(part.url).host).toBe(new URL(config.publicEndpoint).host);
      expect(part.url).toContain('partNumber=1');
      await storage.abortMultipartUpload(key, uploadId);
    });

    it('should make the upload unusable after abort', async () => {
      const key = `${randomUUID()}/source`;
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const [part] = await storage.presignUploadParts(key, uploadId, [1]);

      await storage.abortMultipartUpload(key, uploadId);

      await expect(storage.listParts(key, uploadId)).rejects.toMatchObject({
        name: 'NoSuchUpload',
      });
      const res = await fetch(part.url, {
        method: 'PUT',
        body: new Uint8Array(10),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('reads and writes', () => {
    const key = `${randomUUID()}.bin`;
    const body = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));

    beforeAll(async () => {
      await storage.putObject(
        config.videosBucket,
        key,
        body,
        'application/octet-stream',
      );
    });

    afterAll(async () => {
      await storage.deleteObject(config.videosBucket, key);
    });

    it('should answer a Range request on a presigned GET with 206', async () => {
      const url = await storage.presignGet(config.videosBucket, key, {
        publicUrl: true,
        ttlSeconds: 60,
        contentType: 'video/mp4',
      });

      const res = await fetch(url, { headers: { Range: 'bytes=0-99' } });

      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 0-99/4096');
      expect(res.headers.get('content-type')).toBe('video/mp4');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(
        body.subarray(0, 100),
      );
    });

    it('should apply the requested Content-Disposition', async () => {
      const url = await storage.presignGet(config.videosBucket, key, {
        publicUrl: true,
        ttlSeconds: 60,
        contentDisposition: 'attachment; filename="aula.mp4"',
      });

      const res = await fetch(url);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="aula.mp4"',
      );
    });

    it('should make a deleted object unavailable', async () => {
      const tmpKey = `${randomUUID()}.bin`;
      await storage.putObject(config.videosBucket, tmpKey, body, 'image/jpeg');

      await storage.deleteObject(config.videosBucket, tmpKey);

      const url = await storage.presignGet(config.videosBucket, tmpKey, {
        publicUrl: false,
        ttlSeconds: 60,
      });
      expect((await fetch(url)).status).toBe(404);
    });
  });
});
