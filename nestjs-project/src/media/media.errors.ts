/**
 * Media failures carry a stable `reason` that the worker persists as the
 * video's `processing_error`. They are worker-side errors, not HTTP ones.
 */
export abstract class MediaError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NoVideoStreamError extends MediaError {
  constructor() {
    super('NO_VIDEO_STREAM', 'The file has no video stream');
  }
}

export class ProbeFailedError extends MediaError {
  constructor(detail: string) {
    super(`PROBE_FAILED: ${detail}`, `ffprobe failed: ${detail}`);
  }
}

export class ThumbnailFailedError extends MediaError {
  constructor(detail: string) {
    super(`THUMBNAIL_FAILED: ${detail}`, `ffmpeg thumbnail failed: ${detail}`);
  }
}
