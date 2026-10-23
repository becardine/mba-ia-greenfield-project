import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../video-status.enum';

export class PresignedPartResponse {
  @ApiProperty({ example: 1 })
  partNumber: number;

  @ApiProperty({
    description: 'Presigned UploadPart URL — PUT the part bytes directly here',
  })
  url: string;
}

export class UploadSessionResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'aZ3kQ9xT0bL' })
  shortId: string;

  @ApiProperty({ example: 'aula' })
  title: string;

  @ApiProperty({ enum: [VideoStatus.DRAFT], example: VideoStatus.DRAFT })
  status: VideoStatus;

  @ApiProperty({ example: 67108864 })
  partSize: number;

  @ApiProperty({ example: 3 })
  partCount: number;

  @ApiProperty({ type: [PresignedPartResponse] })
  parts: PresignedPartResponse[];

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}
