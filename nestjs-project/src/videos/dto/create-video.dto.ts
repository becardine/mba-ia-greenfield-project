import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ALLOWED_VIDEO_CONTENT_TYPES,
  MAX_VIDEO_FILE_SIZE,
  MAX_VIDEO_TITLE_LENGTH,
} from '../videos.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateVideoDto {
  /** Original file name, e.g. `aula.mp4`. Used as the download file name. */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName: string;

  /** Declared size in bytes (1 byte up to 10GiB). */
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_FILE_SIZE)
  fileSize: number;

  /** MIME type of the file. */
  @IsIn(ALLOWED_VIDEO_CONTENT_TYPES)
  contentType: (typeof ALLOWED_VIDEO_CONTENT_TYPES)[number];

  /** Optional title; defaults to the file name without its extension. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_VIDEO_TITLE_LENGTH)
  title?: string;
}
