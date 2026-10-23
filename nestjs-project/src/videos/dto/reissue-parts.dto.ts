import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';
import { MAX_VIDEO_PART_COUNT } from '../videos.constants';

export class ReissuePartsDto {
  /** Part numbers (1-based) that need fresh presigned URLs. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VIDEO_PART_COUNT)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}
