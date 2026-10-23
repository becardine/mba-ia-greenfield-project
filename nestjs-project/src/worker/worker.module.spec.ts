import { Test } from '@nestjs/testing';
import { VideosController } from '../videos/videos.controller';
import { VideoProcessor } from './video.processor';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should compile the processor without any HTTP controller', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module.get(VideoProcessor)).toBeInstanceOf(VideoProcessor);
    expect(() => module.get(VideosController)).toThrow();
    await module.close();
  }, 30000);
});
