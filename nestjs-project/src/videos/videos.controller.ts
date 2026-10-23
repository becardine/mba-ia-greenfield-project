import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Redirect,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { PartUrlsResponse } from './dto/part-urls.response';
import { ReissuePartsDto } from './dto/reissue-parts.dto';
import { UploadSessionResponse } from './dto/upload-session.response';
import { UploadStatusResponse } from './dto/upload-status.response';
import { VideoStatusResponse } from './dto/video-status.response';
import { toVideoResponse, VideoResponse } from './dto/video.response';
import { type DeliveryKind, VideosService } from './videos.service';

const errorSchema = { $ref: getSchemaPath(ApiErrorEnvelope) };
const shortIdParam = {
  name: 'shortId',
  description: 'Public short id of the video (11 base62 characters)',
  example: 'aZ3kQ9xT0bL',
} as const;
const redirectResponse = (description: string) => ({
  status: 302,
  description,
  headers: {
    Location: {
      description:
        'Presigned object-storage URL (valid S3_DELIVERY_URL_TTL seconds)',
      schema: { type: 'string', format: 'uri' },
    },
  },
});
const notReadyResponse = {
  status: 404,
  description:
    'Unknown short id, or the video is not ready yet (VIDEO_NOT_FOUND)',
  schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
};

interface RedirectTarget {
  url: string;
}

const videoIdParam = {
  name: 'id',
  description: 'Video id (UUID)',
  format: 'uuid',
} as const;

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Pre-register a video and start its upload',
    description:
      'Creates the video as a draft in the caller’s channel, starts a multipart upload in object storage and returns one presigned URL per part. The client PUTs each part directly to storage — the file never passes through the API.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created; part URLs issued',
    type: UploadSessionResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (size, content type, unknown fields)',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'The authenticated user has no channel (CHANNEL_NOT_FOUND)',
    schema: errorSchema,
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<UploadSessionResponse> {
    return this.videosService.createDraft(user.sub, dto);
  }

  @Get(':id')
  @ApiBearerAuth('access-token')
  @ApiParam(videoIdParam)
  @ApiOperation({
    summary: 'Get a video owned by the caller',
    description:
      'Returns the status lifecycle and the metadata extracted by processing, in any status. Owner only — this is how the owner follows a video before it is ready.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video details',
    type: VideoResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Malformed id',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not owned (VIDEO_NOT_FOUND)',
    schema: errorSchema,
  })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoResponse> {
    return toVideoResponse(await this.videosService.findOwned(user.sub, id));
  }

  @Get(':id/upload')
  @ApiBearerAuth('access-token')
  @ApiParam(videoIdParam)
  @ApiOperation({
    summary: 'Get upload progress of a draft',
    description:
      'Lists the parts already stored for an in-progress draft so an interrupted upload can be resumed. Owner only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stored parts of the multipart upload',
    type: UploadStatusResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Malformed id',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not owned (VIDEO_NOT_FOUND)',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'Video is no longer a draft (VIDEO_NOT_DRAFT)',
    schema: errorSchema,
  })
  async getUploadStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UploadStatusResponse> {
    return this.videosService.getUploadStatus(user.sub, id);
  }

  @Post(':id/upload/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiParam(videoIdParam)
  @ApiOperation({
    summary: 'Re-issue presigned part URLs',
    description:
      'Returns fresh presigned UploadPart URLs for the given part numbers of an in-progress draft (e.g. after the previous URLs expired). Owner only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Fresh part URLs',
    type: PartUrlsResponse,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, or a part number exceeds the part count (INVALID_PART_NUMBERS)',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not owned (VIDEO_NOT_FOUND)',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'Video is no longer a draft (VIDEO_NOT_DRAFT)',
    schema: errorSchema,
  })
  async reissuePartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReissuePartsDto,
  ): Promise<PartUrlsResponse> {
    return this.videosService.reissuePartUrls(user.sub, id, dto.partNumbers);
  }

  @Post(':id/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiParam(videoIdParam)
  @ApiOperation({
    summary: 'Complete the upload and start processing',
    description:
      'Verifies the stored parts (coverage, ETags and real size against the declared size), assembles the file, moves the video to processing and enqueues the processing job. A size mismatch aborts the upload and marks the video as failed. Owner only.',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload completed; processing queued',
    type: VideoStatusResponse,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, parts missing/mismatched (UPLOAD_INCOMPLETE) or stored size differs from the declared size (UPLOAD_SIZE_MISMATCH)',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not owned (VIDEO_NOT_FOUND)',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'Video is no longer a draft (VIDEO_NOT_DRAFT)',
    schema: errorSchema,
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<VideoStatusResponse> {
    return this.videosService.completeUpload(user.sub, id, dto.parts);
  }

  @Delete(':id/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiParam(videoIdParam)
  @ApiOperation({
    summary: 'Abort a draft upload',
    description:
      'Aborts the multipart upload (discarding stored parts) and deletes the draft. Owner only.',
  })
  @ApiResponse({ status: 204, description: 'Draft aborted and removed' })
  @ApiResponse({
    status: 400,
    description: 'Malformed id',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not owned (VIDEO_NOT_FOUND)',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'Video is no longer a draft (VIDEO_NOT_DRAFT)',
    schema: errorSchema,
  })
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.videosService.abortUpload(user.sub, id);
  }

  @Public()
  @Get(':shortId/stream')
  @Redirect()
  @Header('Cache-Control', 'no-store')
  @ApiParam(shortIdParam)
  @ApiOperation({
    summary: 'Stream a ready video',
    description:
      'Redirects to a presigned URL served inline by object storage, which answers Range requests with 206 Partial Content — playback starts without downloading the whole file. Public; only ready videos are reachable.',
  })
  @ApiResponse(redirectResponse('Redirect to the inline video URL'))
  @ApiResponse(notReadyResponse)
  async stream(@Param('shortId') shortId: string): Promise<RedirectTarget> {
    return this.redirectTo(shortId, 'stream');
  }

  @Public()
  @Get(':shortId/download')
  @Redirect()
  @Header('Cache-Control', 'no-store')
  @ApiParam(shortIdParam)
  @ApiOperation({
    summary: 'Download a ready video',
    description:
      'Redirects to a presigned URL that makes object storage send the file as an attachment named after the original file name. Public; only ready videos are reachable.',
  })
  @ApiResponse(redirectResponse('Redirect to the attachment download URL'))
  @ApiResponse(notReadyResponse)
  async download(@Param('shortId') shortId: string): Promise<RedirectTarget> {
    return this.redirectTo(shortId, 'download');
  }

  @Public()
  @Get(':shortId/thumbnail')
  @Redirect()
  @Header('Cache-Control', 'no-store')
  @ApiParam(shortIdParam)
  @ApiOperation({
    summary: 'Get the thumbnail of a ready video',
    description:
      'Redirects to a presigned URL of the JPEG thumbnail generated during processing. Public; only ready videos are reachable.',
  })
  @ApiResponse(redirectResponse('Redirect to the JPEG thumbnail URL'))
  @ApiResponse(notReadyResponse)
  async thumbnail(@Param('shortId') shortId: string): Promise<RedirectTarget> {
    return this.redirectTo(shortId, 'thumbnail');
  }

  private async redirectTo(
    shortId: string,
    kind: DeliveryKind,
  ): Promise<RedirectTarget> {
    return { url: await this.videosService.getDeliveryUrl(shortId, kind) };
  }
}
