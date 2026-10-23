import { ApiProperty } from '@nestjs/swagger';
import { PresignedPartResponse } from './upload-session.response';

export class PartUrlsResponse {
  @ApiProperty({ type: [PresignedPartResponse] })
  parts: PresignedPartResponse[];

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}
