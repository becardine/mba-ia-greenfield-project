import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { type Job, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import storageConfig from '../config/storage.config';
import {
  MediaProbeService,
  thumbnailOffset,
} from '../media/media-probe.service';
import {
  MediaError,
  NoVideoStreamError,
  ProbeFailedError,
} from '../media/media.errors';
import { StorageService } from '../storage/storage.service';
import { Video } from '../videos/entities/video.entity';
import {
  type ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from '../videos/video-processing.constants';
import { VideoStatus } from '../videos/video-status.enum';
import { THUMBNAIL_CONTENT_TYPE } from '../videos/videos.constants';

/**
 * Consumes `process-video` jobs: extracts metadata with ffprobe, stores a
 * thumbnail and closes the status lifecycle (processing → ready | failed).
 * Registered only in the worker runtime, never in the HTTP API.
 */
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storage: StorageService,
    private readonly media: MediaProbeService,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const { videoId } = job.data;
    const video = await this.videoRepository.findOneBy({ id: videoId });
    // At-least-once delivery: a redelivered or stale job must be a no-op
    if (!video || video.status !== VideoStatus.PROCESSING) {
      this.logger.warn(`Skipping job for video ${videoId}: not processing`);
      return;
    }

    const sourceUrl = await this.storage.presignGet(
      this.storage.videosBucket,
      video.storage_key,
      { publicUrl: false, ttlSeconds: this.storageCfg.deliveryUrlTtl },
    );

    const metadata = await this.probe(sourceUrl);
    const thumbnail = await this.media.extractThumbnail(
      sourceUrl,
      thumbnailOffset(metadata.durationSeconds),
    );
    const thumbnailKey = `${video.id}.jpg`;
    await this.storage.putObject(
      this.storage.thumbnailsBucket,
      thumbnailKey,
      thumbnail,
      THUMBNAIL_CONTENT_TYPE,
    );

    await this.videoRepository.update(
      { id: video.id },
      {
        status: VideoStatus.READY,
        thumbnail_key: thumbnailKey,
        duration_seconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        video_codec: metadata.videoCodec,
        audio_codec: metadata.audioCodec,
        bitrate: metadata.bitrate,
        format_name: metadata.formatName,
        processing_error: null,
        processed_at: new Date(),
      },
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const isFinal =
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!isFinal) return;

    // Event handler context: a throw here would crash the worker, so log instead
    try {
      await this.videoRepository.update(
        { id: job.data.videoId, status: VideoStatus.PROCESSING },
        {
          status: VideoStatus.FAILED,
          processing_error:
            error instanceof MediaError ? error.reason : error.message,
          processed_at: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(
        `Could not mark video ${job.data.videoId} as failed`,
        (err as Error).stack,
      );
    }
  }

  private async probe(url: string) {
    try {
      return await this.media.probe(url);
    } catch (err) {
      // Retrying cannot turn a non-video or unreadable file into a video
      if (
        err instanceof NoVideoStreamError ||
        err instanceof ProbeFailedError
      ) {
        throw new UnrecoverableError(err.reason);
      }
      throw err;
    }
  }
}
