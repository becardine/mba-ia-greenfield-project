import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../video-status.enum';

export class UploadedPartResponse {
  @ApiProperty({ example: 1 })
  partNumber: number;

  @ApiProperty({ example: '9b2cf535f27731c974343645a3985328' })
  etag: string;

  @ApiProperty({ example: 67108864 })
  size: number;
}

export class UploadStatusResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: [VideoStatus.DRAFT], example: VideoStatus.DRAFT })
  status: VideoStatus;

  @ApiProperty({ example: 67108864 })
  partSize: number;

  @ApiProperty({ example: 3 })
  partCount: number;

  @ApiProperty({ type: [UploadedPartResponse] })
  uploadedParts: UploadedPartResponse[];
}
