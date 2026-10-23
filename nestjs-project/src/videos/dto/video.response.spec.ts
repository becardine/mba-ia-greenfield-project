import type { Video } from '../entities/video.entity';
import { VideoStatus } from '../video-status.enum';
import { toVideoResponse } from './video.response';

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    channel_id: '22222222-2222-4222-8222-222222222222',
    short_id: 'AbCdEfGhIjK',
    title: 'aula',
    status: VideoStatus.READY,
    original_file_name: 'aula.mp4',
    content_type: 'video/mp4',
    file_size: 10737418240,
    storage_key: '33333333-3333-4333-8333-333333333333/source',
    upload_id: null,
    part_size: 67108864,
    part_count: 160,
    thumbnail_key: '33333333-3333-4333-8333-333333333333.jpg',
    duration_seconds: 2.04,
    width: 320,
    height: 240,
    video_codec: 'h264',
    audio_codec: 'aac',
    bitrate: 512000,
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    processing_error: null,
    processed_at: new Date('2026-10-23T12:00:02.000Z'),
    created_at: new Date('2026-10-23T12:00:00.000Z'),
    updated_at: new Date('2026-10-23T12:00:03.000Z'),
    ...overrides,
  } as Video;
}

describe('toVideoResponse', () => {
  it('should map entity columns to the camelCase contract with ISO dates', () => {
    expect(toVideoResponse(buildVideo())).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      shortId: 'AbCdEfGhIjK',
      title: 'aula',
      status: 'ready',
      originalFileName: 'aula.mp4',
      contentType: 'video/mp4',
      fileSize: 10737418240,
      durationSeconds: 2.04,
      width: 320,
      height: 240,
      videoCodec: 'h264',
      audioCodec: 'aac',
      bitrate: 512000,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      processingError: null,
      processedAt: '2026-10-23T12:00:02.000Z',
      createdAt: '2026-10-23T12:00:00.000Z',
      updatedAt: '2026-10-23T12:00:03.000Z',
    });
  });

  it('should preserve nulls for an unprocessed video', () => {
    const response = toVideoResponse(
      buildVideo({
        status: VideoStatus.DRAFT,
        duration_seconds: null,
        width: null,
        height: null,
        video_codec: null,
        audio_codec: null,
        bitrate: null,
        format_name: null,
        processed_at: null,
      }),
    );

    expect(response).toMatchObject({
      durationSeconds: null,
      width: null,
      height: null,
      videoCodec: null,
      audioCodec: null,
      bitrate: null,
      formatName: null,
      processedAt: null,
    });
  });

  it('should never expose storage internals', () => {
    const response = toVideoResponse(buildVideo({ upload_id: 'u-1' }));

    expect(response).not.toHaveProperty('uploadId');
    expect(response).not.toHaveProperty('storageKey');
    expect(response).not.toHaveProperty('thumbnailKey');
    expect(response).not.toHaveProperty('channelId');
  });
});
