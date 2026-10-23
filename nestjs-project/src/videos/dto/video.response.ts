import { ApiProperty } from '@nestjs/swagger';
import type { Video } from '../entities/video.entity';
import { VideoStatus } from '../video-status.enum';

export class VideoResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'aZ3kQ9xT0bL' })
  shortId: string;

  @ApiProperty({ example: 'aula' })
  title: string;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiProperty({ example: 'aula.mp4' })
  originalFileName: string;

  @ApiProperty({ example: 'video/mp4' })
  contentType: string;

  @ApiProperty({ example: 134217729 })
  fileSize: number;

  @ApiProperty({ type: Number, nullable: true, example: 2.04 })
  durationSeconds: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1920 })
  width: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1080 })
  height: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'h264' })
  videoCodec: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'aac' })
  audioCodec: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 5000000 })
  bitrate: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'mov,mp4,m4a,3gp,3g2,mj2',
  })
  formatName: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  processingError: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  processedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export function toVideoResponse(video: Video): VideoResponse {
  return {
    id: video.id,
    shortId: video.short_id,
    title: video.title,
    status: video.status,
    originalFileName: video.original_file_name,
    contentType: video.content_type,
    fileSize: video.file_size,
    durationSeconds: video.duration_seconds,
    width: video.width,
    height: video.height,
    videoCodec: video.video_codec,
    audioCodec: video.audio_codec,
    bitrate: video.bitrate,
    formatName: video.format_name,
    processingError: video.processing_error,
    processedAt: video.processed_at?.toISOString() ?? null,
    createdAt: video.created_at.toISOString(),
    updatedAt: video.updated_at.toISOString(),
  };
}
