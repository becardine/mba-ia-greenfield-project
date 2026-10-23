import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { type Job, UnrecoverableError } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import { MediaProbeService } from '../media/media-probe.service';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { storageTestConfig } from '../test/storage-test-config';
import { generateVideoFixture } from '../test/video-fixture';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { generateShortId } from '../videos/short-id.util';
import type { ProcessVideoJobData } from '../videos/video-processing.constants';
import { VideoStatus } from '../videos/video-status.enum';
import { VideoProcessor } from './video.processor';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

function buildJob(videoId: string, attemptsMade = 1): Job<ProcessVideoJobData> {
  return {
    data: { videoId },
    attemptsMade,
    opts: { attempts: 3 },
  } as Job<ProcessVideoJobData>;
}

describe('VideoProcessor (integration)', () => {
  const storageCfg = storageTestConfig();
  const storage = new StorageService(storageCfg);
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let processor: VideoProcessor;
  let channelId: string;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    await storage.onModuleInit();
    videoRepository = dataSource.getRepository(Video);
    processor = new VideoProcessor(
      videoRepository,
      storage,
      new MediaProbeService(),
      storageCfg,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({
        email: `processor_${randomUUID()}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await new ChannelsService(dataSource).createChannel(
      user.id,
      user.email,
    );
    channelId = channel.id;
  });

  async function seedProcessingVideo(source: Buffer): Promise<Video> {
    const id = randomUUID();
    const storageKey = `${id}/source`;
    await storage.putObject(
      storage.videosBucket,
      storageKey,
      source,
      'video/mp4',
    );
    return videoRepository.save(
      videoRepository.create({
        id,
        channel_id: channelId,
        short_id: generateShortId(),
        title: 'aula',
        status: VideoStatus.PROCESSING,
        original_file_name: 'aula.mp4',
        content_type: 'video/mp4',
        file_size: source.length,
        storage_key: storageKey,
        part_size: 67108864,
        part_count: 1,
      }),
    );
  }

  function fixture(withVideo: boolean): Buffer {
    const path = generateVideoFixture({ withVideo });
    try {
      return readFileSync(path);
    } finally {
      rmSync(path, { force: true });
    }
  }

  it('should extract metadata, store the thumbnail and mark the video ready', async () => {
    const video = await seedProcessingVideo(fixture(true));

    await processor.process(buildJob(video.id));

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(row.status).toBe(VideoStatus.READY);
    expect(row.duration_seconds).toBeGreaterThanOrEqual(1.9);
    expect(row.duration_seconds).toBeLessThanOrEqual(2.1);
    expect(row).toMatchObject({
      width: 320,
      height: 240,
      video_codec: 'h264',
      audio_codec: 'aac',
      thumbnail_key: `${video.id}.jpg`,
      processing_error: null,
    });
    expect(row.processed_at).toBeInstanceOf(Date);

    const thumbUrl = await storage.presignGet(
      storage.thumbnailsBucket,
      row.thumbnail_key!,
      { publicUrl: false, ttlSeconds: 60 },
    );
    const thumb = Buffer.from(await (await fetch(thumbUrl)).arrayBuffer());
    expect(thumb.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  }, 60000);

  it('should throw UnrecoverableError for a file without a video stream', async () => {
    const video = await seedProcessingVideo(fixture(false));

    await expect(processor.process(buildJob(video.id))).rejects.toThrow(
      UnrecoverableError,
    );
    expect(
      (await videoRepository.findOneByOrFail({ id: video.id })).status,
    ).toBe(VideoStatus.PROCESSING);
  }, 60000);

  it('should ignore a job whose video is no longer processing', async () => {
    const video = await seedProcessingVideo(Buffer.from('irrelevant'));
    await videoRepository.update(
      { id: video.id },
      { status: VideoStatus.READY },
    );

    await expect(
      processor.process(buildJob(video.id)),
    ).resolves.toBeUndefined();
    expect(
      (await videoRepository.findOneByOrFail({ id: video.id })).status,
    ).toBe(VideoStatus.READY);
  });

  describe('onFailed', () => {
    it('should mark the video failed with the reason of an unrecoverable error', async () => {
      const video = await seedProcessingVideo(Buffer.from('x'));

      await processor.onFailed(
        buildJob(video.id, 1),
        new UnrecoverableError('NO_VIDEO_STREAM'),
      );

      const row = await videoRepository.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.FAILED);
      expect(row.processing_error).toBe('NO_VIDEO_STREAM');
      expect(row.processed_at).toBeInstanceOf(Date);
    });

    it('should keep the video processing while retries remain', async () => {
      const video = await seedProcessingVideo(Buffer.from('x'));

      await processor.onFailed(buildJob(video.id, 1), new Error('timeout'));

      expect(
        (await videoRepository.findOneByOrFail({ id: video.id })).status,
      ).toBe(VideoStatus.PROCESSING);
    });

    it('should mark the video failed once the last attempt fails', async () => {
      const video = await seedProcessingVideo(Buffer.from('x'));

      await processor.onFailed(buildJob(video.id, 3), new Error('timeout'));

      const row = await videoRepository.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.FAILED);
      expect(row.processing_error).toBe('timeout');
    });
  });
});
