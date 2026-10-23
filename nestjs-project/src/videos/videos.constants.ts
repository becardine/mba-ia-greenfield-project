export const VIDEO_PART_SIZE = 64 * 1024 * 1024;
export const MAX_VIDEO_FILE_SIZE = 10 * 1024 ** 3;
export const MAX_VIDEO_PART_COUNT = Math.ceil(
  MAX_VIDEO_FILE_SIZE / VIDEO_PART_SIZE,
);
export const MAX_VIDEO_TITLE_LENGTH = 100;
export const SHORT_ID_MAX_ATTEMPTS = 5;
export const SHORT_ID_COLUMN = 'short_id';

export const ALLOWED_VIDEO_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
] as const;

export const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';
export const UPLOAD_SIZE_MISMATCH_REASON = 'UPLOAD_SIZE_MISMATCH';
