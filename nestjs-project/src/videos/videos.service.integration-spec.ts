import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { storageTestConfig } from '../test/storage-test-config';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import {
  type ProcessVideoJobData,
  VIDEO_PROCESSING_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from './video-processing.constants';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideoStatus } from './video-status.enum';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosService (integration)', () => {
  const storageCfg = storageTestConfig();
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channelsService: ChannelsService;
  let storage: StorageService;
  let service: VideosService;
  let queue: Queue<ProcessVideoJobData>;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    channelsService = new ChannelsService(dataSource);
    storage = new StorageService(storageCfg);
    await storage.onModuleInit();
    const { redisHost, redisPort, prefix } = queueConfig();
    queue = new Queue(VIDEO_PROCESSING_QUEUE, {
      connection: { host: redisHost, port: redisPort },
      prefix,
      defaultJobOptions: VIDEO_PROCESSING_JOB_OPTIONS,
    });
    service = new VideosService(
      videoRepository,
      channelsService,
      storage,
      storageCfg,
      new VideoProcessingQueue(queue),
    );
  });

  afterAll(async () => {
    await queue.close();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createUserWithChannel(): Promise<User> {
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({
        email: `videos_svc_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    await channelsService.createChannel(user.id, user.email);
    return user;
  }

  describe('createDraft', () => {
    it('should persist a draft in the user channel with an active multipart upload', async () => {
      const user = await createUserWithChannel();
      const channel = await channelsService.findByUserId(user.id);

      const session = await service.createDraft(user.id, {
        fileName: 'aula.mp4',
        fileSize: 2048,
        contentType: 'video/mp4',
      });

      const row = await videoRepository.findOneByOrFail({ id: session.id });
      expect(row).toMatchObject({
        channel_id: channel!.id,
        short_id: session.shortId,
        status: VideoStatus.DRAFT,
        storage_key: `${session.id}/source`,
        part_count: 1,
      });
      expect(row.upload_id).toEqual(expect.any(String));
      await expect(
        storage.listParts(row.storage_key, row.upload_id!),
      ).resolves.toEqual([]);
    });

    it('should issue part URLs that accept a direct PUT', async () => {
      const user = await createUserWithChannel();

      const session = await service.createDraft(user.id, {
        fileName: 'clip.webm',
        fileSize: 1024,
        contentType: 'video/webm',
      });
      const res = await fetch(session.parts[0].url, {
        method: 'PUT',
        body: new Uint8Array(1024),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBeTruthy();
    });

    it('should abort the multipart upload when persisting the draft fails', async () => {
      const user = await createUserWithChannel();
      jest
        .spyOn(videoRepository, 'save')
        .mockRejectedValueOnce(new Error('db down'));
      const abortSpy = jest.spyOn(storage, 'abortMultipartUpload');

      await expect(
        service.createDraft(user.id, {
          fileName: 'aula.mp4',
          fileSize: 1024,
          contentType: 'video/mp4',
        }),
      ).rejects.toThrow('db down');

      const [key, uploadId] = abortSpy.mock.calls[0];
      await expect(storage.listParts(key, uploadId)).rejects.toMatchObject({
        name: 'NoSuchUpload',
      });
      expect(await videoRepository.count()).toBe(0);
    });
  });

  describe('getUploadStatus', () => {
    it('should report the size and etag of a part stored in MinIO', async () => {
      const user = await createUserWithChannel();
      const session = await service.createDraft(user.id, {
        fileName: 'aula.mp4',
        fileSize: 3 * 64 * 1024 * 1024,
        contentType: 'video/mp4',
      });
      const put = await fetch(session.parts[0].url, {
        method: 'PUT',
        body: new Uint8Array(1024),
      });

      const status = await service.getUploadStatus(user.id, session.id);

      expect(status.partCount).toBe(3);
      expect(status.uploadedParts).toEqual([
        {
          partNumber: 1,
          size: 1024,
          etag: (put.headers.get('etag') ?? '').replace(/"/g, ''),
        },
      ]);
    });
  });

  describe('completeUpload', () => {
    async function uploadedDraft(
      userId: string,
      declared: number,
      sent: number,
    ) {
      const session = await service.createDraft(userId, {
        fileName: 'aula.mp4',
        fileSize: declared,
        contentType: 'video/mp4',
      });
      const put = await fetch(session.parts[0].url, {
        method: 'PUT',
        body: new Uint8Array(sent),
      });
      return { session, etag: put.headers.get('etag') ?? '' };
    }

    it('should assemble the object, move to processing and enqueue the job', async () => {
      const user = await createUserWithChannel();
      const { session, etag } = await uploadedDraft(user.id, 2048, 2048);

      const result = await service.completeUpload(user.id, session.id, [
        { partNumber: 1, etag },
      ]);

      expect(result.status).toBe(VideoStatus.PROCESSING);
      const row = await videoRepository.findOneByOrFail({ id: session.id });
      expect(row.status).toBe(VideoStatus.PROCESSING);
      expect(row.upload_id).toBeNull();
      const job = await queue.getJob(session.id);
      expect(job?.data).toEqual({ videoId: session.id });
      const url = await storage.presignGet(
        storage.videosBucket,
        row.storage_key,
        { publicUrl: false, ttlSeconds: 60 },
      );
      const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      expect(probe.headers.get('content-range')).toBe('bytes 0-0/2048');
    });

    it('should abort the upload and mark the video failed on a real size mismatch', async () => {
      const user = await createUserWithChannel();
      const { session, etag } = await uploadedDraft(user.id, 1024, 2048);
      const before = await videoRepository.findOneByOrFail({ id: session.id });

      await expect(
        service.completeUpload(user.id, session.id, [{ partNumber: 1, etag }]),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_SIZE_MISMATCH' });

      const row = await videoRepository.findOneByOrFail({ id: session.id });
      expect(row.status).toBe(VideoStatus.FAILED);
      expect(row.processing_error).toBe('UPLOAD_SIZE_MISMATCH');
      expect(row.upload_id).toBeNull();
      await expect(
        storage.listParts(before.storage_key, before.upload_id!),
      ).rejects.toMatchObject({ name: 'NoSuchUpload' });
      expect(await queue.getJob(session.id)).toBeUndefined();
    });
  });

  describe('abortUpload', () => {
    it('should abort the multipart upload and delete the draft', async () => {
      const user = await createUserWithChannel();
      const session = await service.createDraft(user.id, {
        fileName: 'aula.mp4',
        fileSize: 1024,
        contentType: 'video/mp4',
      });
      const row = await videoRepository.findOneByOrFail({ id: session.id });

      await service.abortUpload(user.id, session.id);

      expect(await videoRepository.findOneBy({ id: session.id })).toBeNull();
      await expect(
        storage.listParts(row.storage_key, row.upload_id!),
      ).rejects.toMatchObject({ name: 'NoSuchUpload' });
    });
  });
});
