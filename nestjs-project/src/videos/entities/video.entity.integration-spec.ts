import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus } from '../video-status.enum';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const TEN_GIB = 10 * 1024 ** 3;

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${n}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `chan${n}`,
        nickname: `video_chan_${n}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channelId: string, overrides: Partial<Video> = {}) {
    const n = ++counter;
    return videoRepository.create({
      channel_id: channelId,
      short_id: `short${String(n).padStart(6, '0')}`,
      title: 'My video',
      original_file_name: 'my-video.mp4',
      content_type: 'video/mp4',
      file_size: 1024,
      storage_key: `key-${n}/source`,
      part_size: 64 * 1024 * 1024,
      part_count: 1,
      ...overrides,
    });
  }

  it('should default status to draft and leave metadata columns null', async () => {
    const channel = await createChannel();

    const saved = await videoRepository.save(buildVideo(channel.id));
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.status).toBe(VideoStatus.DRAFT);
    expect(found).toMatchObject({
      upload_id: null,
      thumbnail_key: null,
      duration_seconds: null,
      width: null,
      height: null,
      video_codec: null,
      audio_codec: null,
      bitrate: null,
      format_name: null,
      processing_error: null,
      processed_at: null,
    });
    expect(found.created_at).toBeInstanceOf(Date);
    expect(found.updated_at).toBeInstanceOf(Date);
  });

  it('should enforce a unique short_id', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      buildVideo(channel.id, { short_id: 'AAAAAAAAAAA' }),
    );

    await expect(
      videoRepository.save(buildVideo(channel.id, { short_id: 'AAAAAAAAAAA' })),
    ).rejects.toThrow(QueryFailedError);
  });

  it('should read bigint columns back as numbers, including 10GiB', async () => {
    const channel = await createChannel();

    const saved = await videoRepository.save(
      buildVideo(channel.id, { file_size: TEN_GIB, bitrate: 5_000_000_000 }),
    );
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.file_size).toBe(TEN_GIB);
    expect(found.bitrate).toBe(5_000_000_000);
  });

  it('should delete videos in cascade when the channel is removed', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel.id));

    await channelRepository.delete({ id: channel.id });

    expect(await videoRepository.findOneBy({ id: saved.id })).toBeNull();
  });

  it('should reject a video for a channel that does not exist', async () => {
    await expect(
      videoRepository.save(buildVideo('00000000-0000-4000-8000-000000000000')),
    ).rejects.toThrow(QueryFailedError);
  });
});
