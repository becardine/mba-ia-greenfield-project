import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Repository } from 'typeorm';
import { ChannelsService } from '../src/channels/channels.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { generateShortId } from '../src/videos/short-id.util';
import { VideoStatus } from '../src/videos/video-status.enum';
import {
  createVideosTestApp,
  errorOf,
  signUpAndLogin,
  type VideosTestApp,
} from './helpers/videos-e2e';

interface MeBody {
  sub: string;
}

describe('videos-get', () => {
  let ctx: VideosTestApp;
  let videoRepository: Repository<Video>;
  let token: string;
  let channelId: string;

  beforeAll(async () => {
    ctx = await createVideosTestApp();
    videoRepository = ctx.dataSource.getRepository(Video);
  }, 30000);

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(ctx.dataSource);
    token = await signUpAndLogin(ctx, 'get');
    const me = await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const channel = await ctx.app
      .get(ChannelsService)
      .findByUserId((me.body as MeBody).sub);
    channelId = channel!.id;
  }, 30000);

  async function seedVideo(overrides: Partial<Video>): Promise<Video> {
    const id = randomUUID();
    return videoRepository.save(
      videoRepository.create({
        id,
        channel_id: channelId,
        short_id: generateShortId(),
        title: 'aula',
        original_file_name: 'aula.mp4',
        content_type: 'video/mp4',
        file_size: 1024,
        storage_key: `${id}/source`,
        part_size: 67108864,
        part_count: 1,
        ...overrides,
      }),
    );
  }

  function getVideo(id: string, bearer: string | null = token) {
    const req = request(ctx.app.getHttpServer()).get(`/videos/${id}`);
    if (bearer) req.set('Authorization', `Bearer ${bearer}`);
    return req;
  }

  // 1.1 — Covers AC #1
  it('returns-ready-metadata', async () => {
    const video = await seedVideo({
      status: VideoStatus.READY,
      duration_seconds: 2.04,
      width: 320,
      height: 240,
      video_codec: 'h264',
      file_size: 10737418240,
      upload_id: null,
    });

    const res = await getVideo(video.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      durationSeconds: 2.04,
      width: 320,
      height: 240,
      videoCodec: 'h264',
      fileSize: 10737418240,
    });
    const body = res.body as Record<string, unknown>;
    expect(Number.isNaN(Date.parse(body.createdAt as string))).toBe(false);
    expect(Number.isNaN(Date.parse(body.updatedAt as string))).toBe(false);
    expect(body).not.toHaveProperty('uploadId');
    expect(body).not.toHaveProperty('storage_key');
  });

  // 1.2 — Covers AC #2
  it('returns-failure-reason', async () => {
    const video = await seedVideo({
      status: VideoStatus.FAILED,
      processing_error: 'NO_VIDEO_STREAM',
    });

    const res = await getVideo(video.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'failed',
      processingError: 'NO_VIDEO_STREAM',
      durationSeconds: null,
    });
  });

  // 1.3 — Covers AC #3
  it('hides-from-other-user', async () => {
    const video = await seedVideo({ status: VideoStatus.READY });
    const otherToken = await signUpAndLogin(ctx, 'get_other');

    const foreign = await getVideo(video.id, otherToken);
    const anonymous = await getVideo(video.id, null);

    expect(foreign.status).toBe(404);
    expect(errorOf(foreign)).toBe('VIDEO_NOT_FOUND');
    expect(anonymous.status).toBe(401);
  });

  // 1.4 — Covers AC #4
  it('validates-uuid', async () => {
    const res = await getVideo('not-a-uuid');

    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe('VALIDATION_ERROR');
  });
});
