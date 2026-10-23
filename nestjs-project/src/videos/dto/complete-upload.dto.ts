import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_VIDEO_PART_COUNT } from '../videos.constants';

export class CompletedPartDto {
  /** 1-based part number. */
  @IsInt()
  @Min(1)
  partNumber: number;

  /** ETag returned by storage for the part PUT (quotes optional). */
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  /** Every part of the upload, 1..partCount. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VIDEO_PART_COUNT)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];
}
