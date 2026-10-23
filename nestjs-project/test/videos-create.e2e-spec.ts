import request from 'supertest';
import { Repository } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { Video } from '../src/videos/entities/video.entity';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  createVideosTestApp,
  errorOf,
  putBytes,
  signUpAndLogin,
  type VideosTestApp,
} from './helpers/videos-e2e';

interface UploadSessionBody {
  id: string;
  shortId: string;
  title: string;
  status: string;
  partSize: number;
  partCount: number;
  parts: { partNumber: number; url: string }[];
  expiresAt: string;
}

describe('videos-create', () => {
  let ctx: VideosTestApp;
  let videoRepository: Repository<Video>;
  let token: string;

  beforeAll(async () => {
    ctx = await createVideosTestApp();
    videoRepository = ctx.dataSource.getRepository(Video);
  }, 30000);

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(ctx.dataSource);
    token = await signUpAndLogin(ctx, 'create');
  }, 30000);

  function postVideo(body: Record<string, unknown>, auth = true) {
    const req = request(ctx.app.getHttpServer()).post('/videos');
    if (auth) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  // 1.1 — Covers AC #1, #5
  it('creates-draft-with-part-urls', async () => {
    const res = await postVideo({
      fileName: 'aula.mp4',
      fileSize: 134217729,
      contentType: 'video/mp4',
    });

    expect(res.status).toBe(201);
    const body = res.body as UploadSessionBody;
    expect(body).toMatchObject({
      status: 'draft',
      title: 'aula',
      partSize: 67108864,
      partCount: 3,
    });
    expect(body.shortId).toMatch(/^[0-9A-Za-z]{11}$/);
    expect(body.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    for (const part of body.parts) {
      expect(part.url.startsWith(process.env.S3_PUBLIC_ENDPOINT!)).toBe(true);
    }
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(body).not.toHaveProperty('uploadId');
    expect(body).not.toHaveProperty('upload_id');
    expect(body).not.toHaveProperty('storage_key');

    const row = await videoRepository.findOneByOrFail({ id: body.id });
    const channel = await ctx.dataSource
      .getRepository(Channel)
      .findOneByOrFail({ id: row.channel_id });
    expect(row.status).toBe('draft');
    expect(row.upload_id).toEqual(expect.any(String));
    expect(channel.id).toBe(row.channel_id);

    const put = await putBytes(body.parts[0].url, 1024);
    expect(put.status).toBe(200);
    expect(put.headers.get('etag')).toBeTruthy();
  });

  // 1.2 — Covers AC #1
  it('uses-explicit-title', async () => {
    const res = await postVideo({
      fileName: 'x.webm',
      fileSize: 1024,
      contentType: 'video/webm',
      title: '  Meu vídeo  ',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Meu vídeo', partCount: 1 });
  });

  // 1.3 — Covers AC #2
  it('rejects-file-over-10gib', async () => {
    const res = await postVideo({
      fileName: 'huge.mp4',
      fileSize: 10737418241,
      contentType: 'video/mp4',
    });

    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe('VALIDATION_ERROR');
    expect(await videoRepository.count()).toBe(0);
  });

  // 1.4 — Covers AC #3
  it('rejects-non-video-content-type', async () => {
    const pdf = await postVideo({
      fileName: 'doc.pdf',
      fileSize: 1024,
      contentType: 'application/pdf',
    });
    const unknownField = await postVideo({
      fileName: 'aula.mp4',
      fileSize: 1024,
      contentType: 'video/mp4',
      foo: 1,
    });

    expect(pdf.status).toBe(400);
    expect(errorOf(pdf)).toBe('VALIDATION_ERROR');
    expect(unknownField.status).toBe(400);
    expect(errorOf(unknownField)).toBe('VALIDATION_ERROR');
  });

  // 1.5 — Covers AC #4
  it('requires-authentication', async () => {
    const res = await postVideo(
      { fileName: 'aula.mp4', fileSize: 1024, contentType: 'video/mp4' },
      false,
    );

    expect(res.status).toBe(401);
  });
});
