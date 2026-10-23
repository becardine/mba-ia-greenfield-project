export interface PresignedPart {
  partNumber: number;
  url: string;
}

export interface StoredPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface PresignGetOptions {
  /** Signs with the public endpoint (client-facing URL) when true; internal endpoint otherwise. */
  publicUrl: boolean;
  ttlSeconds: number;
  contentType?: string;
  contentDisposition?: string;
}
