import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Repository } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status.enum';
import {
  createVideosTestApp,
  errorOf,
  putBytes,
  signUpAndLogin,
  type VideosTestApp,
} from './helpers/videos-e2e';

interface PartUrlsBody {
  parts: { partNumber: number; url: string }[];
  expiresAt: string;
}

interface UploadStatusBody {
  id: string;
  status: string;
  partCount: number;
  uploadedParts: { partNumber: number; etag: string; size: number }[];
}

const THREE_PARTS = 134217729;
const unquote = (etag: string | null) => (etag ?? '').replace(/"/g, '');

describe('videos-upload-resume', () => {
  let ctx: VideosTestApp;
  let videoRepository: Repository<Video>;
  let token: string;
  let draft: PartUrlsBody & { id: string };

  beforeAll(async () => {
    ctx = await createVideosTestApp();
    videoRepository = ctx.dataSource.getRepository(Video);
  }, 30000);

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(ctx.dataSource);
    token = await signUpAndLogin(ctx, 'resume');
    const res = await request(ctx.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'aula.mp4',
        fileSize: THREE_PARTS,
        contentType: 'video/mp4',
      })
      .expect(201);
    draft = res.body as PartUrlsBody & { id: string };
  }, 30000);

  function getUpload(id: string, bearer = token) {
    return request(ctx.app.getHttpServer())
      .get(`/videos/${id}/upload`)
      .set('Authorization', `Bearer ${bearer}`);
  }

  function reissue(id: string, body: Record<string, unknown>) {
    return request(ctx.app.getHttpServer())
      .post(`/videos/${id}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  describe('GET /videos/{id}/upload', () => {
    // 1.1 — Covers AC #1
    it('lists-uploaded-parts', async () => {
      const put = await putBytes(draft.parts[0].url, 1024);
      expect(put.status).toBe(200);

      const res = await getUpload(draft.id);

      expect(res.status).toBe(200);
      const body = res.body as UploadStatusBody;
      expect(body.status).toBe('draft');
      expect(body.partCount).toBe(3);
      expect(body.uploadedParts).toHaveLength(1);
      expect(body.uploadedParts[0]).toMatchObject({
        partNumber: 1,
        size: 1024,
      });
      expect(unquote(body.uploadedParts[0].etag)).toBe(
        unquote(put.headers.get('etag')),
      );
    });

    // 1.2 — Covers AC #4
    it('hides-video-from-other-user', async () => {
      const otherToken = await signUpAndLogin(ctx, 'resume_other');

      const foreign = await getUpload(draft.id, otherToken);
      const missing = await getUpload(randomUUID());
      const malformed = await getUpload('not-a-uuid');

      expect(foreign.status).toBe(404);
      expect(errorOf(foreign)).toBe('VIDEO_NOT_FOUND');
      expect(missing.status).toBe(404);
      expect(errorOf(missing)).toBe('VIDEO_NOT_FOUND');
      expect(malformed.status).toBe(400);
      expect(errorOf(malformed)).toBe('VALIDATION_ERROR');
    });

    // 1.3 — Covers AC #5
    it('rejects-non-draft', async () => {
      await videoRepository.update(
        { id: draft.id },
        { status: VideoStatus.PROCESSING },
      );

      const res = await getUpload(draft.id);

      expect(res.status).toBe(409);
      expect(errorOf(res)).toBe('VIDEO_NOT_DRAFT');
    });
  });

  describe('POST /videos/{id}/upload/parts', () => {
    // 2.1 — Covers AC #2
    it('reissues-part-urls', async () => {
      const res = await reissue(draft.id, { partNumbers: [3, 2] });

      expect(res.status).toBe(200);
      const body = res.body as PartUrlsBody;
      expect(body.parts.map((p) => p.partNumber)).toEqual([2, 3]);
      for (const part of body.parts) {
        expect(part.url.startsWith(process.env.S3_PUBLIC_ENDPOINT!)).toBe(true);
      }
      expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());

      const put = await putBytes(body.parts[0].url, 1024);
      expect(put.status).toBe(200);
    });

    // 2.2 — Covers AC #3
    it('rejects-part-number-beyond-count', async () => {
      const beyond = await reissue(draft.id, { partNumbers: [4] });
      const empty = await reissue(draft.id, { partNumbers: [] });
      const duplicated = await reissue(draft.id, { partNumbers: [1, 1] });

      expect(beyond.status).toBe(400);
      expect(errorOf(beyond)).toBe('INVALID_PART_NUMBERS');
      expect(empty.status).toBe(400);
      expect(errorOf(empty)).toBe('VALIDATION_ERROR');
      expect(duplicated.status).toBe(400);
      expect(errorOf(duplicated)).toBe('VALIDATION_ERROR');
    });
  });
});
