import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { Repository } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VIDEO_PROCESSING_QUEUE } from '../src/videos/video-processing.constants';
import { VideoStatus } from '../src/videos/video-status.enum';
import {
  createVideosTestApp,
  errorOf,
  putBytes,
  signUpAndLogin,
  type VideosTestApp,
} from './helpers/videos-e2e';

interface DraftBody {
  id: string;
  shortId: string;
  parts: { partNumber: number; url: string }[];
}

const THREE_PARTS = 134217729;

describe('videos-upload-complete', () => {
  let ctx: VideosTestApp;
  let videoRepository: Repository<Video>;
  let queue: Queue;
  let token: string;

  beforeAll(async () => {
    ctx = await createVideosTestApp();
    videoRepository = ctx.dataSource.getRepository(Video);
    queue = ctx.app.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
  }, 30000);

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(ctx.dataSource);
    await queue.obliterate({ force: true });
    token = await signUpAndLogin(ctx, 'complete');
  }, 30000);

  async function createDraft(fileSize: number, bearer = token) {
    const res = await request(ctx.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ fileName: 'aula.mp4', fileSize, contentType: 'video/mp4' })
      .expect(201);
    return res.body as DraftBody;
  }

  async function uploadPart(url: string, size: number): Promise<string> {
    const res = await putBytes(url, size);
    expect(res.status).toBe(200);
    return res.headers.get('etag') ?? '';
  }

  function complete(id: string, body: Record<string, unknown>, bearer = token) {
    return request(ctx.app.getHttpServer())
      .post(`/videos/${id}/upload/complete`)
      .set('Authorization', `Bearer ${bearer}`)
      .send(body);
  }

  function abort(id: string, bearer: string | null = token) {
    const req = request(ctx.app.getHttpServer()).delete(`/videos/${id}/upload`);
    if (bearer) req.set('Authorization', `Bearer ${bearer}`);
    return req;
  }

  describe('POST /videos/{id}/upload/complete', () => {
    // 1.1 — Covers AC #1
    it('completes-and-enqueues', async () => {
      const draft = await createDraft(2048);
      const etag = await uploadPart(draft.parts[0].url, 2048);

      const res = await complete(draft.id, {
        parts: [{ partNumber: 1, etag }],
      });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        id: draft.id,
        shortId: draft.shortId,
        status: 'processing',
      });
      const row = await videoRepository.findOneByOrFail({ id: draft.id });
      expect(row.status).toBe(VideoStatus.PROCESSING);
      expect(row.upload_id).toBeNull();
      const job = await queue.getJob(draft.id);
      expect(job?.name).toBe('process-video');
      expect(job?.data).toEqual({ videoId: draft.id });
    });

    // 1.2 — Covers AC #2
    it('rejects-missing-or-wrong-parts', async () => {
      const multi = await createDraft(THREE_PARTS);
      const etag = await uploadPart(multi.parts[0].url, 1024);

      const missing = await complete(multi.id, {
        parts: [{ partNumber: 1, etag }],
      });

      expect(missing.status).toBe(400);
      expect(errorOf(missing)).toBe('UPLOAD_INCOMPLETE');
      expect(
        (await videoRepository.findOneByOrFail({ id: multi.id })).status,
      ).toBe(VideoStatus.DRAFT);
      await request(ctx.app.getHttpServer())
        .get(`/videos/${multi.id}/upload`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const single = await createDraft(1024);
      await uploadPart(single.parts[0].url, 1024);
      const wrongEtag = await complete(single.id, {
        parts: [{ partNumber: 1, etag: 'deadbeef' }],
      });

      expect(wrongEtag.status).toBe(400);
      expect(errorOf(wrongEtag)).toBe('UPLOAD_INCOMPLETE');
    });

    // 1.3 — Covers AC #3
    it('rejects-size-mismatch', async () => {
      const draft = await createDraft(1024);
      const etag = await uploadPart(draft.parts[0].url, 2048);

      const res = await complete(draft.id, {
        parts: [{ partNumber: 1, etag }],
      });

      expect(res.status).toBe(400);
      expect(errorOf(res)).toBe('UPLOAD_SIZE_MISMATCH');
      const details = await request(ctx.app.getHttpServer())
        .get(`/videos/${draft.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(details.body).toMatchObject({
        status: 'failed',
        processingError: 'UPLOAD_SIZE_MISMATCH',
      });
      expect(await queue.getJob(draft.id)).toBeUndefined();
    });

    // 1.4 — Covers AC #4
    it('rejects-second-complete', async () => {
      const draft = await createDraft(1024);
      const etag = await uploadPart(draft.parts[0].url, 1024);
      const body = { parts: [{ partNumber: 1, etag }] };
      await complete(draft.id, body).expect(202);

      const again = await complete(draft.id, body);
      const otherToken = await signUpAndLogin(ctx, 'complete_other');
      const otherDraft = await createDraft(1024);
      const foreign = await complete(otherDraft.id, body, otherToken);
      const empty = await complete(otherDraft.id, { parts: [] });

      expect(again.status).toBe(409);
      expect(errorOf(again)).toBe('VIDEO_NOT_DRAFT');
      expect(foreign.status).toBe(404);
      expect(errorOf(foreign)).toBe('VIDEO_NOT_FOUND');
      expect(empty.status).toBe(400);
      expect(errorOf(empty)).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /videos/{id}/upload', () => {
    // 2.1 — Covers AC #5
    it('aborts-draft', async () => {
      const draft = await createDraft(THREE_PARTS);
      await uploadPart(draft.parts[0].url, 1024);

      const res = await abort(draft.id);

      expect(res.status).toBe(204);
      const details = await request(ctx.app.getHttpServer())
        .get(`/videos/${draft.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(details.status).toBe(404);
      expect(errorOf(details)).toBe('VIDEO_NOT_FOUND');
      const put = await putBytes(draft.parts[1].url, 1024);
      expect(put.status).toBe(404);
    });

    // 2.2 — Covers AC #5
    it('abort-requires-draft-and-auth', async () => {
      const draft = await createDraft(1024);
      await videoRepository.update(
        { id: draft.id },
        { status: VideoStatus.PROCESSING },
      );

      const notDraft = await abort(draft.id);
      const anonymous = await abort(draft.id, null);

      expect(notDraft.status).toBe(409);
      expect(errorOf(notDraft)).toBe('VIDEO_NOT_DRAFT');
      expect(anonymous.status).toBe(401);
    });
  });
});
