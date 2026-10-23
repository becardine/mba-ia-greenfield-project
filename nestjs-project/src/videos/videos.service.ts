import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { isPgUniqueViolationOnColumn } from '../common/database/pg-errors';
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
import type { CompletedPart } from '../storage/storage.types';
import type { CreateVideoDto } from './dto/create-video.dto';
import type { PartUrlsResponse } from './dto/part-urls.response';
import type { UploadStatusResponse } from './dto/upload-status.response';
import type { VideoStatusResponse } from './dto/video-status.response';
import type { UploadSessionResponse } from './dto/upload-session.response';
import { Video } from './entities/video.entity';
import { generateShortId, SHORT_ID_PATTERN } from './short-id.util';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideoStatus } from './video-status.enum';
import {
  MAX_VIDEO_FILE_SIZE,
  MAX_VIDEO_TITLE_LENGTH,
  SHORT_ID_COLUMN,
  SHORT_ID_MAX_ATTEMPTS,
  THUMBNAIL_CONTENT_TYPE,
  UPLOAD_SIZE_MISMATCH_REASON,
  VIDEO_PART_SIZE,
} from './videos.constants';

const stripQuotes = (etag: string): string => etag.replace(/"/g, '');

export type DeliveryKind = 'stream' | 'download' | 'thumbnail';

/**
 * `attachment` disposition with an ASCII-safe `filename` (quotes, backslashes
 * and non-printable/non-ASCII characters replaced) plus RFC 5987 `filename*`
 * when the original name is not plain ASCII.
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const disposition = `attachment; filename="${ascii}"`;
  return ascii === fileName
    ? disposition
    : `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function defaultTitle(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  return (withoutExtension || fileName).slice(0, MAX_VIDEO_TITLE_LENGTH);
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storage: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
    private readonly processingQueue: VideoProcessingQueue,
  ) {}

  async createDraft(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<UploadSessionResponse> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) throw new ChannelNotFoundException();

    const id = randomUUID();
    const storageKey = `${id}/source`;
    const partCount = Math.ceil(dto.fileSize / VIDEO_PART_SIZE);
    const uploadId = await this.storage.createMultipartUpload(
      storageKey,
      dto.contentType,
    );

    let video: Video;
    try {
      video = await this.saveWithUniqueShortId(
        this.videoRepository.create({
          id,
          channel_id: channel.id,
          title: dto.title ?? defaultTitle(dto.fileName),
          status: VideoStatus.DRAFT,
          original_file_name: dto.fileName,
          content_type: dto.contentType,
          file_size: dto.fileSize,
          storage_key: storageKey,
          upload_id: uploadId,
          part_size: VIDEO_PART_SIZE,
          part_count: partCount,
        }),
      );
    } catch (err) {
      // Compensation: never leave an orphan multipart upload behind
      await this.storage.abortMultipartUpload(storageKey, uploadId);
      throw err;
    }

    const parts = await this.storage.presignUploadParts(
      storageKey,
      uploadId,
      Array.from({ length: partCount }, (_, i) => i + 1),
    );

    return {
      id: video.id,
      shortId: video.short_id,
      title: video.title,
      status: video.status,
      partSize: video.part_size,
      partCount: video.part_count,
      parts,
      expiresAt: this.uploadUrlsExpiry(),
    };
  }

  async getUploadStatus(
    userId: string,
    id: string,
  ): Promise<UploadStatusResponse> {
    const video = await this.findOwnedDraft(userId, id);
    const uploadedParts = await this.storage.listParts(
      video.storage_key,
      video.upload_id!,
    );
    return {
      id: video.id,
      status: video.status,
      partSize: video.part_size,
      partCount: video.part_count,
      uploadedParts,
    };
  }

  async reissuePartUrls(
    userId: string,
    id: string,
    partNumbers: number[],
  ): Promise<PartUrlsResponse> {
    const video = await this.findOwnedDraft(userId, id);
    if (partNumbers.some((n) => n > video.part_count)) {
      throw new InvalidPartNumbersException(video.part_count);
    }
    const parts = await this.storage.presignUploadParts(
      video.storage_key,
      video.upload_id!,
      [...partNumbers].sort((a, b) => a - b),
    );
    return { parts, expiresAt: this.uploadUrlsExpiry() };
  }

  async completeUpload(
    userId: string,
    id: string,
    parts: CompletedPart[],
  ): Promise<VideoStatusResponse> {
    const video = await this.findOwnedDraft(userId, id);
    const uploadId = video.upload_id!;

    const declared = new Set(parts.map((p) => p.partNumber));
    const coversAllParts =
      declared.size === parts.length &&
      parts.length === video.part_count &&
      parts.every((p) => p.partNumber >= 1 && p.partNumber <= video.part_count);
    if (!coversAllParts) {
      throw new UploadIncompleteException(
        `expected parts 1..${video.part_count}`,
      );
    }

    // The stored parts are the source of truth: presigned URLs do not bound
    // part sizes, so the 10GiB limit is enforced on what S3 actually holds.
    const stored = new Map(
      (await this.storage.listParts(video.storage_key, uploadId)).map((p) => [
        p.partNumber,
        p,
      ]),
    );
    const mismatched = parts.find(
      (p) => stripQuotes(p.etag) !== stored.get(p.partNumber)?.etag,
    );
    if (mismatched) {
      throw new UploadIncompleteException(
        `part ${mismatched.partNumber} is missing or its etag does not match`,
      );
    }

    const storedSize = parts.reduce(
      (sum, p) => sum + stored.get(p.partNumber)!.size,
      0,
    );
    if (storedSize !== video.file_size || storedSize > MAX_VIDEO_FILE_SIZE) {
      await this.storage.abortMultipartUpload(video.storage_key, uploadId);
      await this.videoRepository.update(
        { id: video.id },
        {
          status: VideoStatus.FAILED,
          processing_error: UPLOAD_SIZE_MISMATCH_REASON,
          upload_id: null,
          processed_at: new Date(),
        },
      );
      throw new UploadSizeMismatchException();
    }

    await this.storage.completeMultipartUpload(
      video.storage_key,
      uploadId,
      parts,
    );
    await this.videoRepository.update(
      { id: video.id },
      { status: VideoStatus.PROCESSING, upload_id: null },
    );
    await this.processingQueue.enqueue(video.id);

    return {
      id: video.id,
      shortId: video.short_id,
      status: VideoStatus.PROCESSING,
    };
  }

  async abortUpload(userId: string, id: string): Promise<void> {
    const video = await this.findOwnedDraft(userId, id);
    await this.storage.abortMultipartUpload(
      video.storage_key,
      video.upload_id!,
    );
    await this.videoRepository.delete({ id: video.id });
  }

  /** Public lookup: only `ready` videos exist for viewers (owner included). */
  async findReadyByShortId(shortId: string): Promise<Video> {
    const video = SHORT_ID_PATTERN.test(shortId)
      ? await this.videoRepository.findOneBy({
          short_id: shortId,
          status: VideoStatus.READY,
        })
      : null;
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  /** Presigned client URL (public endpoint) for streaming, downloading or the thumbnail. */
  async getDeliveryUrl(shortId: string, kind: DeliveryKind): Promise<string> {
    const video = await this.findReadyByShortId(shortId);
    const ttlSeconds = this.storageCfg.deliveryUrlTtl;

    if (kind === 'thumbnail') {
      return this.storage.presignGet(
        this.storage.thumbnailsBucket,
        video.thumbnail_key!,
        { publicUrl: true, ttlSeconds, contentType: THUMBNAIL_CONTENT_TYPE },
      );
    }
    return this.storage.presignGet(
      this.storage.videosBucket,
      video.storage_key,
      {
        publicUrl: true,
        ttlSeconds,
        contentType: video.content_type,
        contentDisposition:
          kind === 'download'
            ? attachmentDisposition(video.original_file_name)
            : undefined,
      },
    );
  }

  /** Video of the caller's channel, any status; a foreign video is reported as missing. */
  async findOwned(userId: string, id: string): Promise<Video> {
    const channel = await this.channelsService.findByUserId(userId);
    const video = channel
      ? await this.videoRepository.findOneBy({ id, channel_id: channel.id })
      : null;
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  private async findOwnedDraft(userId: string, id: string): Promise<Video> {
    const video = await this.findOwned(userId, id);
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new VideoNotDraftException();
    }
    return video;
  }

  private async saveWithUniqueShortId(video: Video): Promise<Video> {
    for (let attempt = 1; ; attempt++) {
      video.short_id = generateShortId();
      try {
        return await this.videoRepository.save(video);
      } catch (err) {
        const retryable =
          isPgUniqueViolationOnColumn(err, SHORT_ID_COLUMN) &&
          attempt < SHORT_ID_MAX_ATTEMPTS;
        if (!retryable) throw err;
      }
    }
  }

  private uploadUrlsExpiry(): string {
    return new Date(
      Date.now() + this.storageCfg.uploadUrlTtl * 1000,
    ).toISOString();
  }
}
