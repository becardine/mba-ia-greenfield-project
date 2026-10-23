# phase-03-videos — Progress

**Status:** completed
**SIs:** 13/13 completed

### SI-03.1 — Infra: dependências, namespaces de configuração e serviços MinIO/Redis
- **Status:** completed
- **Tests:** 9/9 passing (env.validation.integration-spec.ts)
- **Observations:**
  - `minio/minio` can no longer be pulled from Docker Hub or quay.io (MinIO stopped publishing community images); compose pins `minio/minio:RELEASE.2024-12-18T13-15-44Z`, which is in the local Docker cache. A fresh machine without that cached tag cannot pull it — separate task: pick a maintained S3-compatible image (or build MinIO from source) for onboarding.
  - Redis pinned to `redis:7-alpine` (cached locally).
  - The `video-worker` service was added to `compose.yaml` together with the infra services; its `start:worker` script landed in SI-03.10.
  - `.env.example` `MAIL_FROM` was fixed to `"StreamTube <noreply@streamtube.com>"` (the old value broke Compose/dotenv parsing), as planned in the SI.

### SI-03.2 — Entidade Video e migration CreateVideos
- **Status:** completed
- **Tests:** 8/8 passing (video.entity.integration-spec.ts, migrations.integration-spec.ts)
- **Observations:**
  - `cleanAllTables` deletes `videos` only when the table exists (`to_regclass`), because suites that `synchronize` only auth/user entities never create it.
  - `created_at`/`updated_at` use `timestamptz` per the Data Model (older tables use `timestamp`); no change to existing tables.

### SI-03.3 — StorageService (S3/MinIO): buckets, multipart e URLs pré-assinadas
- **Status:** completed
- **Tests:** 8/8 passing (storage.service.integration-spec.ts, storage.module.spec.ts)
- **Observations:**
  - Both S3 clients set `requestChecksumCalculation`/`responseChecksumValidation: 'WHEN_REQUIRED'`: the SDK default (flexible checksums) bakes a checksum of an empty body into presigned `UploadPart` URLs, which breaks direct client uploads.
  - A URL presigned for `GET` cannot be probed with `HEAD` (the signature covers the method); tests probe with a 1-byte ranged GET.

### SI-03.4 — Lookup de canal por usuário e gerador de short id
- **Status:** completed
- **Tests:** 12/12 passing (channels.service.integration-spec.ts, short-id.util.spec.ts)
- **Observations:** none

### SI-03.5 — Endpoint POST /videos (pré-cadastro e início do upload)
- **Status:** completed
- **Tests:** unit + integration passing (videos.service.spec.ts, videos.service.integration-spec.ts, videos.module.spec.ts); 5/5 E2E per spec (videos-create.e2e-spec.ts)
- **Observations:**
  - `isPgUniqueViolationOnColumn` moved from `channels.service.ts` to `src/common/database/pg-errors.ts` so videos (short id retry) and channels (nickname retry) share it instead of duplicating it.
  - The global `ThrottlerGuard` (registered as `APP_GUARD` in `AuthModule`, 10 req/min) applies to every route, including `/videos/*` — pre-existing behavior from Fase 02, out of scope here. E2E helpers clear the throttler storage; a separate task should decide whether video routes need a different limit (the TD of phase-02-auth meant it for auth endpoints only).

### SI-03.6 — Endpoints de retomada: GET /videos/{id}/upload e POST /videos/{id}/upload/parts
- **Status:** completed
- **Tests:** unit + integration passing (videos.service.spec.ts, videos.service.integration-spec.ts); 5/5 E2E per spec (videos-upload-resume.e2e-spec.ts)
- **Observations:** none

### SI-03.7 — Fila video-processing (BullMQ) e produtor
- **Status:** completed
- **Tests:** 3/3 passing (video-processing.queue.integration-spec.ts, videos.module.spec.ts)
- **Observations:**
  - `@nestjs/bullmq@12.0.0` is published ESM-only and cannot be loaded by the CommonJS build/ts-jest; pinned `@nestjs/bullmq@11.0.5` (supports Nest 11 + bullmq ^6). Recorded as a TD-01 revision and in library-refs.md.
  - bullmq 6 declares `ioredis` as an optional peer; `ioredis@5.11.1` added as a direct dependency.

### SI-03.8 — Endpoints POST /videos/{id}/upload/complete e DELETE /videos/{id}/upload
- **Status:** completed
- **Tests:** unit + integration passing (videos.service.spec.ts, videos.service.integration-spec.ts); 6/6 E2E per spec (videos-upload-complete.e2e-spec.ts)
- **Observations:**
  - The E2E spec asserts the failed state through `GET /videos/{id}`, so SI-03.11 was implemented right before running this SI's E2E file (SI-03.11 depends only on SI-03.5).

### SI-03.9 — MediaProbeService: metadados via ffprobe e thumbnail via ffmpeg
- **Status:** completed
- **Tests:** 9/9 passing (media-probe.service.integration-spec.ts, media-probe.service.spec.ts)
- **Observations:** none

### SI-03.10 — Video Worker: VideoProcessor, WorkerModule, entrypoint e serviço no Compose
- **Status:** completed
- **Tests:** 7/7 passing (video.processor.integration-spec.ts, worker.module.spec.ts)
- **Observations:**
  - The worker DataSource needs the whole `Video → Channel → User` relation graph; `WorkerModule` imports `UsersModule` (which brings `ChannelsModule`) so each entity is registered by its owning module.
  - Config and TypeORM wiring were extracted into `AppConfigModule` and `DatabaseModule`, shared by `AppModule` and `WorkerModule`, instead of duplicating them.
  - Added `QUEUE_PREFIX` (default `bull`) and a Jest setup file (`src/test/test-env.setup.ts`) that sets `QUEUE_PREFIX=streamtube-test` and `S3_PUBLIC_ENDPOINT=$S3_ENDPOINT` for every test run — otherwise a running `video-worker` container would consume the jobs tests assert on.
  - `docker compose up -d video-worker` verified: the container boots and logs "Video worker started".

### SI-03.11 — Endpoint GET /videos/{id} (status e metadados do dono)
- **Status:** completed
- **Tests:** 3/3 unit (video.response.spec.ts) + service unit cases; 4/4 E2E per spec (videos-get.e2e-spec.ts)
- **Observations:** none

### SI-03.12 — Endpoints públicos de entrega: stream, download e thumbnail
- **Status:** completed
- **Tests:** service unit cases passing (videos.service.spec.ts); 5/5 E2E per spec (videos-delivery.e2e-spec.ts — real upload of an FFmpeg-generated fixture, in-process `WorkerModule` consuming from Redis, 206 range response, attachment download, JPEG thumbnail)
- **Observations:**
  - The download disposition adds an RFC 5987 `filename*` when the original name is not plain ASCII (quotes/backslashes are neutralized in the ASCII `filename`).

### SI-03.13 — Sincronização do contrato OpenAPI e da documentação
- **Status:** completed
- **Tests:** no tests (documentation sync; `openapi-export.integration-spec.ts` keeps guarding the export)
- **Observations:**
  - `openapi.json` regenerated: all 9 video operations are present. Request DTO schemas (`CreateVideoDto`, … and the pre-existing `RegisterDto`, …) are exported with empty `properties` because `openapi:export` runs through ts-node without the `@nestjs/swagger` CLI plugin — pre-existing limitation, separate task (run the export from the plugin-compiled build or generate the plugin metadata file).
  - Root `CLAUDE.md`, `README.md`, `docs/diagrams/software-arch.mermaid` (queue no longer "TBD") and `nestjs-project/CLAUDE.md` updated.
  - Final verification: full suite 36 suites / 242 tests, e2e 8 suites / 77 tests, `tsc --noEmit` 0, `npm run lint` 0 errors (6 pre-existing warnings). The first full e2e run failed `auth.e2e-spec.ts` on Jest's 5s hook timeout — `AppModule` boot now also bootstraps buckets and Redis — fixed with `testTimeout: 30000` in `test/jest-e2e.json`.
