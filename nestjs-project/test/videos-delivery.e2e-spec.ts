import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import request from 'supertest';
import { Repository } from 'typeorm';
import { ChannelsService } from '../src/channels/channels.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { generateVideoFixture } from '../src/test/video-fixture';
import { Video } from '../src/videos/entities/video.entity';
import { generateShortId } from '../src/videos/short-id.util';
import { VideoStatus } from '../src/videos/video-status.enum';
import { WorkerModule } from '../src/worker/worker.module';
import {
  createVideosTestApp,
  errorOf,
  signUpAndLogin,
  type VideosTestApp,
} from './helpers/videos-e2e';

interface DraftBody {
  id: string;
  shortId: string;
  parts: { partNumber: number; url: string }[];
}

const FILE_NAME = 'aula de teste.mp4';
const READY_TIMEOUT_MS = 30000;

async function waitForStatus(
  repo: Repository<Video>,
  id: string,
  timeoutMs: number,
): Promise<Video> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const video = await repo.findOneByOrFail({ id });
    if (video.status !== VideoStatus.PROCESSING || Date.now() > deadline) {
      return video;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('videos-delivery', () => {
  let ctx: VideosTestApp;
  let worker: INestApplicationContext;
  let videoRepository: Repository<Video>;
  let token: string;
  let fixture: Buffer;
  let ready: DraftBody;

  beforeAll(async () => {
    ctx = await createVideosTestApp();
    worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    videoRepository = ctx.dataSource.getRepository(Video);
    await cleanAllTables(ctx.dataSource);
    token = await signUpAndLogin(ctx, 'delivery');

    const path = generateVideoFixture();
    fixture = readFileSync(path);
    rmSync(path, { force: true });

    const server = ctx.app.getHttpServer();
    const draft = await request(server)
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: FILE_NAME,
        fileSize: fixture.length,
        contentType: 'video/mp4',
      })
      .expect(201);
    ready = draft.body as DraftBody;
    const put = await fetch(ready.parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(fixture),
    });
    await request(server)
      .post(`/videos/${ready.id}/upload/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag: put.headers.get('etag') }] })
      .expect(202);

    const processed = await waitForStatus(
      videoRepository,
      ready.id,
      READY_TIMEOUT_MS,
    );
    expect(processed.status).toBe(VideoStatus.READY);
  }, 90000);

  afterAll(async () => {
    await worker.close();
    await ctx.app.close();
  });

  beforeEach(() => {
    ctx.throttlerStorage.storage.clear();
  });

  function get(path: string, bearer?: string) {
    const req = request(ctx.app.getHttpServer()).get(path).redirects(0);
    if (bearer) req.set('Authorization', `Bearer ${bearer}`);
    return req;
  }

  describe('Delivery of a ready video', () => {
    // 1.1 — Covers AC #1
    it('streams-with-range', async () => {
      const res = await get(`/videos/${ready.shortId}/stream`);

      expect(res.status).toBe(302);
      expect(res.headers['cache-control']).toBe('no-store');
      const location = res.headers.location;
      expect(location.startsWith(process.env.S3_PUBLIC_ENDPOINT!)).toBe(true);

      const partial = await fetch(location, {
        headers: { Range: 'bytes=0-1023' },
      });
      expect(partial.status).toBe(206);
      expect((await partial.arrayBuffer()).byteLength).toBe(1024);
      expect(partial.headers.get('content-range')).toMatch(/^bytes 0-1023\//);
      expect(partial.headers.get('content-type')).toBe('video/mp4');
    });

    // 1.2 — Covers AC #2
    it('downloads-as-attachment', async () => {
      const res = await get(`/videos/${ready.shortId}/download`);

      expect(res.status).toBe(302);
      const file = await fetch(res.headers.location);
      expect(file.status).toBe(200);
      expect(file.headers.get('content-disposition')).toBe(
        `attachment; filename="${FILE_NAME}"`,
      );
      expect((await file.arrayBuffer()).byteLength).toBe(fixture.length);
    });

    // 1.3 — Covers AC #3
    it('serves-thumbnail-and-metadata', async () => {
      const res = await get(`/videos/${ready.shortId}/thumbnail`);

      expect(res.status).toBe(302);
      const image = await fetch(res.headers.location);
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type')).toBe('image/jpeg');
      const bytes = Buffer.from(await image.arrayBuffer());
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

      const details = await get(`/videos/${ready.id}`, token).expect(200);
      const body = details.body as Record<string, number | string>;
      expect(body.durationSeconds).toBeGreaterThanOrEqual(1.9);
      expect(body.durationSeconds).toBeLessThanOrEqual(2.1);
      expect(body).toMatchObject({
        width: 320,
        height: 240,
        videoCodec: 'h264',
        audioCodec: 'aac',
      });
    });
  });

  describe('Non-ready and unknown videos', () => {
    let processing: Video;

    beforeAll(async () => {
      const me = await get('/auth/me', token).expect(200);
      const channel = await ctx.app
        .get(ChannelsService)
        .findByUserId((me.body as { sub: string }).sub);
      const id = randomUUID();
      processing = await videoRepository.save(
        videoRepository.create({
          id,
          channel_id: channel!.id,
          short_id: generateShortId(),
          title: 'pending',
          status: VideoStatus.PROCESSING,
          original_file_name: 'pending.mp4',
          content_type: 'video/mp4',
          file_size: 1024,
          storage_key: `${id}/source`,
          part_size: 67108864,
          part_count: 1,
        }),
      );
    });

    // 2.1 — Covers AC #4
    it('hides-non-ready-video', async () => {
      for (const kind of ['stream', 'download', 'thumbnail']) {
        const asOwner = await get(
          `/videos/${processing.short_id}/${kind}`,
          token,
        );
        const anonymous = await get(`/videos/${processing.short_id}/${kind}`);

        expect(asOwner.status).toBe(404);
        expect(errorOf(asOwner)).toBe('VIDEO_NOT_FOUND');
        expect(anonymous.status).toBe(404);
        expect(errorOf(anonymous)).toBe('VIDEO_NOT_FOUND');
      }
    });

    // 2.2 — Covers AC #5
    it('rejects-unknown-short-id', async () => {
      const malformed = await get('/videos/abc/stream');
      const unknown = await get('/videos/AAAAAAAAAAA/download');

      expect(malformed.status).toBe(404);
      expect(errorOf(malformed)).toBe('VIDEO_NOT_FOUND');
      expect(unknown.status).toBe(404);
      expect(errorOf(unknown)).toBe('VIDEO_NOT_FOUND');
    });
  });
});
