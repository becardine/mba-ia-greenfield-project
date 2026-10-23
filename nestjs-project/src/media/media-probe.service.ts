import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import {
  NoVideoStreamError,
  ProbeFailedError,
  ThumbnailFailedError,
} from './media.errors';

export interface VideoMetadata {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  formatName: string | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string; format_name?: string };
}

const PROBE_TIMEOUT_MS = 60_000;
const THUMBNAIL_TIMEOUT_MS = 120_000;
const THUMBNAIL_FRACTION = 0.1;
const STDERR_TAIL = 300;

/** Frame offset for the thumbnail: 10% of the duration, 0s for clips under 1s. */
export function thumbnailOffset(durationSeconds: number | null): number {
  if (!durationSeconds || durationSeconds < 1) return 0;
  return Number((durationSeconds * THUMBNAIL_FRACTION).toFixed(3));
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(stderr.trim() || `${cmd} exited with ${code}`));
    });
  });
}

/**
 * Runs the system ffprobe/ffmpeg binaries directly over a (presigned) URL, so
 * a 10GB source is never copied to local disk: both tools read only the bytes
 * they need via HTTP range requests.
 */
@Injectable()
export class MediaProbeService {
  async probe(url: string): Promise<VideoMetadata> {
    let output: FfprobeOutput;
    try {
      const raw = await run(
        'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          url,
        ],
        PROBE_TIMEOUT_MS,
      );
      output = JSON.parse(raw.toString()) as FfprobeOutput;
    } catch (err) {
      throw new ProbeFailedError((err as Error).message);
    }

    const streams = output.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    if (!video) throw new NoVideoStreamError();
    const audio = streams.find((s) => s.codec_type === 'audio');

    return {
      durationSeconds:
        toNumber(output.format?.duration) ?? toNumber(video.duration),
      width: video.width ?? null,
      height: video.height ?? null,
      videoCodec: video.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      bitrate: toNumber(output.format?.bit_rate),
      formatName: output.format?.format_name ?? null,
    };
  }

  /** Extracts one JPEG frame at `atSeconds`. */
  async extractThumbnail(url: string, atSeconds: number): Promise<Buffer> {
    let jpeg: Buffer;
    try {
      jpeg = await run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-ss',
          String(atSeconds),
          '-i',
          url,
          '-frames:v',
          '1',
          '-f',
          'image2',
          '-c:v',
          'mjpeg',
          'pipe:1',
        ],
        THUMBNAIL_TIMEOUT_MS,
      );
    } catch (err) {
      throw new ThumbnailFailedError((err as Error).message);
    }
    if (jpeg.length === 0) {
      throw new ThumbnailFailedError('no frame decoded');
    }
    return jpeg;
  }
}
