# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **MinIO:** `docker compose exec minio mc ready local` — expect `The cluster is ready`
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG`

`docker compose up -d` also starts `video-worker` (a queue consumer, not an HTTP server). It runs `npm run start:worker` from the mounted source, so after a fresh `npm install` restart it: `docker compose restart video-worker`.

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000` (image `Dockerfile.dev`, includes FFmpeg)
- `video-worker` — same image and source, runs `npm run start:worker` (BullMQ consumer, no port)
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `mailpit` — SMTP capture, ports `1025` (SMTP) / `8025` (UI)
- `minio` — S3-compatible object storage, ports `9000` (API) / `9001` (console), user `streamtube` / `streamtube-secret`; buckets `videos` and `thumbnails` are created on boot by `StorageService`
- `redis` — BullMQ backend, port `6379`

The MinIO image is pinned to `minio/minio:RELEASE.2024-12-18T13-15-44Z`: MinIO no longer publishes community images to Docker Hub/quay, so that tag only resolves where it is already cached.

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/ (API and worker entrypoints)
npm run start:prod                       # Run compiled build
npm run start:worker                     # Video worker via ts-node (what the video-worker service runs)
npm run start:worker:prod                # Compiled video worker (dist/worker)

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

Video tests use the real `minio`, `redis` and FFmpeg (fixtures are generated at test time by `src/test/video-fixture.ts` — no binary fixtures in the repo), so those services must be up. `src/test/test-env.setup.ts` (a Jest `setupFiles` entry) isolates them from the dev stack:

- `QUEUE_PREFIX=streamtube-test` — a running `video-worker` (prefix `bull`) never consumes the jobs tests assert on; the delivery e2e starts its own in-process `WorkerModule`.
- `S3_PUBLIC_ENDPOINT=$S3_ENDPOINT` — `localhost:9000` is unreachable from inside the container, so presigned client URLs are signed for `minio:9000` during tests.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config", ".../src/test/test-env.setup.ts"]` — without `dotenv/config`, `.env` is not loaded inside the Jest process (`DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS). The second file applies the test-only overrides described under "Test execution"; it must run after `dotenv/config`.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

### Two runtimes, one codebase

- **HTTP API** — `src/main.ts` → `AppModule`.
- **Video worker** — `src/worker.ts` → `WorkerModule` (`NestFactory.createApplicationContext`, no HTTP). Only the worker registers the `@Processor` (`src/worker/video.processor.ts`); the API only produces jobs.
- Both share `AppConfigModule` (global, Joi-validated config), `DatabaseModule` (TypeORM connection) and `QueueModule` (BullMQ Redis connection + `QUEUE_PREFIX`).

### Videos (Fase 03)

- `src/videos/` — `Video` entity (`videos` table, status `draft → processing → ready | failed`), `VideosService`, `VideosController`, producer `VideoProcessingQueue` (queue `video-processing`, job `process-video`, `jobId = videoId`, 3 attempts with exponential backoff).
- `src/storage/` — `StorageService`: the only code that talks to S3/MinIO. Two clients: internal (`S3_ENDPOINT`) for server calls, public (`S3_PUBLIC_ENDPOINT`) only to sign URLs handed to clients. Flexible checksums are set to `WHEN_REQUIRED` so presigned `UploadPart` URLs stay usable by browsers.
- `src/media/` — `MediaProbeService`: spawns the system `ffprobe`/`ffmpeg` directly over a presigned URL (no temp copy of up to 10GB).
- Upload flow: `POST /videos` (draft + multipart + part URLs) → client PUTs parts to storage → `POST /videos/:id/upload/complete` (ListParts size check, then complete + enqueue). Resume: `GET /videos/:id/upload`, `POST /videos/:id/upload/parts`. Abort: `DELETE /videos/:id/upload`.
- Delivery: `GET /videos/:shortId/{stream,download,thumbnail}` are `@Public()` and answer `302` to presigned URLs (`S3_DELIVERY_URL_TTL`); storage serves `206` ranges. Non-`ready` videos are `404` for everyone; owners follow progress via `GET /videos/:id`.
- Env vars: `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_VIDEOS_BUCKET`, `S3_THUMBNAILS_BUCKET`, `S3_UPLOAD_URL_TTL`, `S3_DELIVERY_URL_TTL`, `REDIS_HOST`, `REDIS_PORT`, `QUEUE_PREFIX` (see `.env.example`).
- `@nestjs/bullmq` is pinned to 11.x: 12.x ships ESM-only and cannot be loaded by this CommonJS build/Jest setup. `ioredis` is a direct dependency because bullmq 6 treats it as an optional peer.

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
