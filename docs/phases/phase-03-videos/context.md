---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-23T20:47:14+00:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-23T22:48:06+00:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-23T20:47:14+00:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-23T20:47:14+00:00"
  docs/phases/phase-02-auth/context.md: "2026-10-23T20:47:14+00:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-23T20:47:14+00:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-23T20:47:14+00:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-23T22:48:06+00:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos
**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._
**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.
**Affected subprojects:** _None explicitly mentioned in the Fase 03 section (no `nestjs-project` / `nextjs-project` or `Subprojetos:` line)._
**Deferred subprojects:** _None._
**Sequencing notes:** "> Depende de: Fase 01, Fase 02"

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta (Depende de: Fase 01)
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal (Depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Message Queue Technology | decided | A (BullMQ + Redis) | bullmq, @nestjs/bullmq, ioredis |
|     └─ Last revision: 2026-10-23 — Library versions corrected during implementation: `@nestjs/bullmq` … | | | | | |
| phase-03-videos/TD-02 | phase | Backend | Upload Protocol for Files up to 10GB | decided | A (S3 multipart upload with presigned part URLs) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
|     └─ Last revision: 2026-10-23 — Resume contract fixed (validation AMB-2): presigned part URLs live 1h (`S3_UP… | | | | | |
| phase-03-videos/TD-03 | phase | Backend | Upload Completion Trigger (who starts processing) | decided | A (Client calls the complete endpoint) | — |
|     └─ Last revision: 2026-10-23 — Stored-size check fixed (validation AMB-4): before `CompleteMultipa… | | | | | |
| phase-03-videos/TD-04 | phase | Repo-wide | Video Worker Runtime | decided | A (Same NestJS codebase, separate entrypoint and container) | — |
| phase-03-videos/TD-05 | phase | Backend | Metadata Extraction and Thumbnail Generation | decided | A (System ffprobe/ffmpeg via spawn over a presigned URL) | — |
|     └─ Last revision: 2026-10-23 — Stored metadata fixed (validation AMB-3): the worker persists `dura… | | | | | |
| phase-03-videos/TD-06 | phase | Backend | Unique Video URL Identifier | decided | A (Random base62 short id via node:crypto + unique index) | — |
| phase-03-videos/TD-07 | phase | Backend | Streaming and Download Delivery | decided | A (Redirect to a short-lived presigned GET URL) | — |
|     └─ Last revision: 2026-10-23 — Delivery URL lifetime and download semantics fixed (validation AMB-… | | | | | |
| phase-03-videos/TD-08 | phase | Repo-wide | Object Storage Layout and Public Endpoint for Presigned URLs | decided | A (Two private buckets + separate public signing endpoint) | — |
| phase-03-videos/TD-09 | phase | Backend | Video Status Lifecycle and Failure Handling | decided | A (draft → processing → ready \| failed, queue retries, terminal failed with reason) | — |
|     └─ Last revision: 2026-10-23 — Full transition set fixed (validation IC-1): `draft → processing` (… | | | | | |
| phase-03-videos/TD-10 | phase | Repo-wide | Runtime Image and Test Strategy for the New Infrastructure | decided | A (One FFmpeg dev image for API and worker; real MinIO/Redis; generated fixtures) | — |
| phase-03-videos/TD-11 | phase | Backend | Access Policy for Streaming, Download and Thumbnail | decided | A (Public by short id once ready; 404 for everyone before) | — |
|     └─ Last revision: 2026-10-23 — Non-ready behavior clarified (validation AMB-6): stream, download a… | | | | | |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-08, phase-03-videos/TD-10 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-04, phase-03-videos/TD-10 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-09 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-05, phase-03-videos/TD-09 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-05, phase-03-videos/TD-10 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-06 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-07, phase-03-videos/TD-11 |
| Download do vídeo pelo usuário | phase-03-videos/TD-07, phase-03-videos/TD-11 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** the phase has exactly one job type with retry/backoff needs, and `@nestjs/bullmq` (12.0.0, compatible with the installed Nest 11) gives retries, idempotent job ids and a separate-process worker out of the box; Redis is a small, well-known service, while pg-boss would hide the queue inside the main database and RabbitMQ needs DLX plumbing to reach the same retry semantics.
**Libraries:** bullmq, @nestjs/bullmq, ioredis
**Revisions:**
- 2026-10-23 — Added the `**Libraries:**` line (bullmq 6.4.1, @nestjs/bullmq 12.0.0; ioredis is a transitive dependency of bullmq). Rationale: `/plan-resolve` caches library docs from this field and the decided option implies these packages.
- 2026-10-23 — Library versions corrected during implementation: `@nestjs/bullmq` pinned to 11.0.5 (12.0.0 is published as ESM-only and cannot be loaded by the project's CommonJS build/Jest runtime; 11.0.5 supports Nest 11 and bullmq ^6), and `ioredis` 5.11.1 added as a direct dependency (bullmq 6 declares it as an optional peer and no longer installs it transitively). Rationale: same option A, only package versions changed to match the runtime.

### phase-03-videos/TD-02

**Recommendation:** it is the only option that meets 10GB + resume without adding a service, and it keeps the API out of the data path; the API fixes the part size (proposal: 64MiB → ≤160 parts for 10GB, well under the 10,000-part limit) and rejects declared sizes above 10GB at initiation.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
**Revisions:**
- 2026-10-23 — Added the `**Libraries:**` line (AWS SDK v3 3.1156.0). Rationale: `/plan-resolve` caches library docs from this field and the decided option implies these packages.
- 2026-10-23 — Initiation contract fixed (validation AMB-1): the client sends `fileName`, `fileSize` (1 byte to 10GiB = 10 737 418 240 bytes) and `contentType`, which must be one of `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`; `title` is optional (1–100 chars after trim) and defaults to the file name without its extension (truncated to 100 chars). Part size stays 64MiB. Rationale: keeps the pre-registration automatic while rejecting obviously wrong uploads before any byte is transferred; title/description editing stays in Fase 04.
- 2026-10-23 — Resume contract fixed (validation AMB-2): presigned part URLs live 1h (`S3_UPLOAD_URL_TTL`, seconds, default 3600); the owner of a `draft` video can call `GET /videos/{id}/upload` to get `partSize`, `partCount` and the parts already stored (S3 `ListParts`: partNumber, etag, size), and `POST /videos/{id}/upload/parts` with `{ partNumbers }` to get fresh URLs for those parts. Rationale: a 10GB transfer can outlive the URLs and a client that lost its state must be able to resume without restarting the multipart upload.

### phase-03-videos/TD-03

**Recommendation:** the client must send `CompleteMultipartUpload` with the ETags regardless, so routing that call through the API adds no extra round-trip while giving an authenticated, testable trigger that behaves the same on MinIO and S3.
**Libraries:** —
**Revisions:**
- 2026-10-23 — Stored-size check fixed (validation AMB-4): before `CompleteMultipartUpload`, the complete endpoint calls `ListParts` and sums the stored part sizes; if the sum differs from the declared `fileSize` or exceeds 10GiB (10 737 418 240 bytes), the API aborts the multipart upload, marks the video `failed` with `processing_error = 'UPLOAD_SIZE_MISMATCH'` and returns `400 UPLOAD_SIZE_MISMATCH`. Rationale: presigned part URLs do not bound each part's size, so the declared size alone cannot enforce the 10GB limit; checking before assembly means no oversized object is ever created.

### phase-03-videos/TD-04

**Recommendation:** the worker is a second runtime of the same backend (same entities, config and storage service), so a separate entrypoint/container gives the isolation the architecture asks for without duplicating the domain model in a new subproject.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** spawning the OS binaries over a presigned URL avoids both the deprecated wrapper and the 10GB temp copy; the thumbnail frame is taken at a fixed fraction of the duration (proposal: 10%, clamped to the first second for very short clips) and stored as JPEG.
**Libraries:** —
**Revisions:**
- 2026-10-23 — Stored metadata fixed (validation AMB-3): the worker persists `duration_seconds`, `width`, `height`, `video_codec`, `audio_codec`, `bitrate` and `format_name` as nullable typed columns on the video; a file in which ffprobe finds no video stream (or that ffprobe cannot parse) fails immediately without retries (BullMQ `UnrecoverableError`) and ends `failed` with the reason in `processing_error`. Rationale: typed columns are what Fase 04 listings/details read, and retrying a non-video file can never succeed.

### phase-03-videos/TD-06

**Recommendation:** a base62 id from `node:crypto` plus a `UNIQUE` index gives a short, collision-proof id without adding an ESM-only dependency to a CommonJS build.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** redirecting to presigned URLs keeps the API out of the byte path and lets the storage serve `206 Partial Content`, which is exactly the streaming requirement; HLS is a later optimization, not a phase requirement.
**Libraries:** —
**Revisions:**
- 2026-10-23 — Delivery URL lifetime and download semantics fixed (validation AMB-5): stream, download and thumbnail redirects share `S3_DELIVERY_URL_TTL` (seconds, default 21600 = 6h) so a long playback does not hit an expired URL mid-stream; on expiry the client calls the API endpoint again for a fresh redirect. Download signs `ResponseContentDisposition: attachment; filename="<original fileName>"`; stream and thumbnail are served inline. Rationale: players reuse the same URL for every range request, so a minutes-long TTL breaks playback of long videos.

### phase-03-videos/TD-08

**Recommendation:** it is the only layout that satisfies both the Docker networking rule (server calls via `minio`) and client reachability (signed URLs via the public endpoint), and keeps thumbnails and sources independently governable.
**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** it covers every phase capability with the smallest state machine; stale-draft cleanup is a retention policy better decided with Fase 04's draft/publish flow (recorded as a known gap, mitigated by the explicit abort endpoint).
**Libraries:** —
**Revisions:**
- 2026-10-23 — Draft ownership lookup fixed (validation DG-1): the draft is attached to the authenticated user's channel resolved through a new `ChannelsService.findByUserId` in the channels module (planned in this phase); `VideosModule` imports `ChannelsModule` and never queries the channels table directly. Rationale: Single Responsibility — the channels module owns channel reads.
- 2026-10-23 — Full transition set fixed (validation IC-1): `draft → processing` (complete endpoint), `draft → failed` (`UPLOAD_SIZE_MISMATCH` after aborting the multipart upload, per TD-03 revision), `processing → ready` (worker success), `processing → failed` (unrecoverable error or retries exhausted); `ready` and `failed` are terminal in this phase. Abort (`DELETE /videos/{id}/upload`, owner, `draft` only) calls `AbortMultipartUpload` and deletes the draft row. Rationale: the TD-03 size check introduced a failure before processing, and the abort outcome must be explicit for the API contract.

### phase-03-videos/TD-10

**Recommendation:** a single dev image keeps the Definition of Done runnable from the one documented container and lets FFmpeg, storage and queue be exercised for real; the extra image size is a dev-only cost.
**Libraries:** —

### phase-03-videos/TD-11

**Recommendation:** link-based public access for `ready` videos is the platform's stated default and is exactly the "unlisted via link" behavior Fase 04 formalizes, so no contract changes later; non-ready videos stay hidden (404) and status/metadata remain owner-only.
**Libraries:** —
**Revisions:**
- 2026-10-23 — Non-ready behavior clarified (validation AMB-6): stream, download and thumbnail return `404 VIDEO_NOT_FOUND` to everyone — owner included — until the video is `ready`; the owner follows progress only through the authenticated `GET /videos/{id}`. The decision label is reworded from "owner-only before" to "404 for everyone before". Rationale: `@Public()` routes skip the JWT guard entirely, so owner preview would require a new optional-auth guard for no phase capability.

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** **Option A (`@nestjs/swagger`)** — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger
**Revisions:**
- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`).

### openapi-docs-nestjs/TD-02

**Recommendation:** **Option C (Ambos)** — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** **Option B (Apenas em dev/staging)** — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema,... _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function... _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and... _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning... _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|-----------|--------|-----------|---------|
| (empty on first assembly — plan-resolve appends rows as user marks capabilities) |

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |
