import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import type { Channel } from '../channels/entities/channel.entity';
import {
  ChannelNotFoundException,
  InvalidPartNumbersException,
  UploadIncompleteException,
  UploadSizeMismatchException,
  VideoNotDraftException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import type { CreateVideoDto } from './dto/create-video.dto';
import { Video } from './entities/video.entity';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideoStatus } from './video-status.enum';
import { VIDEO_PART_SIZE } from './videos.constants';
import {
  attachmentDisposition,
  defaultTitle,
  VideosService,
} from './videos.service';

interface VideoRepositoryMock {
  create: jest.MockedFunction<(entity: Partial<Video>) => Video>;
  save: jest.MockedFunction<(entity: Video) => Promise<Video>>;
  findOneBy: jest.MockedFunction<
    (where: Partial<Video>) => Promise<Video | null>
  >;
  update: jest.MockedFunction<
    (where: Partial<Video>, patch: Partial<Video>) => Promise<unknown>
  >;
  delete: jest.MockedFunction<(where: Partial<Video>) => Promise<unknown>>;
}

interface ChannelsServiceMock {
  findByUserId: jest.MockedFunction<ChannelsService['findByUserId']>;
}

interface StorageServiceMock {
  createMultipartUpload: jest.MockedFunction<
    StorageService['createMultipartUpload']
  >;
  presignUploadParts: jest.MockedFunction<StorageService['presignUploadParts']>;
  abortMultipartUpload: jest.MockedFunction<
    StorageService['abortMultipartUpload']
  >;
  listParts: jest.MockedFunction<StorageService['listParts']>;
  completeMultipartUpload: jest.MockedFunction<
    StorageService['completeMultipartUpload']
  >;
  presignGet: jest.MockedFunction<StorageService['presignGet']>;
  videosBucket: string;
  thumbnailsBucket: string;
}

interface ProcessingQueueMock {
  enqueue: jest.MockedFunction<VideoProcessingQueue['enqueue']>;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL = { id: '22222222-2222-4222-8222-222222222222' } as Channel;
const UPLOAD_TTL = 3600;
const DELIVERY_TTL = 21600;

function uniqueViolation(column: string): QueryFailedError {
  return Object.assign(new QueryFailedError('INSERT', [], new Error('dup')), {
    code: '23505',
    detail: `Key (${column})=(x) already exists.`,
  });
}

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    channel_id: CHANNEL.id,
    short_id: 'AbCdEfGhIjK',
    title: 'aula',
    status: VideoStatus.DRAFT,
    original_file_name: 'aula.mp4',
    content_type: 'video/mp4',
    file_size: 3 * VIDEO_PART_SIZE,
    storage_key: '33333333-3333-4333-8333-333333333333/source',
    upload_id: 'upload-1',
    part_size: VIDEO_PART_SIZE,
    part_count: 3,
    ...overrides,
  } as Video;
}

function buildDto(overrides: Partial<CreateVideoDto> = {}): CreateVideoDto {
  return {
    fileName: 'aula.mp4',
    fileSize: 1024,
    contentType: 'video/mp4',
    ...overrides,
  };
}

describe('VideosService', () => {
  let service: VideosService;
  let videoRepository: VideoRepositoryMock;
  let channelsService: ChannelsServiceMock;
  let storage: StorageServiceMock;
  let processingQueue: ProcessingQueueMock;

  beforeEach(async () => {
    videoRepository = {
      create: jest.fn((entity: Partial<Video>) => ({ ...entity }) as Video),
      save: jest.fn((entity: Video) => Promise.resolve({ ...entity })),
      findOneBy: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue(CHANNEL),
    };
    storage = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
      presignUploadParts: jest.fn((_key: string, _id: string, nums: number[]) =>
        Promise.resolve(
          nums.map((n) => ({ partNumber: n, url: `http://s3/part-${n}` })),
        ),
      ),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      listParts: jest.fn().mockResolvedValue([]),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      presignGet: jest.fn().mockResolvedValue('http://s3/signed'),
      videosBucket: 'videos',
      thumbnailsBucket: 'thumbnails',
    };
    processingQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: ChannelsService, useValue: channelsService },
        { provide: StorageService, useValue: storage },
        {
          provide: storageConfig.KEY,
          useValue: { uploadUrlTtl: UPLOAD_TTL, deliveryUrlTtl: DELIVERY_TTL },
        },
        { provide: VideoProcessingQueue, useValue: processingQueue },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  describe('defaultTitle', () => {
    it('should strip the last extension', () => {
      expect(defaultTitle('minha.aula.mp4')).toBe('minha.aula');
    });

    it('should keep a name without extension', () => {
      expect(defaultTitle('gravacao')).toBe('gravacao');
    });

    it('should fall back to the file name when only an extension remains', () => {
      expect(defaultTitle('.mp4')).toBe('.mp4');
    });

    it('should truncate to 100 characters', () => {
      expect(defaultTitle(`${'a'.repeat(150)}.mp4`)).toHaveLength(100);
    });
  });

  describe('createDraft', () => {
    it('should throw ChannelNotFoundException when the user has no channel', async () => {
      channelsService.findByUserId.mockResolvedValue(null);

      await expect(service.createDraft(USER_ID, buildDto())).rejects.toThrow(
        ChannelNotFoundException,
      );
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('should persist a draft with defaulted title and ceil part count', async () => {
      const fileSize = 2 * VIDEO_PART_SIZE + 1;

      const result = await service.createDraft(USER_ID, buildDto({ fileSize }));

      const saved = videoRepository.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        channel_id: CHANNEL.id,
        title: 'aula',
        status: VideoStatus.DRAFT,
        original_file_name: 'aula.mp4',
        file_size: fileSize,
        upload_id: 'upload-1',
        part_size: VIDEO_PART_SIZE,
        part_count: 3,
      });
      expect(saved.storage_key).toBe(`${saved.id}/source`);
      expect(storage.presignUploadParts).toHaveBeenCalledWith(
        saved.storage_key,
        'upload-1',
        [1, 2, 3],
      );
      expect(result.parts).toHaveLength(3);
      expect(result.status).toBe(VideoStatus.DRAFT);
    });

    it('should keep an explicit title', async () => {
      const result = await service.createDraft(
        USER_ID,
        buildDto({ title: 'Meu vídeo' }),
      );

      expect(result.title).toBe('Meu vídeo');
    });

    it('should set expiresAt from the upload URL TTL', async () => {
      const before = Date.now();

      const result = await service.createDraft(USER_ID, buildDto());

      const expiresAt = Date.parse(result.expiresAt);
      expect(expiresAt).toBeGreaterThanOrEqual(before + UPLOAD_TTL * 1000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + UPLOAD_TTL * 1000);
    });

    it('should retry with a new short id on a short_id unique violation', async () => {
      videoRepository.save
        .mockRejectedValueOnce(uniqueViolation('short_id'))
        .mockImplementationOnce((entity: Video) =>
          Promise.resolve({ ...entity }),
        );

      const result = await service.createDraft(USER_ID, buildDto());

      expect(videoRepository.save).toHaveBeenCalledTimes(2);
      expect(result.shortId).toMatch(/^[0-9A-Za-z]{11}$/);
    });

    it('should abort the multipart upload and rethrow after exhausting retries', async () => {
      videoRepository.save.mockRejectedValue(uniqueViolation('short_id'));

      await expect(service.createDraft(USER_ID, buildDto())).rejects.toThrow(
        QueryFailedError,
      );
      expect(videoRepository.save).toHaveBeenCalledTimes(5);
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        expect.stringMatching(/\/source$/),
        'upload-1',
      );
    });

    it('should not retry other unique violations and abort the upload', async () => {
      videoRepository.save.mockRejectedValue(uniqueViolation('id'));

      await expect(service.createDraft(USER_ID, buildDto())).rejects.toThrow(
        QueryFailedError,
      );
      expect(videoRepository.save).toHaveBeenCalledTimes(1);
      expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
    });
  });

  describe('findOwned', () => {
    it('should look the video up within the caller channel', async () => {
      const video = buildVideo({ status: VideoStatus.READY });
      videoRepository.findOneBy.mockResolvedValue(video);

      await expect(service.findOwned(USER_ID, video.id)).resolves.toBe(video);
      expect(videoRepository.findOneBy).toHaveBeenCalledWith({
        id: video.id,
        channel_id: CHANNEL.id,
      });
    });

    it('should report a video of another channel as not found', async () => {
      videoRepository.findOneBy.mockResolvedValue(null);

      await expect(service.findOwned(USER_ID, 'x')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('should report not found when the caller has no channel', async () => {
      channelsService.findByUserId.mockResolvedValue(null);

      await expect(service.findOwned(USER_ID, 'x')).rejects.toThrow(
        VideoNotFoundException,
      );
      expect(videoRepository.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe('getUploadStatus', () => {
    it('should return the stored parts of the draft', async () => {
      const video = buildVideo();
      const stored = [{ partNumber: 1, etag: 'abc', size: 10 }];
      videoRepository.findOneBy.mockResolvedValue(video);
      storage.listParts.mockResolvedValue(stored);

      const result = await service.getUploadStatus(USER_ID, video.id);

      expect(storage.listParts).toHaveBeenCalledWith(
        video.storage_key,
        'upload-1',
      );
      expect(result).toEqual({
        id: video.id,
        status: VideoStatus.DRAFT,
        partSize: VIDEO_PART_SIZE,
        partCount: 3,
        uploadedParts: stored,
      });
    });

    it.each([VideoStatus.PROCESSING, VideoStatus.READY, VideoStatus.FAILED])(
      'should reject a %s video with VideoNotDraftException',
      async (status) => {
        videoRepository.findOneBy.mockResolvedValue(buildVideo({ status }));

        await expect(service.getUploadStatus(USER_ID, 'x')).rejects.toThrow(
          VideoNotDraftException,
        );
        expect(storage.listParts).not.toHaveBeenCalled();
      },
    );
  });

  describe('reissuePartUrls', () => {
    it('should presign the requested parts in ascending order', async () => {
      const video = buildVideo();
      videoRepository.findOneBy.mockResolvedValue(video);

      const result = await service.reissuePartUrls(USER_ID, video.id, [3, 2]);

      expect(storage.presignUploadParts).toHaveBeenCalledWith(
        video.storage_key,
        'upload-1',
        [2, 3],
      );
      expect(result.parts.map((p) => p.partNumber)).toEqual([2, 3]);
      expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('should reject part numbers beyond the part count', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo());

      await expect(
        service.reissuePartUrls(USER_ID, 'x', [1, 4]),
      ).rejects.toThrow(InvalidPartNumbersException);
      expect(storage.presignUploadParts).not.toHaveBeenCalled();
    });
  });

  describe('completeUpload', () => {
    const PART = VIDEO_PART_SIZE;
    const allParts = [
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: 'e2' },
      { partNumber: 3, etag: '"e3"' },
    ];
    const stored = (lastSize: number) => [
      { partNumber: 1, etag: 'e1', size: PART },
      { partNumber: 2, etag: 'e2', size: PART },
      { partNumber: 3, etag: 'e3', size: lastSize },
    ];

    beforeEach(() => {
      videoRepository.findOneBy.mockResolvedValue(
        buildVideo({ file_size: 2 * PART + 10 }),
      );
    });

    it('should complete, move to processing and enqueue when parts and size match', async () => {
      storage.listParts.mockResolvedValue(stored(10));

      const result = await service.completeUpload(USER_ID, 'x', allParts);

      expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
        expect.stringMatching(/\/source$/),
        'upload-1',
        allParts,
      );
      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: expect.any(String) as string },
        { status: VideoStatus.PROCESSING, upload_id: null },
      );
      expect(processingQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(VideoStatus.PROCESSING);
    });

    it.each([
      ['a missing part', allParts.slice(0, 2)],
      ['a duplicated part', [...allParts.slice(0, 2), allParts[1]]],
      [
        'a part beyond the count',
        [...allParts.slice(0, 2), { partNumber: 4, etag: 'e4' }],
      ],
    ])(
      'should reject %s with UploadIncompleteException',
      async (_label, parts) => {
        await expect(
          service.completeUpload(USER_ID, 'x', parts),
        ).rejects.toThrow(UploadIncompleteException);
        expect(storage.listParts).not.toHaveBeenCalled();
      },
    );

    it('should reject a part whose etag does not match storage', async () => {
      storage.listParts.mockResolvedValue(stored(10));

      await expect(
        service.completeUpload(USER_ID, 'x', [
          ...allParts.slice(0, 2),
          { partNumber: 3, etag: 'other' },
        ]),
      ).rejects.toThrow(UploadIncompleteException);
      expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it('should reject a part that was never stored', async () => {
      storage.listParts.mockResolvedValue(stored(10).slice(0, 2));

      await expect(
        service.completeUpload(USER_ID, 'x', allParts),
      ).rejects.toThrow(UploadIncompleteException);
    });

    it('should abort, mark failed and throw when the stored size differs', async () => {
      storage.listParts.mockResolvedValue(stored(11));

      await expect(
        service.completeUpload(USER_ID, 'x', allParts),
      ).rejects.toThrow(UploadSizeMismatchException);
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        expect.stringMatching(/\/source$/),
        'upload-1',
      );
      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: expect.any(String) as string },
        expect.objectContaining({
          status: VideoStatus.FAILED,
          processing_error: 'UPLOAD_SIZE_MISMATCH',
          upload_id: null,
        }),
      );
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
      expect(processingQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should reject a second completion with VideoNotDraftException', async () => {
      videoRepository.findOneBy.mockResolvedValue(
        buildVideo({ status: VideoStatus.PROCESSING, upload_id: null }),
      );

      await expect(
        service.completeUpload(USER_ID, 'x', allParts),
      ).rejects.toThrow(VideoNotDraftException);
    });
  });

  describe('abortUpload', () => {
    it('should abort the multipart upload and delete the draft row', async () => {
      const video = buildVideo();
      videoRepository.findOneBy.mockResolvedValue(video);

      await service.abortUpload(USER_ID, video.id);

      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        video.storage_key,
        'upload-1',
      );
      expect(videoRepository.delete).toHaveBeenCalledWith({ id: video.id });
    });

    it('should refuse to abort a video that is not a draft', async () => {
      videoRepository.findOneBy.mockResolvedValue(
        buildVideo({ status: VideoStatus.READY, upload_id: null }),
      );

      await expect(service.abortUpload(USER_ID, 'x')).rejects.toThrow(
        VideoNotDraftException,
      );
      expect(videoRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('getDeliveryUrl', () => {
    const ready = () =>
      buildVideo({
        status: VideoStatus.READY,
        upload_id: null,
        thumbnail_key: '33333333-3333-4333-8333-333333333333.jpg',
      });

    it('should look up ready videos only, by short id', async () => {
      videoRepository.findOneBy.mockResolvedValue(ready());

      await service.getDeliveryUrl('AbCdEfGhIjK', 'stream');

      expect(videoRepository.findOneBy).toHaveBeenCalledWith({
        short_id: 'AbCdEfGhIjK',
        status: VideoStatus.READY,
      });
    });

    it('should report a missing or non-ready video as not found', async () => {
      videoRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.getDeliveryUrl('AbCdEfGhIjK', 'download'),
      ).rejects.toThrow(VideoNotFoundException);
      expect(storage.presignGet).not.toHaveBeenCalled();
    });

    it.each(['abc', 'AbCdEfGhIjK-', 'AbCdEfGhIj_'])(
      'should reject the malformed short id %p without querying',
      async (shortId) => {
        await expect(service.getDeliveryUrl(shortId, 'stream')).rejects.toThrow(
          VideoNotFoundException,
        );
        expect(videoRepository.findOneBy).not.toHaveBeenCalled();
      },
    );

    it('should sign an inline public stream URL with the stored content type', async () => {
      const video = ready();
      videoRepository.findOneBy.mockResolvedValue(video);

      const url = await service.getDeliveryUrl(video.short_id, 'stream');

      expect(url).toBe('http://s3/signed');
      expect(storage.presignGet).toHaveBeenCalledWith(
        'videos',
        video.storage_key,
        {
          publicUrl: true,
          ttlSeconds: DELIVERY_TTL,
          contentType: 'video/mp4',
          contentDisposition: undefined,
        },
      );
    });

    it('should sign the download as an attachment named after the original file', async () => {
      const video = ready();
      videoRepository.findOneBy.mockResolvedValue(video);

      await service.getDeliveryUrl(video.short_id, 'download');

      expect(storage.presignGet).toHaveBeenCalledWith(
        'videos',
        video.storage_key,
        expect.objectContaining({
          contentDisposition: 'attachment; filename="aula.mp4"',
        }),
      );
    });

    it('should sign the thumbnail from the thumbnails bucket as JPEG', async () => {
      const video = ready();
      videoRepository.findOneBy.mockResolvedValue(video);

      await service.getDeliveryUrl(video.short_id, 'thumbnail');

      expect(storage.presignGet).toHaveBeenCalledWith(
        'thumbnails',
        video.thumbnail_key,
        {
          publicUrl: true,
          ttlSeconds: DELIVERY_TTL,
          contentType: 'image/jpeg',
        },
      );
    });
  });

  describe('attachmentDisposition', () => {
    it('should quote a plain ASCII file name', () => {
      expect(attachmentDisposition('aula 1.mp4')).toBe(
        'attachment; filename="aula 1.mp4"',
      );
    });

    it('should neutralize quotes and backslashes', () => {
      expect(attachmentDisposition('a"b\\c.mp4')).toBe(
        'attachment; filename="a_b_c.mp4"; filename*=UTF-8\'\'a%22b%5Cc.mp4',
      );
    });

    it('should add an RFC 5987 filename* for non-ASCII names', () => {
      expect(attachmentDisposition('vídeo.mp4')).toBe(
        'attachment; filename="v_deo.mp4"; filename*=UTF-8\'\'v%C3%ADdeo.mp4',
      );
    });
  });
});
