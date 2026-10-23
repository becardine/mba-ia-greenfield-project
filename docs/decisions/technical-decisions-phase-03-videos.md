---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-23
scope_description: "Video upload (up to 10GB) and background processing: queue technology, direct-to-storage upload protocol, upload completion trigger, worker runtime, metadata/thumbnail extraction, unique URL id, streaming/download delivery, object-storage layout, status lifecycle and failure handling, and the test/runtime image strategy for the new infra."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that receives every TD below: new `videos` module (upload handshake, status, streaming/download endpoints), the video worker, the migration for the `videos` table, and the new Compose services (object storage, queue broker, worker).
- `next-frontend/` — no open decision in this document. The phase delivers backend capabilities only; the upload UI and the player belong to later phases (Fase 04/05 screens). The upload handshake (TD-02/TD-03) is a contract any client follows, recorded here as Backend scope because no frontend code is produced in this phase.

_Already fixed by the project (not reopened here):_ object storage is S3-compatible — MinIO in local Docker, S3 in production (`docs/diagrams/software-arch.mermaid`, `CLAUDE.md` § Architecture). Error envelope (`phase-02-auth/TD-07`), validation (`phase-02-auth/TD-06`), JWT guard (`phase-02-auth/TD-02`) and the Docker-service-name networking rule (`CLAUDE.md` § Docker Networking) are inherited.

_Installed versions checked (`nestjs-project/package.json` / `package-lock.json`):_ NestJS `@nestjs/common` 11.1.16, TypeORM ^0.3.28, PostgreSQL 17 image, Node `node:25.6.0-slim` dev image. Candidate libraries checked on npm on 2026-10-23: `bullmq` 6.4.1, `@nestjs/bullmq` 12.0.0 (peer: `@nestjs/common` ^10 || ^11 || ^12, `bullmq` ^3–^6), `pg-boss` 12.38.0, `@golevelup/nestjs-rabbitmq` 9.1.0, `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` 3.1156.0, `nanoid` 6.0.2, `fluent-ffmpeg` 2.1.3 (**marked deprecated** on npm).

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram leaves the queue as "TBD". The API must publish a processing job when an upload finishes and a separate worker must consume it, with retries for transient failures (storage hiccups, FFmpeg crashes). This is the main stack decision of the phase: it adds (or not) a new infrastructure service to Compose and fixes the job contract shape.

**Options:**

### Option A: BullMQ + Redis
- Redis-backed job queue with an official NestJS integration (`@nestjs/bullmq`: `BullModule.forRootAsync`, `registerQueue`, `@InjectQueue`, `@Processor` + `WorkerHost`). Adds a `redis` service to Compose.
- **Pros:** First-class Nest module documented in the official docs; built-in `attempts` + exponential `backoff`, job ids for idempotency, stalled-job recovery, concurrency per worker; workers run in any process that connects to the same Redis, so the worker container is trivial to wire.
- **Cons:** New stateful service (Redis) to operate; Redis persistence must be configured (AOF) or queued jobs are lost on restart; workers require `maxRetriesPerRequest: null` on ioredis connections (documented gotcha).

### Option B: pg-boss (PostgreSQL-backed queue)
- Job queue stored in PostgreSQL tables using `SKIP LOCKED`. No new service: reuses the `db` container.
- **Pros:** Zero new infrastructure; jobs can be inserted in the same transaction as the `videos` row update (transactional enqueue); retries and backoff supported.
- **Cons:** No official NestJS module (manual provider/lifecycle wiring); polling-based delivery adds latency and DB load next to the main workload; the queue would not be a visible, independently scalable component as the architecture diagram expects (`ContainerQueue`).

### Option C: RabbitMQ
- AMQP broker as a new Compose service, consumed via `@golevelup/nestjs-rabbitmq` or `@nestjs/microservices`.
- **Pros:** Mature broker, rich routing, independent scaling, management UI.
- **Cons:** Retries with backoff require dead-letter exchanges + TTL plumbing instead of a job option; heavier service; more moving parts than the phase needs (single job type, single consumer group).

**Recommendation:** **Option A (BullMQ + Redis)** — the phase has exactly one job type with retry/backoff needs, and `@nestjs/bullmq` (12.0.0, compatible with the installed Nest 11) gives retries, idempotent job ids and a separate-process worker out of the box; Redis is a small, well-known service, while pg-boss would hide the queue inside the main database and RabbitMQ needs DLX plumbing to reach the same retry semantics.

**Decision:** A (BullMQ + Redis)
**Libraries:** bullmq, @nestjs/bullmq, ioredis

**Revisions:**
- 2026-10-23 — Added the `**Libraries:**` line (bullmq 6.4.1, @nestjs/bullmq 12.0.0; ioredis is a transitive dependency of bullmq). Rationale: `/plan-resolve` caches library docs from this field and the decided option implies these packages.
- 2026-10-23 — Library versions corrected during implementation: `@nestjs/bullmq` pinned to 11.0.5 (12.0.0 is published as ESM-only and cannot be loaded by the project's CommonJS build/Jest runtime; 11.0.5 supports Nest 11 and bullmq ^6), and `ioredis` 5.11.1 added as a direct dependency (bullmq 6 declares it as an optional peer and no longer installs it transitively). Rationale: same option A, only package versions changed to match the runtime.

---

## TD-02: Upload Protocol for Files up to 10GB

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The file must never stream through the API process (it would hold a connection and an event-loop slice for the whole 10GB transfer). The client needs a resumable, parallelizable path straight to object storage. A single S3 `PUT` is capped at 5GB, so 10GB requires multipart (S3 limits: parts of 5MiB–5GiB, up to 10,000 parts, last part may be smaller). `docs/project-plan.md` § Pontos de Atenção also asks for the upload to be resumable after a connection failure.

**Options:**

### Option A: S3 multipart upload with presigned part URLs
- API starts a multipart upload (`CreateMultipartUpload`), returns presigned `UploadPart` URLs (via `@aws-sdk/s3-request-presigner`) for the declared size; the client `PUT`s each part directly to MinIO/S3 and collects the `ETag`s; the API completes it (`CompleteMultipartUpload`). The API only exchanges small JSON messages.
- **Pros:** Zero file bytes through the API; parts upload in parallel and failed parts are retried individually (resumable); identical behavior on MinIO and AWS S3; no extra service.
- **Cons:** Client must split the file and track ETags; bucket CORS must expose the `ETag` header for browser clients; incomplete uploads leave orphan parts unless aborted or expired by a lifecycle rule.

### Option B: tus protocol (tusd server in front of storage)
- A `tusd` container implements the tus resumable-upload protocol and writes to S3/MinIO; the API is notified via hooks.
- **Pros:** Standard resumable protocol with mature clients (`tus-js-client`), automatic resume.
- **Cons:** New service with its own auth integration (hooks back to the API to validate the JWT/owner); a second upload path to operate; the S3 multipart it uses internally is already available directly in Option A.

### Option C: Single presigned PUT
- API returns one presigned `PutObject` URL; client uploads the whole file in one request.
- **Pros:** Simplest client and server code.
- **Cons:** Hard 5GB limit per PUT on S3 — fails the 10GB requirement; no resume: a dropped connection restarts the whole transfer.

**Recommendation:** **Option A (multipart with presigned part URLs)** — it is the only option that meets 10GB + resume without adding a service, and it keeps the API out of the data path; the API fixes the part size (proposal: 64MiB → ≤160 parts for 10GB, well under the 10,000-part limit) and rejects declared sizes above 10GB at initiation.

**Decision:** A (S3 multipart upload with presigned part URLs)
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-10-23 — Added the `**Libraries:**` line (AWS SDK v3 3.1156.0). Rationale: `/plan-resolve` caches library docs from this field and the decided option implies these packages.
- 2026-10-23 — Initiation contract fixed (validation AMB-1): the client sends `fileName`, `fileSize` (1 byte to 10GiB = 10 737 418 240 bytes) and `contentType`, which must be one of `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`; `title` is optional (1–100 chars after trim) and defaults to the file name without its extension (truncated to 100 chars). Part size stays 64MiB. Rationale: keeps the pre-registration automatic while rejecting obviously wrong uploads before any byte is transferred; title/description editing stays in Fase 04.
- 2026-10-23 — Resume contract fixed (validation AMB-2): presigned part URLs live 1h (`S3_UPLOAD_URL_TTL`, seconds, default 3600); the owner of a `draft` video can call `GET /videos/{id}/upload` to get `partSize`, `partCount` and the parts already stored (S3 `ListParts`: partNumber, etag, size), and `POST /videos/{id}/upload/parts` with `{ partNumbers }` to get fresh URLs for those parts. Rationale: a 10GB transfer can outlive the URLs and a client that lost its state must be able to resume without restarting the multipart upload.

---

## TD-03: Upload Completion Trigger (who starts processing)

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** With direct-to-storage upload (TD-02) the API does not see the bytes arrive, so something must detect "upload finished" and enqueue the processing job (TD-01). Depends on TD-01 and TD-02.

**Options:**

### Option A: Client calls a "complete" endpoint
- After the last part, the client sends the ETag list to `POST /videos/{id}/upload/complete`; the API calls `CompleteMultipartUpload`, moves the video to `processing` and enqueues the job.
- **Pros:** Explicit, synchronous signal with the owner's JWT; the API verifies the object really exists before enqueuing; identical on MinIO and S3; easy to test end to end.
- **Cons:** If the client never calls it, the video stays a draft (needs the cleanup policy of TD-09).

### Option B: Storage event notifications
- Configure MinIO/S3 bucket notifications (`s3:ObjectCreated:CompleteMultipartUpload`) to publish to the queue (MinIO supports Redis/AMQP targets; S3 uses SNS/SQS/EventBridge).
- **Pros:** Processing starts even if the client crashes after the last part.
- **Cons:** The client still has to complete the multipart upload (ETags), so it calls the storage anyway; notification wiring differs between MinIO and S3 (local/prod drift); the event carries no video id/owner, so the worker must map keys back to rows.

**Recommendation:** **Option A (complete endpoint)** — the client must send `CompleteMultipartUpload` with the ETags regardless, so routing that call through the API adds no extra round-trip while giving an authenticated, testable trigger that behaves the same on MinIO and S3.

**Decision:** A (Client calls the complete endpoint)

**Revisions:**
- 2026-10-23 — Stored-size check fixed (validation AMB-4): before `CompleteMultipartUpload`, the complete endpoint calls `ListParts` and sums the stored part sizes; if the sum differs from the declared `fileSize` or exceeds 10GiB (10 737 418 240 bytes), the API aborts the multipart upload, marks the video `failed` with `processing_error = 'UPLOAD_SIZE_MISMATCH'` and returns `400 UPLOAD_SIZE_MISMATCH`. Rationale: presigned part URLs do not bound each part's size, so the declared size alone cannot enforce the 10GB limit; checking before assembly means no oversized object is ever created.

---

## TD-04: Video Worker Runtime

**Scope:** Repo-wide

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture defines a separate "Video Worker (FFmpeg)" container that consumes the queue and updates DB and storage. The worker needs the `Video` entity, the storage client and the queue consumer — the same building blocks the API uses.

**Options:**

### Option A: Same NestJS codebase, separate entrypoint and container
- A `src/worker.ts` bootstraps a Nest application context (no HTTP server) with a worker module that registers the BullMQ processor; Compose runs it as a separate `video-worker` service from the same image.
- **Pros:** Reuses entities, config validation, TypeORM setup and the storage service without duplication; one dependency manifest; the worker scales and restarts independently of the API.
- **Cons:** Worker and API share a deploy artifact (a change in one rebuilds both); care needed so the API process does not also register the processor.

### Option B: Separate standalone Node project for the worker
- A new subproject (e.g., `video-worker/`) with its own `package.json`, using BullMQ and the S3 SDK directly.
- **Pros:** Smallest possible worker image; fully independent lifecycle.
- **Cons:** Duplicates entity/schema knowledge and config; a new subproject with its own lint/test/tsc pipeline; contract drift between API and worker.

### Option C: Processor inside the API process
- Register the BullMQ processor in the API's `AppModule`.
- **Pros:** No new container.
- **Cons:** FFmpeg CPU load competes with HTTP traffic — violates the phase goal ("sem impacto na performance") and the architecture's separate worker container.

**Recommendation:** **Option A** — the worker is a second runtime of the same backend (same entities, config and storage service), so a separate entrypoint/container gives the isolation the architecture asks for without duplicating the domain model in a new subproject.

**Decision:** A (Same NestJS codebase, separate entrypoint and container)

---

## TD-05: Metadata Extraction and Thumbnail Generation

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The worker must read duration/metadata and capture one frame as thumbnail. The source can be 10GB, so copying it to local disk first doubles I/O and disk usage. Depends on TD-04.

**Options:**

### Option A: System `ffprobe`/`ffmpeg` via `child_process.spawn`, reading the object over a presigned HTTP URL
- Worker image installs Debian's `ffmpeg` package; the worker spawns `ffprobe -print_format json -show_format -show_streams <url>` and `ffmpeg -ss <t> -i <url> -frames:v 1 ...` against a presigned GET URL. FFmpeg uses HTTP range requests, so only the needed bytes are read.
- **Pros:** No file copy for 10GB sources; no wrapper library to maintain; JSON output of `ffprobe` maps directly to the metadata columns; works the same against MinIO and S3.
- **Cons:** Manual argument building and process/exit-code handling; FFmpeg must be present in the image used to run the worker and its integration tests.

### Option B: `fluent-ffmpeg` wrapper
- Chainable API over the same binaries.
- **Pros:** Higher-level API, many examples.
- **Cons:** Package is **marked deprecated** on npm (2.1.3) — adopting an unmaintained dependency in a greenfield phase.

### Option C: Bundled binaries (`ffmpeg-static` / `ffprobe-static`) + download to temp file
- npm packages ship FFmpeg binaries; worker downloads the source to a temp file and processes it locally.
- **Pros:** No OS package needed.
- **Cons:** Large binaries inside `node_modules` (bind-mounted dev volume); temp copy of up to 10GB per job.

**Recommendation:** **Option A** — spawning the OS binaries over a presigned URL avoids both the deprecated wrapper and the 10GB temp copy; the thumbnail frame is taken at a fixed fraction of the duration (proposal: 10%, clamped to the first second for very short clips) and stored as JPEG.

**Decision:** A (System ffprobe/ffmpeg via spawn over a presigned URL)

**Revisions:**
- 2026-10-23 — Stored metadata fixed (validation AMB-3): the worker persists `duration_seconds`, `width`, `height`, `video_codec`, `audio_codec`, `bitrate` and `format_name` as nullable typed columns on the video; a file in which ffprobe finds no video stream (or that ffprobe cannot parse) fails immediately without retries (BullMQ `UnrecoverableError`) and ends `failed` with the reason in `processing_error`. Rationale: typed columns are what Fase 04 listings/details read, and retrying a non-video file can never succeed.

---

## TD-06: Unique Video URL Identifier

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a short public identifier for its URL that never collides and does not leak sequence information. `docs/project-plan.md` § Pontos de Atenção asks for "uma URL curta e única". The primary key stays a UUID (project convention for entities).

**Options:**

### Option A: Random base62 short id generated with `node:crypto` + unique index
- 11-character base62 id (≈65 bits of entropy) from `crypto.randomBytes`, stored in a `UNIQUE` column; on the (astronomically rare) unique violation the insert is retried with a new id.
- **Pros:** No dependency; short URL; uniqueness guaranteed by the database constraint, not by probability alone.
- **Cons:** Small custom generator to write and test; retry-on-conflict path.

### Option B: Use the UUID primary key in the URL
- `/videos/{uuid}`.
- **Pros:** Nothing new to generate.
- **Cons:** 36-character URL — not "curta"; exposes the internal primary key.

### Option C: `nanoid` library
- `nanoid(11)` with the URL-safe alphabet.
- **Pros:** Well-known, tested generator.
- **Cons:** New dependency for ~10 lines of code; v5+ is ESM-only while the project compiles to CommonJS (`module: nodenext` without `"type": "module"`), adding interop friction.

**Recommendation:** **Option A** — a base62 id from `node:crypto` plus a `UNIQUE` index gives a short, collision-proof id without adding an ESM-only dependency to a CommonJS build.

**Decision:** A (Random base62 short id via node:crypto + unique index)

---

## TD-07: Streaming and Download Delivery

**Scope:** Backend

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Playback must start without downloading the whole file, which means HTTP range requests answered with `206 Partial Content`. The architecture diagram already routes playback bytes from Object Storage to the client (`Rel(frontend, storage, "Streams")`). Depends on TD-08.

**Options:**

### Option A: API redirects to a short-lived presigned GET URL
- `GET /videos/{shortId}/stream` and `/download` return `302` to a presigned `GetObject` URL (download adds `ResponseContentDisposition: attachment`). MinIO/S3 answer `Range` requests with `206` natively.
- **Pros:** Bytes never pass through the API; range/seek handled by the storage; matches the diagram; download and stream share one mechanism.
- **Cons:** Presigned URLs must be signed with a host reachable by the client (see TD-08); URL expiry must cover a viewing session.

### Option B: API proxies the object with Range support
- The API parses `Range`, calls `GetObject` with the same range and pipes the body back with `206` + `Content-Range`.
- **Pros:** Storage stays fully private; one public origin.
- **Cons:** Every streamed byte crosses the API — the bottleneck the phase must avoid; Range parsing/edge cases implemented by hand.

### Option C: Adaptive streaming (HLS/DASH transcoding)
- Worker transcodes into segmented renditions; client plays a manifest.
- **Pros:** Adaptive bitrate.
- **Cons:** Multiplies processing time and storage; not required by the phase (progressive playback with range requests satisfies "sem necessidade de download completo").

**Recommendation:** **Option A** — redirecting to presigned URLs keeps the API out of the byte path and lets the storage serve `206 Partial Content`, which is exactly the streaming requirement; HLS is a later optimization, not a phase requirement.

**Decision:** A (Redirect to a short-lived presigned GET URL)

**Revisions:**
- 2026-10-23 — Delivery URL lifetime and download semantics fixed (validation AMB-5): stream, download and thumbnail redirects share `S3_DELIVERY_URL_TTL` (seconds, default 21600 = 6h) so a long playback does not hit an expired URL mid-stream; on expiry the client calls the API endpoint again for a fresh redirect. Download signs `ResponseContentDisposition: attachment; filename="<original fileName>"`; stream and thumbnail are served inline. Rationale: players reuse the same URL for every range request, so a minutes-long TTL breaks playback of long videos.

---

## TD-08: Object Storage Layout and Public Endpoint for Presigned URLs

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Storage is S3-compatible (fixed). What is open is how to organize buckets/keys and how presigned URLs become reachable: inside Compose the storage is `minio:9000` (service-name rule), but a URL signed for `minio:9000` cannot be resolved by a browser or by `curl` on the host. The endpoint values are cross-component (Joi env schema + `compose.yaml` + `.env.example` + storage client). Depends on TD-02 and TD-07.

**Options:**

### Option A: Two private buckets + separate public endpoint used only for signing
- Buckets `videos` (source files, key `{videoId}/source`) and `thumbnails` (key `{videoId}.jpg`), both private. The storage client uses `S3_ENDPOINT=http://minio:9000` for server-side calls; a second client configured with `S3_PUBLIC_ENDPOINT` (e.g., `http://localhost:9000` in dev, the public S3/CDN host in prod) is used **only** to sign URLs handed to clients. Buckets are created idempotently on startup (and by a Compose init step).
- **Pros:** Service-to-service traffic keeps using the Compose service name; client-facing URLs are resolvable; separate buckets allow different lifecycle/policies per asset type later (e.g., public thumbnails in Fase 04/05).
- **Cons:** Two endpoint variables to keep consistent; signing host must match the host the client calls (SigV4 signs the host).

### Option B: Single bucket with prefixes, single endpoint
- One bucket `streamtube` with `videos/` and `thumbnails/` prefixes; one endpoint for everything.
- **Pros:** Fewer buckets/variables.
- **Cons:** With a single endpoint the presigned URLs either use `minio` (unresolvable by clients) or `localhost` (violates the service-name rule inside containers); per-asset policies must be expressed by prefix rules.

**Recommendation:** **Option A** — it is the only layout that satisfies both the Docker networking rule (server calls via `minio`) and client reachability (signed URLs via the public endpoint), and keeps thumbnails and sources independently governable.

**Decision:** A (Two private buckets + separate public signing endpoint)

---

## TD-09: Video Status Lifecycle and Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The video row is created as a draft when the upload starts, moves to processing when the upload completes and ends as ready or failed. Transient processing errors must be retried; permanent ones must be visible. Depends on TD-01 and TD-03.

**Options:**

### Option A: `draft → processing → ready | failed`, retries by the queue, terminal `failed` with reason
- Status is a Postgres enum. The job is enqueued with `attempts: 3` and exponential backoff; the worker sets `ready` with metadata + thumbnail key on success; when the last attempt fails, it sets `failed` and stores a short `processingError`. Only the owner may abort a `draft` upload (`AbortMultipartUpload` + row removal).
- **Pros:** Small, explicit state machine that maps 1:1 to the phase bullets; retries absorb transient errors; failures are observable in the DB.
- **Cons:** Abandoned drafts (client never completes) remain until aborted; an automatic cleanup is not part of this option.

### Option B: Option A plus automatic expiry of stale drafts
- Same lifecycle plus a scheduled job that aborts multipart uploads and deletes drafts older than N hours (or a bucket lifecycle rule `AbortIncompleteMultipartUpload`).
- **Pros:** No orphaned parts/rows accumulating.
- **Cons:** Adds a scheduler concern not listed in the phase capabilities; Fase 04 already owns the draft/publish workflow and is the natural place to define draft retention.

**Recommendation:** **Option A** — it covers every phase capability with the smallest state machine; stale-draft cleanup is a retention policy better decided with Fase 04's draft/publish flow (recorded as a known gap, mitigated by the explicit abort endpoint).

**Decision:** A (draft → processing → ready | failed, queue retries, terminal failed with reason)

**Revisions:**
- 2026-10-23 — Draft ownership lookup fixed (validation DG-1): the draft is attached to the authenticated user's channel resolved through a new `ChannelsService.findByUserId` in the channels module (planned in this phase); `VideosModule` imports `ChannelsModule` and never queries the channels table directly. Rationale: Single Responsibility — the channels module owns channel reads.
- 2026-10-23 — Full transition set fixed (validation IC-1): `draft → processing` (complete endpoint), `draft → failed` (`UPLOAD_SIZE_MISMATCH` after aborting the multipart upload, per TD-03 revision), `processing → ready` (worker success), `processing → failed` (unrecoverable error or retries exhausted); `ready` and `failed` are terminal in this phase. Abort (`DELETE /videos/{id}/upload`, owner, `draft` only) calls `AbortMultipartUpload` and deletes the draft row. Rationale: the TD-03 size check introduced a failure before processing, and the abort outcome must be explicit for the API contract.

---

## TD-10: Runtime Image and Test Strategy for the New Infrastructure

**Scope:** Repo-wide

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** Tests run inside the `nestjs-api` container (`nestjs-project/CLAUDE.md` § Commands). Integration tests of the storage, queue and FFmpeg steps must hit real services, so the test container needs MinIO, Redis and the FFmpeg binaries available. Depends on TD-01, TD-04, TD-05.

**Options:**

### Option A: One dev image with FFmpeg for API and worker; real MinIO/Redis in Compose; generated fixtures
- `Dockerfile.dev` installs `ffmpeg`; `nestjs-api` and `video-worker` use the same image. Integration/e2e tests use the Compose `minio` and `redis` services with dedicated test buckets/queue prefixes, and generate a tiny MP4 fixture at test time with `ffmpeg -f lavfi -i testsrc` (no binary fixture committed).
- **Pros:** Every test runs from the documented `docker compose exec nestjs-api` entrypoint; no mocks for storage/queue/FFmpeg; worker tests can run without entering the worker container.
- **Cons:** The API image is larger than strictly needed (carries FFmpeg).

### Option B: Separate worker image; worker tests run in the worker container
- Only the worker image installs FFmpeg; FFmpeg-dependent tests run via `docker compose exec video-worker`.
- **Pros:** Smaller API image.
- **Cons:** Two test entrypoints, breaking the single-command Definition of Done workflow; more Compose/CI wiring.

**Recommendation:** **Option A** — a single dev image keeps the Definition of Done runnable from the one documented container and lets FFmpeg, storage and queue be exercised for real; the extra image size is a dev-only cost.

**Decision:** A (One FFmpeg dev image for API and worker; real MinIO/Redis; generated fixtures)

---

## TD-11: Access Policy for Streaming, Download and Thumbnail

**Scope:** Backend

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Added after `/plan-validate` (MD-1): TD-07 fixes *how* bytes are delivered, but no TD fixes *who* may obtain the presigned URLs. Anonymous viewing is a Fase 05 capability ("Acesso anônimo à visualização de vídeos") and public/unlisted visibility is a Fase 04 capability ("Visibilidade do vídeo: público (aparece para todos) ou unlisted (somente via link)"), so Fase 03 must pick a rule that does not pre-empt them. The global JWT guard (`phase-02-auth/TD-02`) makes every route authenticated unless marked public. Depends on TD-06 and TD-07.

**Options:**

### Option A: Public by short id once `ready`; owner-only before that
- `GET /videos/{shortId}/stream`, `/download` and `/thumbnail` are `@Public()` and resolve only when the video is `ready`; `draft`/`processing`/`failed` return 404 to anyone, while the owner can always read status/metadata via an authenticated endpoint.
- **Pros:** Matches the platform premise ("Usuários anônimos podem assistir livremente") and the "URL única" capability (the short id *is* the link); Fase 04 unlisted semantics ("somente via link") are already satisfied by link-only access, and Fase 04 only needs to add the publish/visibility filter for listings.
- **Cons:** Until Fase 04 adds the draft→published gate, every processed video is reachable by whoever has its link (no listing exposes it in this phase).

### Option B: Owner-only until Fase 04 introduces visibility
- All three endpoints require the JWT and the requester must own the video's channel.
- **Pros:** Nothing is viewable by third parties before publication rules exist.
- **Cons:** Contradicts anonymous viewing as the platform default; Fase 04/05 must reopen and change every guard and contract; the streaming deliverable can only be demonstrated by the owner.

**Recommendation:** **Option A** — link-based public access for `ready` videos is the platform's stated default and is exactly the "unlisted via link" behavior Fase 04 formalizes, so no contract changes later; non-ready videos stay hidden (404) and status/metadata remain owner-only.

**Decision:** A (Public by short id once ready; 404 for everyone before)

**Revisions:**
- 2026-10-23 — Non-ready behavior clarified (validation AMB-6): stream, download and thumbnail return `404 VIDEO_NOT_FOUND` to everyone — owner included — until the video is `ready`; the owner follows progress only through the authenticated `GET /videos/{id}`. The decision label is reworded from "owner-only before" to "404 for everyone before". Rationale: `@Public()` routes skip the JWT guard entirely, so owner preview would require a new optional-auth guard for no phase capability.

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message Queue Technology | A — BullMQ + Redis | A |
| TD-02 | Backend | Upload Protocol for Files up to 10GB | A — S3 multipart with presigned part URLs | A |
| TD-03 | Backend | Upload Completion Trigger | A — Client calls the complete endpoint | A |
| TD-04 | Repo-wide | Video Worker Runtime | A — Same codebase, separate entrypoint/container | A |
| TD-05 | Backend | Metadata Extraction and Thumbnail Generation | A — System ffprobe/ffmpeg over presigned URL | A |
| TD-06 | Backend | Unique Video URL Identifier | A — base62 id via `node:crypto` + unique index | A |
| TD-07 | Backend | Streaming and Download Delivery | A — Redirect to presigned GET (206 by storage) | A |
| TD-08 | Repo-wide | Object Storage Layout and Public Endpoint | A — Two private buckets + public signing endpoint | A |
| TD-09 | Backend | Video Status Lifecycle and Failure Handling | A — draft→processing→ready/failed with retries | A |
| TD-10 | Repo-wide | Runtime Image and Test Strategy | A — One FFmpeg image, real MinIO/Redis, generated fixtures | A |
| TD-11 | Backend | Access Policy for Streaming, Download and Thumbnail | A — Public by short id once ready; 404 for everyone before | A |
