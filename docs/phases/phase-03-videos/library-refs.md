---
libs:
  "bullmq":
    version: "6.4.1"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-23T21:33:43+00:00"
  "@nestjs/bullmq":
    version: "11.0.5"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-23T21:33:43+00:00"
  "ioredis":
    version: "5.11.1"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-23T22:45:00+00:00"
  "@aws-sdk/client-s3":
    version: "3.1156.0"
    context7_id: "/websites/aws_amazon_awsjavascriptsdk_v3"
    fetched_at: "2026-10-23T21:33:43+00:00"
  "@aws-sdk/s3-request-presigner":
    version: "3.1156.0"
    context7_id: "/websites/aws_amazon_awsjavascriptsdk_v3"
    fetched_at: "2026-10-23T21:33:43+00:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-23T22:48:06+00:00"
---

# Library References — phase-03-videos

Distilled from Context7 for the surfaces this phase uses (TD-01, TD-02, TD-07, TD-08, TD-09). Versions are the ones pinned for installation.

### bullmq

- **Producer:** `queue.add(name, data, opts)`. Retries come from `opts.attempts` plus `opts.backoff: { type: 'exponential', delay: <ms> }`; a rejected `process()` is retried until `attempts` runs out.
- **Idempotent enqueue:** `opts.jobId` dedupes. A second `add` with an existing `jobId` is ignored. Caveat: if `removeOnComplete` / `removeOnFail` removed the job, the same id can be added again. Use `jobId = videoId` so a repeated `/upload/complete` cannot queue the same video twice.
- **Connections:** workers need ioredis with `maxRetriesPerRequest: null`. BullMQ throws if a worker gets a manually created client without it. Passing a plain `{ host, port }` options object lets BullMQ create the clients itself.
- **Terminal failure:** on the worker `failed` event, compare `job.attemptsMade` with `job.opts.attempts` to tell the last attempt apart from intermediate ones. `UnrecoverableError` (exported by bullmq) skips the remaining attempts, for example when ffprobe says the file is not a video.
- **Shutdown/tests:** call `queue.close()` / `worker.close()` (Nest does this on `app.close()`) so Jest exits cleanly. `queue.obliterate({ force: true })` empties a test queue.

### ioredis

- Required as a **direct** dependency: bullmq 6 lists `ioredis >=5` as an *optional* peer. Without it the first `Queue`/`Worker` throws "BullMQ could not load the optional 'ioredis' package". Passing plain `{ host, port }` connection options lets BullMQ build the clients (with `maxRetriesPerRequest: null` for workers).

### @nestjs/bullmq

- Version note: 12.0.0 ships ESM-only (`"type": "module"`), which the CommonJS build and ts-jest cannot load; 11.0.5 (CommonJS) supports Nest 11 and bullmq ^6 and is the pinned version.

- **Root:** `BullModule.forRootAsync({ imports: [ConfigModule], inject: [redisConfig.KEY], useFactory: (cfg) => ({ connection: { host, port } }) })`. This is a global module, so the shared connection is defined once.
- **Queue:** `BullModule.registerQueue({ name: 'video-processing', defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true } })`. Producers use `@InjectQueue('video-processing') queue: Queue` (token `BullQueue_video-processing`, obtainable with `getQueueToken(name)` for test overrides).
- **Consumer:** a `@Processor('video-processing')` class extends `WorkerHost` and implements `async process(job)`. The resolved value becomes the job's return value, and a rejection counts as a failed attempt. `@OnWorkerEvent('failed')` registers listeners. `this.worker` is only available from `onApplicationBootstrap` onwards.
- **Process split (TD-04):** register the `@Processor` provider only in the worker's module (loaded by `src/worker.ts` via `NestFactory.createApplicationContext`). The API module registers only the queue, so the API process never consumes jobs.

### @aws-sdk/client-s3

- **Client:** `new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true })`. MinIO needs path-style. TD-08 uses two clients: one on `S3_ENDPOINT` (internal, server calls) and one on `S3_PUBLIC_ENDPOINT` used only for presigning.
- **Multipart:** `CreateMultipartUploadCommand({ Bucket, Key, ContentType })` returns `UploadId`. `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })` is presigned, not sent. `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ PartNumber, ETag }] } })` takes parts in ascending order. `AbortMultipartUploadCommand({ Bucket, Key, UploadId })` deletes the stored parts.
- **Resume (AMB-2):** `ListPartsCommand({ Bucket, Key, UploadId, PartNumberMarker? })` returns `Parts[]` (`PartNumber`, `ETag`, `Size`) and is paginated through `IsTruncated` / `NextPartNumberMarker`, max 1000 per page.
- **Reads:** `GetObjectCommand({ Bucket, Key, Range?, ResponseContentDisposition?, ResponseContentType? })`. The `Response*` overrides are what make the presigned download send `attachment; filename=...`. `HeadObjectCommand` returns `ContentLength` and `ContentType`. Consume or destroy the `Body` stream to free the socket.
- **Writes/buckets:** `PutObjectCommand({ Bucket, Key, Body, ContentType: 'image/jpeg' })` stores the thumbnail. For idempotent bucket bootstrap, call `HeadBucketCommand` and run `CreateBucketCommand` when it reports NotFound / 404.
- **Limits (S3 spec):** part sizes are 5MiB–5GiB, except the last part, which can be smaller. A multipart upload has at most 10,000 parts. A single PUT is at most 5GB.

### @aws-sdk/s3-request-presigner

- `getSignedUrl(client, command, { expiresIn: seconds })` returns `Promise<string>`. Signing is local, with no network call, so it is cheap to call once per part.
- The host signed into the URL is the client's endpoint, which is why the public-endpoint client exists (TD-08). A URL signed for `minio:9000` is not reachable from the browser, and rewriting the host breaks the signature.
- Use `S3_UPLOAD_URL_TTL` (default 3600s) for `UploadPart` URLs and `S3_DELIVERY_URL_TTL` (default 21600s) for `GetObject` stream/download/thumbnail redirects (TD-07 revision).
