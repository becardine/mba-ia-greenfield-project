import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PROCESS_VIDEO_JOB,
  type ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from './video-processing.constants';

@Injectable()
export class VideoProcessingQueue {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessVideoJobData>,
  ) {}

  /** Idempotent: jobId = videoId, so a repeated enqueue is ignored by BullMQ. */
  async enqueue(videoId: string): Promise<void> {
    await this.queue.add(PROCESS_VIDEO_JOB, { videoId }, { jobId: videoId });
  }
}
