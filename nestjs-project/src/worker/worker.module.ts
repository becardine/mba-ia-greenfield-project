import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { Video } from '../videos/entities/video.entity';
import {
  VIDEO_PROCESSING_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from '../videos/video-processing.constants';
import { VideoProcessor } from './video.processor';

/** Root module of the video worker runtime (no HTTP layer). */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    QueueModule,
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
      defaultJobOptions: VIDEO_PROCESSING_JOB_OPTIONS,
    }),
    TypeOrmModule.forFeature([Video]),
    // Video → Channel → User relations need their entities registered by the
    // owning modules, or the worker DataSource cannot build its metadata
    UsersModule,
    StorageModule,
    MediaModule,
  ],
  providers: [VideoProcessor],
})
export class WorkerModule {}
