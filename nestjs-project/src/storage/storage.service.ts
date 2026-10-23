import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import type {
  CompletedPart,
  PresignedPart,
  PresignGetOptions,
  StoredPart,
} from './storage.types';

const stripQuotes = (etag: string): string => etag.replace(/"/g, '');

@Injectable()
export class StorageService implements OnModuleInit {
  // Server-side calls go through the Compose network; URLs handed to clients
  // must be signed for a host they can reach (the signature covers the host).
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.internalClient = this.createClient(config.endpoint);
    this.publicClient = this.createClient(config.publicEndpoint);
  }

  get videosBucket(): string {
    return this.config.videosBucket;
  }

  get thumbnailsBucket(): string {
    return this.config.thumbnailsBucket;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket(this.config.videosBucket);
    await this.ensureBucket(this.config.thumbnailsBucket);
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const { UploadId } = await this.internalClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!UploadId) {
      throw new Error(`Storage returned no UploadId for ${key}`);
    }
    return UploadId;
  }

  async presignUploadParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<PresignedPart[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.publicClient,
          new UploadPartCommand({
            Bucket: this.config.videosBucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: this.config.uploadUrlTtl },
        ),
      })),
    );
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const parts: StoredPart[] = [];
    let marker: string | undefined;

    do {
      const page = await this.internalClient.send(
        new ListPartsCommand({
          Bucket: this.config.videosBucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const part of page.Parts ?? []) {
        parts.push({
          partNumber: part.PartNumber ?? 0,
          etag: stripQuotes(part.ETag ?? ''),
          size: part.Size ?? 0,
        });
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);

    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.internalClient.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.internalClient.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async presignGet(
    bucket: string,
    key: string,
    options: PresignGetOptions,
  ): Promise<string> {
    return getSignedUrl(
      options.publicUrl ? this.publicClient : this.internalClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: options.contentDisposition,
      }),
      { expiresIn: options.ttlSeconds },
    );
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.internalClient.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  }

  private createClient(endpoint: string): S3Client {
    return new S3Client({
      endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      forcePathStyle: true,
      // Default flexible checksums would be baked into presigned UploadPart URLs
      // (checksum of an empty body), breaking direct client uploads.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err) {
      if (
        err instanceof S3ServiceException &&
        err.$metadata.httpStatusCode === 404
      ) {
        await this.internalClient.send(
          new CreateBucketCommand({ Bucket: bucket }),
        );
        return;
      }
      throw err;
    }
  }
}
