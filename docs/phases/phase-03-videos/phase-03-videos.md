---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-23T21:42:49+00:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-23T21:42:49+00:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-23T21:42:49+00:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o upload e processamento de vídeos — armazenamento de vídeos e thumbnails, processamento em segundo plano por fila, upload de até 10GB sem passar pela API com pré-cadastro automático como rascunho, extração de duração e metadados, thumbnail gerada de um frame, URL única por vídeo, reprodução via streaming e download — deixando funcional o upload de até 10GB, o processamento automático, o streaming e as URLs únicas.

---

## Step Implementations

### SI-03.1 — Infra: dependências, namespaces de configuração e serviços MinIO/Redis

**Description:** Prepara a infraestrutura da fase — bibliotecas de fila e storage, configuração validada por Joi e os serviços `minio` e `redis` no Compose, mais FFmpeg na imagem de desenvolvimento.

**Technical actions:**

1. Instalar no `nestjs-project` (dentro do container): `bullmq@6.4.1`, `@nestjs/bullmq@12.0.0`, `@aws-sdk/client-s3@3.1156.0`, `@aws-sdk/s3-request-presigner@3.1156.0` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`)
2. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` com `endpoint` (`S3_ENDPOINT`, default `http://minio:9000`), `publicEndpoint` (`S3_PUBLIC_ENDPOINT`, default `http://localhost:9000`), `region` (`S3_REGION`, default `us-east-1`), `accessKey` (`S3_ACCESS_KEY`), `secretKey` (`S3_SECRET_KEY`), `videosBucket` (`S3_VIDEOS_BUCKET`, default `videos`), `thumbnailsBucket` (`S3_THUMBNAILS_BUCKET`, default `thumbnails`), `uploadUrlTtl` (`S3_UPLOAD_URL_TTL`, default `3600`), `deliveryUrlTtl` (`S3_DELIVERY_URL_TTL`, default `21600`); e `src/config/queue.config.ts` — `registerAs('queue', ...)` com `redisHost` (`REDIS_HOST`, default `redis`) e `redisPort` (`REDIS_PORT`, default `6379`) (per `phase-01-configuracao-base/TD-03`, `phase-03-videos/TD-08`, `phase-03-videos/TD-07` revision)
3. Estender `src/config/env.validation.ts` com as novas variáveis (`S3_ACCESS_KEY`/`S3_SECRET_KEY` obrigatórias, demais com default; TTLs `Joi.number().integer().min(60)`; endpoints `Joi.string().uri()`), registrar `storageConfig` e `queueConfig` no `ConfigModule.forRoot({ load })` do `AppModule`, e atualizar `.env.example` (corrigindo também `MAIL_FROM="StreamTube <noreply@streamtube.com>"`, que hoje quebra o parse do Compose) (per `phase-01-configuracao-base/TD-02`)
4. Adicionar ao `compose.yaml` os serviços `minio` (`minio/minio`, `server /data --console-address :9001`, portas 9000/9001, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, healthcheck `mc ready local`, volume nomeado) e `redis` (`redis:7-alpine`, healthcheck `redis-cli ping`), com `nestjs-api` dependendo de ambos `service_healthy` (per `phase-03-videos/TD-08`, `phase-03-videos/TD-10`)
5. Adicionar `ffmpeg` ao `apt install` do `Dockerfile.dev` (fornece `ffprobe` e `ffmpeg` para API e worker) (per `phase-03-videos/TD-10`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` (novas variáveis) | Integration: obrigatórias ausentes rejeitadas, defaults aplicados, TTL < 60 rejeitado | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` sobe `minio` e `redis` saudáveis e `nestjs-api` só inicia depois deles
- Iniciar a aplicação sem `S3_ACCESS_KEY` falha no bootstrap com erro de validação Joi
- `ffprobe -version` e `ffmpeg -version` executam com sucesso dentro do container `nestjs-api`
- `.env.example` copiado para `.env` é aceito pelo Compose sem erro de parse

---

### SI-03.2 — Entidade Video e migration CreateVideos

**Description:** Cria a entidade `Video` (tabela `videos`) com ciclo de status, metadados tipados e relação com `Channel`, e a migration versionada correspondente.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` — `@Entity('videos')` com os campos, tipos e constraints de `### Data Model → Video` (enum `VideoStatus` exportado de `src/videos/video-status.enum.ts`; transformer `bigint → number` para `file_size` e `bitrate`; `@ManyToOne(() => Channel, { onDelete: 'CASCADE' })` + `@JoinColumn({ name: 'channel_id' })`; `@Index()` em `channel_id`) (per `phase-03-videos/TD-06`, `phase-03-videos/TD-09`, `phase-03-videos/TD-05` revision)
2. Gerar `src/database/migrations/<timestamp>-CreateVideos.ts` via `npm run migration:generate -- src/database/migrations/CreateVideos` e revisar o SQL (enum `videos_status_enum`, unique em `short_id`, FK com `ON DELETE CASCADE`, índice em `channel_id`); aplicar com `npm run migration:run`
3. Criar `src/videos/videos.module.ts` — `VideosModule` com `TypeOrmModule.forFeature([Video])`, importado no `AppModule`
4. Atualizar `src/test/create-test-data-source.ts` (`cleanAllTables` apaga `videos` antes de `channels`) e `src/database/migrations.integration-spec.ts` (incluir `videos_status_enum` em `MANAGED_ENUM_TYPES` e `videos` nas tabelas derrubadas)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: unique `short_id`, default `draft`, FK cascade ao remover channel, `file_size` > 2^31 lido como `number`, colunas de metadados nulas por padrão | `src/videos/entities/video.entity.integration-spec.ts` |
| Migrations | Integration: `CreateVideos` aplica e reverte com as demais | `src/database/migrations.integration-spec.ts` |

**Dependencies:** SI-03.1 — config carregada e Compose atualizado

**Acceptance criteria:**

- `npm run migration:run` cria a tabela `videos` e o tipo `videos_status_enum`; `npm run migration:revert` remove ambos
- Inserir dois vídeos com o mesmo `short_id` falha com violação de unicidade
- Um vídeo inserido sem `status` é persistido como `draft`
- Remover o canal remove em cascata os vídeos dele
- `file_size = 10737418240` é persistido e lido de volta como o número `10737418240`

---

### SI-03.3 — StorageService (S3/MinIO): buckets, multipart e URLs pré-assinadas

**Description:** Encapsula todo acesso ao object storage num `StorageService` reutilizado por API e worker, com dois clientes S3 (interno para chamadas do servidor, público só para assinar URLs de cliente).

**Technical actions:**

1. Criar `src/storage/storage.service.ts` — dois `S3Client` (`forcePathStyle: true`; `endpoint` interno e `publicEndpoint` só para presign) e `onModuleInit` que garante os buckets `videosBucket`/`thumbnailsBucket` idempotentemente (`HeadBucket` → `CreateBucket` em NotFound) (per `phase-03-videos/TD-08`)
2. Implementar operações multipart: `createMultipartUpload(key, contentType)`, `presignUploadParts(key, uploadId, partNumbers)` (TTL `uploadUrlTtl`, cliente público), `listParts(key, uploadId)` (paginando `IsTruncated`/`NextPartNumberMarker`), `completeMultipartUpload(key, uploadId, parts)` e `abortMultipartUpload(key, uploadId)` (per `phase-03-videos/TD-02` + revisions)
3. Implementar leitura/escrita: `presignGet(bucket, key, { contentType?, disposition?, ttl, publicUrl })` (cliente público para entrega, interno para o worker), `putObject(bucket, key, body, contentType)` e `deleteObject(bucket, key)` (per `phase-03-videos/TD-07` revision, `phase-03-videos/TD-05`)
4. Criar `src/storage/storage.module.ts` — `StorageModule` provendo e exportando `StorageService` (injeta `storageConfig.KEY`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (MinIO real): buckets criados idempotentemente; multipart com 2 partes de 5MiB enviadas por `fetch` nas URLs pré-assinadas; `listParts` retorna tamanhos/ETags; `complete` monta o objeto; `abort` invalida o upload; GET pré-assinado com `Range: bytes=0-99` responde `206`; `disposition` aparece em `Content-Disposition` | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilação com `ConfigModule` | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 — dependências AWS SDK, `storageConfig` e serviço `minio`

**Acceptance criteria:**

- Na primeira inicialização os buckets `videos` e `thumbnails` passam a existir no MinIO; reinicializar não gera erro
- Uma URL de `UploadPart` pré-assinada aceita um `PUT` direto do cliente e o `ETag` retornado é aceito por `CompleteMultipartUpload`
- Um GET pré-assinado com cabeçalho `Range` retorna `206 Partial Content` com exatamente o intervalo pedido
- URLs entregues ao cliente usam o host de `S3_PUBLIC_ENDPOINT`; chamadas do servidor usam `S3_ENDPOINT`
- Após `abortMultipartUpload`, `listParts` do mesmo `uploadId` falha com `NoSuchUpload`

---

### SI-03.4 — Lookup de canal por usuário e gerador de short id

**Description:** Entrega as duas peças de domínio que o pré-cadastro precisa: o canal do usuário autenticado (no módulo de canais) e o identificador curto único do vídeo.

**Technical actions:**

1. Adicionar `ChannelsService.findByUserId(userId: string): Promise<Channel | null>` em `src/channels/channels.service.ts` (busca por `user_id`, que é unique) (per `phase-03-videos/TD-09` revision DG-1)
2. Criar `src/videos/short-id.util.ts` — `generateShortId()` com 11 caracteres base62 a partir de `crypto.randomBytes` com rejection sampling (sem viés de módulo) e constante `SHORT_ID_PATTERN = /^[0-9A-Za-z]{11}$/` (per `phase-03-videos/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ChannelsService.findByUserId` | Integration: retorna o canal do usuário; `null` para usuário sem canal | `src/channels/channels.service.integration-spec.ts` |
| `generateShortId` | Unit: tamanho 11, alfabeto base62, casa `SHORT_ID_PATTERN`, 10 000 chamadas sem repetição | `src/videos/short-id.util.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `findByUserId` de um usuário registrado retorna o canal criado no cadastro
- `findByUserId` de um UUID sem usuário retorna `null`
- Todo id gerado tem 11 caracteres de `[0-9A-Za-z]`

---

### SI-03.5 — Endpoint POST /videos (pré-cadastro e início do upload)

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-create.plan.md`
**Authorization:** Authenticated

**Description:** Cria o vídeo como `draft` no canal do usuário, inicia o multipart upload e devolve as URLs pré-assinadas das partes — o arquivo nunca passa pela API.

**Technical actions:**

1. Criar `src/videos/dto/create-video.dto.ts` (`fileName`, `fileSize`, `contentType`, `title?` conforme `#### Validation Rules — videos`) e `src/videos/dto/upload-session.response.ts` (shape `Response 201` de `#### POST /videos`) com decorators Swagger
2. Criar `src/videos/videos.service.ts` — `createDraft(userId, dto)`: resolve canal via `ChannelsService.findByUserId` (`CHANNEL_NOT_FOUND`), calcula `partSize = 64MiB` e `partCount`, gera `short_id` com retry em violação de unicidade (até 5 tentativas), persiste `draft` com `storage_key = {id}/source`, chama `StorageService.createMultipartUpload`, salva `upload_id` e devolve as URLs de `presignUploadParts(1..partCount)` com `expiresAt` (per `phase-03-videos/TD-02` + revision AMB-1, `phase-03-videos/TD-06`, `phase-03-videos/TD-09`)
3. Adicionar `VideoNotFoundException`, `VideoNotDraftException`, `ChannelNotFoundException`, `InvalidPartNumbersException`, `UploadIncompleteException`, `UploadSizeMismatchException` em `src/common/exceptions/domain.exception.ts` (códigos e status de `### Error Catalog`)
4. Criar `src/videos/videos.controller.ts` com `POST /videos` (`@CurrentUser()`, `@ApiBearerAuth('access-token')`, `@ApiResponse` 201/400/401/404 com `ApiErrorEnvelope`) e registrar controller, `VideosService`, `ChannelsModule` e `StorageModule` no `VideosModule` (per `openapi-docs-nestjs/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.createDraft` | Unit: título default sem extensão e truncado a 100; `partCount` por `ceil`; retry de `short_id` em unique violation; `CHANNEL_NOT_FOUND` | `src/videos/videos.service.spec.ts` |
| `VideosService.createDraft` | Integration (DB + MinIO reais): linha `draft` com `upload_id`, URLs aceitam `PUT` | `src/videos/videos.service.integration-spec.ts` |
| `VideosModule` | Unit: compilação | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.2 (entidade), SI-03.3 (storage), SI-03.4 (canal + short id)

**Acceptance criteria:**

- `POST /videos` com `{ fileName: "aula.mp4", fileSize: 134217729, contentType: "video/mp4" }` retorna `201` com `status: "draft"`, `title: "aula"`, `partSize: 67108864`, `partCount: 3` e 3 `parts` com `url` no host de `S3_PUBLIC_ENDPOINT`
- `POST /videos` com `fileSize: 10737418241` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos` com `contentType: "application/pdf"` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos` sem token retorna `401`
- A resposta de `POST /videos` não contém `uploadId` nem `storage_key`

---

### SI-03.6 — Endpoints de retomada: GET /videos/{id}/upload e POST /videos/{id}/upload/parts

**Route:** GET /videos/{id}/upload, POST /videos/{id}/upload/parts
**Test Specs:** see `nestjs-project/specs/videos-upload-resume.plan.md`
**Authorization:** Owner

**Description:** Permite retomar um upload interrompido — consultar as partes já armazenadas e reemitir URLs expiradas — sem reiniciar o multipart upload.

**Technical actions:**

1. Adicionar `VideosService.findOwnedDraft(userId, id)` (privado/compartilhado): carrega o vídeo do canal do usuário (`VIDEO_NOT_FOUND` se ausente ou de outro canal) e exige `draft` (`VIDEO_NOT_DRAFT`) (per `phase-03-videos/TD-11`)
2. Adicionar `VideosService.getUploadStatus(userId, id)` — `StorageService.listParts` → `uploadedParts` ordenado (per `phase-03-videos/TD-02` revision AMB-2)
3. Adicionar `VideosService.reissuePartUrls(userId, id, partNumbers)` — rejeita `partNumber > partCount` com `INVALID_PART_NUMBERS`, devolve `presignUploadParts` + `expiresAt` (per `phase-03-videos/TD-02` revision AMB-2)
4. Criar `src/videos/dto/reissue-parts.dto.ts`, `src/videos/dto/upload-status.response.ts` e `src/videos/dto/part-urls.response.ts`; expor `GET /videos/:id/upload` e `POST /videos/:id/upload/parts` (`HttpCode(200)`, `ParseUUIDPipe`) com decorators Swagger

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getUploadStatus` / `reissuePartUrls` | Unit: não-dono → `VIDEO_NOT_FOUND`; não-draft → `VIDEO_NOT_DRAFT`; `INVALID_PART_NUMBERS` | `src/videos/videos.service.spec.ts` |
| `VideosService.getUploadStatus` | Integration (MinIO real): parte enviada aparece com `size` e `etag` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5 — draft e multipart iniciados

**Acceptance criteria:**

- Após enviar a parte 1 de um draft de 3 partes, `GET /videos/{id}/upload` retorna `200` com `uploadedParts` contendo só `partNumber: 1` e seu `size`
- `POST /videos/{id}/upload/parts` com `{ partNumbers: [2, 3] }` retorna `200` com duas URLs novas e `expiresAt` futuro
- `POST /videos/{id}/upload/parts` com `{ partNumbers: [4] }` num draft de 3 partes retorna `400` com `error: "INVALID_PART_NUMBERS"`
- `GET /videos/{id}/upload` por outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/{id}/upload` de um vídeo `processing` retorna `409` com `error: "VIDEO_NOT_DRAFT"`

---

### SI-03.7 — Fila video-processing (BullMQ) e produtor

**Description:** Liga a API ao Redis e registra a fila `video-processing` com as opções de retry, expondo um produtor idempotente usado pela conclusão do upload.

**Technical actions:**

1. Registrar `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: (cfg) => ({ connection: { host: cfg.redisHost, port: cfg.redisPort } }) })` num `src/queue/queue.module.ts` reutilizável por API e worker (per `phase-03-videos/TD-01`)
2. Criar `src/videos/video-processing.constants.ts` (`VIDEO_PROCESSING_QUEUE = 'video-processing'`, `PROCESS_VIDEO_JOB = 'process-video'`, `defaultJobOptions` de `### Events/Messages`) e registrar `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE, defaultJobOptions })` no `VideosModule`
3. Criar `src/videos/video-processing.queue.ts` — `VideoProcessingQueue.enqueue(videoId)` com `@InjectQueue(VIDEO_PROCESSING_QUEUE)` e `jobId = videoId` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-09`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingQueue` | Integration (Redis real): `enqueue` cria job `process-video` com `{ videoId }`, `attempts: 3`, backoff exponencial; segundo `enqueue` do mesmo id não duplica | `src/videos/video-processing.queue.integration-spec.ts` |

**Dependencies:** SI-03.1 (Redis + `queueConfig`), SI-03.2 (`VideosModule`)

**Acceptance criteria:**

- Enfileirar o mesmo `videoId` duas vezes resulta em um único job na fila
- O job criado carrega `{ videoId }`, `attempts: 3` e backoff exponencial de 5000ms
- A aplicação da API sobe conectada ao Redis sem registrar nenhum consumidor da fila

---

### SI-03.8 — Endpoints POST /videos/{id}/upload/complete e DELETE /videos/{id}/upload

**Route:** POST /videos/{id}/upload/complete, DELETE /videos/{id}/upload
**Test Specs:** see `nestjs-project/specs/videos-upload-complete.plan.md`
**Authorization:** Owner

**Description:** Fecha o upload (verificando o tamanho real armazenado antes de montar o objeto) e dispara o processamento, ou aborta um rascunho a pedido do dono.

**Technical actions:**

1. Criar `src/videos/dto/complete-upload.dto.ts` (`parts[]` com `partNumber`/`etag`, `ValidateNested`) e `src/videos/dto/video-status.response.ts` (`id`, `shortId`, `status`)
2. Adicionar `VideosService.completeUpload(userId, id, parts)`: `findOwnedDraft`; partes devem cobrir `1..partCount` (`UPLOAD_INCOMPLETE`); `listParts` — parte ausente ou `etag` divergente (comparação sem aspas) → `UPLOAD_INCOMPLETE`; soma de tamanhos ≠ `file_size` ou > 10GiB → `abortMultipartUpload`, status `failed` com `processing_error = 'UPLOAD_SIZE_MISMATCH'`, `upload_id = null` e `UPLOAD_SIZE_MISMATCH` (per `phase-03-videos/TD-03` + revision AMB-4)
3. No caminho feliz: `completeMultipartUpload`, status `processing`, `upload_id = null` e `VideoProcessingQueue.enqueue(id)` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-09` revision IC-1)
4. Adicionar `VideosService.abortUpload(userId, id)` — `findOwnedDraft`, `abortMultipartUpload` e remoção da linha (per `phase-03-videos/TD-09` revision IC-1)
5. Expor `POST /videos/:id/upload/complete` (`HttpCode(202)`) e `DELETE /videos/:id/upload` (`HttpCode(204)`) com `ParseUUIDPipe` e decorators Swagger

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` / `abortUpload` | Unit: cobertura de partes, etag divergente, mismatch de tamanho → abort + `failed`, caminho feliz enfileira, abort remove a linha | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration (DB + MinIO + Redis reais): objeto montado, status `processing`, job na fila; mismatch real aborta e marca `failed` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.6 (`findOwnedDraft`, resume), SI-03.7 (produtor da fila)

**Acceptance criteria:**

- `POST /videos/{id}/upload/complete` com todas as partes e ETags corretos retorna `202` com `status: "processing"` e o job `process-video` do vídeo passa a existir na fila
- `POST /videos/{id}/upload/complete` faltando uma parte retorna `400` com `error: "UPLOAD_INCOMPLETE"` e o vídeo continua `draft`
- Quando os bytes enviados somam mais que o `fileSize` declarado, `POST /videos/{id}/upload/complete` retorna `400` com `error: "UPLOAD_SIZE_MISMATCH"` e `GET /videos/{id}` passa a mostrar `status: "failed"`
- Repetir `POST /videos/{id}/upload/complete` após sucesso retorna `409` com `error: "VIDEO_NOT_DRAFT"`
- `DELETE /videos/{id}/upload` de um draft retorna `204` e um `GET /videos/{id}` seguinte retorna `404`

---

### SI-03.9 — MediaProbeService: metadados via ffprobe e thumbnail via ffmpeg

**Description:** Isola a execução dos binários do sistema sobre uma URL pré-assinada — sem cópia temporária do arquivo de até 10GB.

**Technical actions:**

1. Criar `src/media/media-probe.service.ts` — `probe(url)`: `spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', url])`, parse para `{ durationSeconds, width, height, videoCodec, audioCodec, bitrate, formatName }`; sem stream de vídeo → `NoVideoStreamError`; falha de execução/parse → `ProbeFailedError` (per `phase-03-videos/TD-05` + revision AMB-3)
2. Implementar `extractThumbnail(url, atSeconds)`: `spawn('ffmpeg', ['-ss', String(atSeconds), '-i', url, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'])` devolvendo `Buffer` JPEG, e `thumbnailOffset(duration)` = 10% da duração (0 quando duração < 1s) (per `phase-03-videos/TD-05`)
3. Criar `src/media/media.module.ts` exportando `MediaProbeService`, e `src/test/video-fixture.ts` que gera fixtures com `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=25 -f lavfi -i sine=duration=2 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac` (per `phase-03-videos/TD-10`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaProbeService` | Integration (ffmpeg real + MinIO): fixture gerada → `durationSeconds ≈ 2`, `320x240`, `h264`/`aac`; arquivo só-áudio → `NoVideoStreamError`; bytes aleatórios → `ProbeFailedError`; thumbnail começa com `FF D8` | `src/media/media-probe.service.integration-spec.ts` |
| `thumbnailOffset` | Unit: 10% da duração; 0 para duração < 1s | `src/media/media-probe.service.spec.ts` |

**Dependencies:** SI-03.1 (ffmpeg na imagem), SI-03.3 (presigned GET para a fixture)

**Acceptance criteria:**

- Sondar um MP4 de 2s 320x240 h264/aac retorna duração entre 1.9 e 2.1, `width: 320`, `height: 240`, `videoCodec: "h264"`, `audioCodec: "aac"`
- Sondar um arquivo sem stream de vídeo falha com o motivo `NO_VIDEO_STREAM`
- A thumbnail extraída é um JPEG válido (assinatura `FF D8 FF`)

---

### SI-03.10 — Video Worker: VideoProcessor, WorkerModule, entrypoint e serviço no Compose

**Description:** Segundo runtime do mesmo código: consome `process-video`, extrai metadados e thumbnail e conclui o ciclo de status no banco.

**Technical actions:**

1. Criar `src/worker/video.processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE)` estendendo `WorkerHost`: ignora vídeo inexistente ou fora de `processing`; GET pré-assinado interno do `storage_key`; `MediaProbeService.probe` (`NoVideoStreamError`/`ProbeFailedError` → `UnrecoverableError`); thumbnail em `thumbnailOffset(duration)` → `putObject` em `thumbnails/{id}.jpg`; salva metadados, `thumbnail_key`, `status = ready`, `processed_at` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-09`)
2. Implementar `@OnWorkerEvent('failed')` — quando `UnrecoverableError` ou `job.attemptsMade >= job.opts.attempts`, grava `status = failed`, `processing_error` e `processed_at` (per `phase-03-videos/TD-09`)
3. Criar `src/worker/worker.module.ts` (`ConfigModule` global com o mesmo `envValidationSchema`, `TypeOrmModule.forRootAsync` igual ao da API, `QueueModule`, `BullModule.registerQueue`, `TypeOrmModule.forFeature([Video])`, `StorageModule`, `MediaModule`, `VideoProcessor`) e `src/worker.ts` com `NestFactory.createApplicationContext(WorkerModule)` + `enableShutdownHooks()` (per `phase-03-videos/TD-04`)
4. Adicionar scripts `start:worker` (`ts-node src/worker.ts`) e `start:worker:prod` (`node dist/worker`) ao `package.json`, e o serviço `video-worker` ao `compose.yaml` (mesmo `Dockerfile.dev`/volume, `command: npm run start:worker`, `depends_on` `db`/`redis`/`minio` saudáveis) (per `phase-03-videos/TD-04`, `phase-03-videos/TD-10`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessor` | Integration (DB + MinIO + ffmpeg reais, `process(job)` direto): fixture → `ready` com metadados e thumbnail no bucket; arquivo inválido → `UnrecoverableError`; handler `failed` grava `failed` só na última tentativa | `src/worker/video.processor.integration-spec.ts` |
| `WorkerModule` | Unit: compilação sem `VideosController` (nenhum controller HTTP) | `src/worker/worker.module.spec.ts` |

**Dependencies:** SI-03.7 (fila), SI-03.9 (MediaProbeService), SI-03.3 (storage)

**Acceptance criteria:**

- Com `video-worker` em execução, um vídeo concluído passa de `processing` para `ready` em até 30s para a fixture de 2s, com `duration_seconds`, `width`, `height` e `thumbnail_key` preenchidos
- O objeto `thumbnails/{videoId}.jpg` existe no MinIO após o processamento
- Um vídeo cujo arquivo não tem stream de vídeo termina `failed` com `processing_error = "NO_VIDEO_STREAM"` sem novas tentativas
- `docker compose up -d video-worker` sobe o worker sem expor porta HTTP

---

### SI-03.11 — Endpoint GET /videos/{id} (status e metadados do dono)

**Route:** GET /videos/{id}
**Test Specs:** see `nestjs-project/specs/videos-get.plan.md`
**Authorization:** Owner

**Description:** Dá ao dono a visão do ciclo de vida e dos metadados extraídos — o único canal de acompanhamento antes de o vídeo ficar `ready`.

**Technical actions:**

1. Criar `src/videos/dto/video.response.ts` com o shape `Response 200` de `#### GET /videos/{id}` e um mapper `toVideoResponse(video)` (snake_case da entidade → camelCase do contrato)
2. Adicionar `VideosService.findOwned(userId, id)` (`VIDEO_NOT_FOUND` para ausente ou de outro canal, qualquer status) (per `phase-03-videos/TD-11` revision AMB-6)
3. Expor `GET /videos/:id` com `ParseUUIDPipe` e decorators Swagger

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.findOwned` | Unit: dono recebe vídeo; outro canal → `VIDEO_NOT_FOUND` | `src/videos/videos.service.spec.ts` |
| `toVideoResponse` | Unit: mapeamento completo, nulos preservados, datas ISO | `src/videos/dto/video.response.spec.ts` |

**Dependencies:** SI-03.5 (controller e serviço)

**Acceptance criteria:**

- `GET /videos/{id}` do dono de um vídeo `ready` retorna `200` com `status: "ready"`, `durationSeconds`, `width`, `height` e `videoCodec` preenchidos
- `GET /videos/{id}` de um vídeo `failed` retorna `200` com `processingError` preenchido
- `GET /videos/{id}` por outro usuário retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/not-a-uuid` retorna `400` com `error: "VALIDATION_ERROR"`

---

### SI-03.12 — Endpoints públicos de entrega: stream, download e thumbnail

**Route:** GET /videos/{shortId}/stream, GET /videos/{shortId}/download, GET /videos/{shortId}/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-delivery.plan.md`
**Authorization:** Anonymous

**Description:** Entrega o vídeo pronto por redirecionamento para URLs pré-assinadas, deixando o storage responder `206` às requisições de intervalo — a API fica fora do caminho dos bytes.

**Technical actions:**

1. Adicionar `VideosService.findReadyByShortId(shortId)` — `shortId` fora de `SHORT_ID_PATTERN`, inexistente ou com status ≠ `ready` → `VIDEO_NOT_FOUND` (per `phase-03-videos/TD-11` + revision AMB-6)
2. Adicionar `VideosService.getDeliveryUrl(shortId, kind: 'stream' | 'download' | 'thumbnail')` — `presignGet` no cliente público com TTL `deliveryUrlTtl`; stream inline com `ResponseContentType = content_type`; download com `ResponseContentDisposition: attachment; filename="<original_file_name>"` (aspas/controle sanitizados); thumbnail inline `image/jpeg` (per `phase-03-videos/TD-07` + revision AMB-5)
3. Expor `GET /videos/:shortId/stream`, `/download` e `/thumbnail` com `@Public()`, `@Redirect()` dinâmico (302) e `Cache-Control: no-store`, com `@ApiResponse` 302/404 (per `phase-03-videos/TD-07`, `openapi-docs-nestjs/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getDeliveryUrl` | Unit: status ≠ `ready` → `VIDEO_NOT_FOUND`; padrão inválido → `VIDEO_NOT_FOUND`; disposição só no download; filename sanitizado | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.10 (vídeos `ready` com thumbnail), SI-03.11 (`VideosService` de leitura)

**Acceptance criteria:**

- `GET /videos/{shortId}/stream` sem token de um vídeo `ready` retorna `302` cujo `Location`, requisitado com `Range: bytes=0-1023`, responde `206` com 1024 bytes
- `GET /videos/{shortId}/download` retorna `302` cujo `Location` responde com `Content-Disposition: attachment; filename="<fileName original>"`
- `GET /videos/{shortId}/thumbnail` retorna `302` cujo `Location` responde `200` com `Content-Type: image/jpeg`
- `GET /videos/{shortId}/stream` de um vídeo `processing` retorna `404` com `error: "VIDEO_NOT_FOUND"`, inclusive com o token do dono
- `GET /videos/abc/stream` retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.13 — Sincronização do contrato OpenAPI e da documentação

**Description:** Mantém o `openapi.json` versionado e os CLAUDE.md alinhados ao código entregue (fila deixa de ser "TBD"; novos serviços, variáveis e endpoints).

**Technical actions:**

1. Regenerar `nestjs-project/openapi.json` com `npm run openapi:export` e conferir os 9 endpoints `videos` (per `openapi-docs-nestjs/TD-02`)
2. Atualizar `CLAUDE.md` da raiz (Message Queue = BullMQ/Redis; Video Worker = container `video-worker`) e `docs/diagrams/software-arch.mermaid` (`ContainerQueue(queue, "Message Queue", "BullMQ + Redis", ...)`)
3. Atualizar `nestjs-project/CLAUDE.md` — módulos `videos`/`storage`/`media`/`queue`/`worker`, serviços Compose `minio`/`redis`/`video-worker`, variáveis `S3_*`/`REDIS_*`, comando `start:worker` e o override de `S3_PUBLIC_ENDPOINT` usado pelos testes

**Tests:** _(empty — documentation sync; the openapi export spec in `src/openapi-export.integration-spec.ts` keeps guarding the export)_

**Dependencies:** SI-03.12 (todos os endpoints existentes)

**Acceptance criteria:**

- `openapi.json` contém os paths `/videos`, `/videos/{id}`, `/videos/{id}/upload`, `/videos/{id}/upload/parts`, `/videos/{id}/upload/complete`, `/videos/{shortId}/stream`, `/videos/{shortId}/download` e `/videos/{shortId}/thumbnail`
- Nenhum CLAUDE.md ou diagrama do repositório descreve a fila como "TBD"
- Os comandos documentados em `nestjs-project/CLAUDE.md` sobem API e worker do zero num clone limpo

---

## Technical Specifications

### Data Model

#### Video

Table `videos` (new — migration `CreateVideos`). PK stays UUID; the public identifier is `short_id` (per `phase-03-videos/TD-06`).

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| channel_id | uuid | not null, FK → `channels.id` ON DELETE CASCADE |
| short_id | varchar(11) | unique, not null — base62 `[0-9A-Za-z]{11}` (per `phase-03-videos/TD-06`) |
| title | varchar(100) | not null — defaults to `fileName` without extension, truncated to 100 (per `phase-03-videos/TD-02` revision) |
| status | enum `videos_status_enum` (`draft`, `processing`, `ready`, `failed`) | not null, default `draft` (per `phase-03-videos/TD-09`) |
| original_file_name | varchar(255) | not null — `fileName` sent at initiation; used as download filename (per `phase-03-videos/TD-07` revision) |
| content_type | varchar(100) | not null — one of `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska` |
| file_size | bigint | not null — declared bytes, 1..10 737 418 240; mapped to `number` via column transformer |
| storage_key | varchar(255) | not null — `{videoId}/source` in bucket `S3_VIDEOS_BUCKET` (per `phase-03-videos/TD-08`) |
| upload_id | varchar(1024) | nullable — S3 multipart `UploadId`; set while `draft`, cleared (`null`) after complete/abort; never exposed in responses |
| part_size | integer | not null — 67 108 864 (64MiB) (per `phase-03-videos/TD-02`) |
| part_count | integer | not null — `ceil(file_size / part_size)`, 1..160 |
| thumbnail_key | varchar(255) | nullable — `{videoId}.jpg` in bucket `S3_THUMBNAILS_BUCKET`, set when `ready` |
| duration_seconds | double precision | nullable (per `phase-03-videos/TD-05` revision) |
| width | integer | nullable |
| height | integer | nullable |
| video_codec | varchar(50) | nullable |
| audio_codec | varchar(50) | nullable — null when the file has no audio stream |
| bitrate | bigint | nullable — bits/s from ffprobe `format.bit_rate`; transformer to `number` |
| format_name | varchar(100) | nullable — ffprobe `format.format_name` |
| processing_error | text | nullable — terminal failure reason when `failed` (per `phase-03-videos/TD-09`) |
| processed_at | timestamptz | nullable — set when the video reaches `ready` or `failed` |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now(), auto-updated |

**Relations:** `Channel` has many `Video` (one-to-many; `Video.channel` is `@ManyToOne` with `@JoinColumn({ name: 'channel_id' })`, `onDelete: 'CASCADE'`)
**Indexes:** unique on `short_id`; btree on `channel_id`

**Status transitions** (per `phase-03-videos/TD-09`): `draft → processing` (complete endpoint) · `draft → failed` (size mismatch, per `phase-03-videos/TD-03` revision) · `processing → ready` (worker success) · `processing → failed` (unrecoverable error or retries exhausted). A `draft` row is deleted on abort. No transition leaves `ready`/`failed` in this phase.

### API Contracts

All endpoints live in `VideosController` (`@ApiTags('videos')`, prefix `/videos`). Owner endpoints require `Authorization: Bearer <access_token>` (global `JwtAuthGuard`, `phase-02-auth/TD-02`); delivery endpoints are `@Public()` (per `phase-03-videos/TD-11`). Error bodies follow the inherited `{ statusCode, error, message }` envelope (`phase-02-auth/TD-07`). `{id}` is the video UUID (`ParseUUIDPipe` → `400 VALIDATION_ERROR` when malformed); `{shortId}` is the 11-char base62 id — a value that does not match `^[0-9A-Za-z]{11}$` is answered as `404 VIDEO_NOT_FOUND`.

#### POST /videos (SI-03.5)

Creates the `draft` video, initiates the S3 multipart upload and returns presigned part URLs (per `phase-03-videos/TD-02`, `phase-03-videos/TD-06`, `phase-03-videos/TD-09`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- fileName: string, required — 1–255 characters after trim
- fileSize: integer, required — 1..10737418240 (10GiB)
- contentType: string, required — one of `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`
- title: string, optional — 1–100 characters after trim; defaults to `fileName` without its extension (truncated to 100)

**Response 201:**
- id: string (uuid)
- shortId: string (11 chars, base62)
- title: string
- status: `"draft"`
- partSize: integer — 67108864
- partCount: integer — `ceil(fileSize / partSize)`
- parts: array of `{ partNumber: integer, url: string }` — one presigned `UploadPart` URL per part, signed for `S3_PUBLIC_ENDPOINT`
- expiresAt: string (ISO-8601) — now + `S3_UPLOAD_URL_TTL`

**Error responses:**
- 400 VALIDATION_ERROR: body fails validation (missing field, size out of range, content type not allowed, unknown property)
- 401 Unauthorized: missing/invalid access token
- 404 CHANNEL_NOT_FOUND: the authenticated user has no channel

---

#### GET /videos/{id}/upload (SI-03.6)

Upload progress for resume — parts already stored in S3 (per `phase-03-videos/TD-02` revision, AMB-2).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- id: string (uuid)
- status: `"draft"`
- partSize: integer
- partCount: integer
- uploadedParts: array of `{ partNumber: integer, etag: string, size: integer }` — from S3 `ListParts` (all pages), ascending by `partNumber`

**Error responses:**
- 400 VALIDATION_ERROR: `id` is not a UUID
- 401 Unauthorized: missing/invalid access token
- 404 VIDEO_NOT_FOUND: no video with this id, or it belongs to another user's channel
- 409 VIDEO_NOT_DRAFT: the video is no longer `draft`

---

#### POST /videos/{id}/upload/parts (SI-03.6)

Re-issues presigned part URLs for an in-progress draft (per `phase-03-videos/TD-02` revision, AMB-2).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- partNumbers: integer[], required — 1–160 unique integers, each ≥ 1

**Response 200:**
- parts: array of `{ partNumber: integer, url: string }` — ascending by `partNumber`
- expiresAt: string (ISO-8601) — now + `S3_UPLOAD_URL_TTL`

**Error responses:**
- 400 VALIDATION_ERROR: body fails validation
- 400 INVALID_PART_NUMBERS: some `partNumber` is greater than the video's `partCount`
- 401 Unauthorized: missing/invalid access token
- 404 VIDEO_NOT_FOUND: no video with this id, or not owned
- 409 VIDEO_NOT_DRAFT: the video is no longer `draft`

---

#### POST /videos/{id}/upload/complete (SI-03.8)

Verifies the stored parts, completes the multipart upload, moves the video to `processing` and enqueues the processing job (per `phase-03-videos/TD-03` + revision AMB-4, `phase-03-videos/TD-01`, `phase-03-videos/TD-09`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- parts: array, required — 1–160 items of `{ partNumber: integer ≥ 1, etag: string (non-empty) }`; must cover exactly `1..partCount`

**Response 202:**
- id: string (uuid)
- shortId: string
- status: `"processing"`

**Error responses:**
- 400 VALIDATION_ERROR: body fails validation
- 400 UPLOAD_INCOMPLETE: `parts` does not cover `1..partCount`, a listed part is missing from S3, or an `etag` does not match the stored part (video stays `draft`; the client may resume)
- 400 UPLOAD_SIZE_MISMATCH: sum of stored part sizes ≠ declared `fileSize` or > 10GiB — multipart upload aborted, video set to `failed` with `processing_error = 'UPLOAD_SIZE_MISMATCH'`
- 401 Unauthorized: missing/invalid access token
- 404 VIDEO_NOT_FOUND: no video with this id, or not owned
- 409 VIDEO_NOT_DRAFT: the video is no longer `draft` (e.g., complete called twice)

---

#### DELETE /videos/{id}/upload (SI-03.8)

Owner aborts a draft: `AbortMultipartUpload` + row removal (per `phase-03-videos/TD-09`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 204:** No content.

**Error responses:**
- 400 VALIDATION_ERROR: `id` is not a UUID
- 401 Unauthorized: missing/invalid access token
- 404 VIDEO_NOT_FOUND: no video with this id, or not owned
- 409 VIDEO_NOT_DRAFT: the video is no longer `draft`

---

#### GET /videos/{id} (SI-03.11)

Owner view of status and extracted metadata (per `phase-03-videos/TD-11` revision AMB-6, `phase-03-videos/TD-05` revision AMB-3).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- id: string (uuid)
- shortId: string
- title: string
- status: `"draft" | "processing" | "ready" | "failed"`
- originalFileName: string
- contentType: string
- fileSize: integer
- durationSeconds: number | null
- width: integer | null
- height: integer | null
- videoCodec: string | null
- audioCodec: string | null
- bitrate: integer | null
- formatName: string | null
- processingError: string | null
- processedAt: string (ISO-8601) | null
- createdAt: string (ISO-8601)
- updatedAt: string (ISO-8601)

**Error responses:**
- 400 VALIDATION_ERROR: `id` is not a UUID
- 401 Unauthorized: missing/invalid access token
- 404 VIDEO_NOT_FOUND: no video with this id, or not owned

---

#### GET /videos/{shortId}/stream (SI-03.12)

Redirect to an inline presigned `GetObject` URL on `S3_PUBLIC_ENDPOINT`; the storage answers `Range` requests with `206 Partial Content` (per `phase-03-videos/TD-07` + revision AMB-5, `phase-03-videos/TD-11`).

**Response 302:**
- Location: presigned GET URL for `videos/{videoId}/source`, `ResponseContentType` = stored `content_type`, valid `S3_DELIVERY_URL_TTL` seconds
- Cache-Control: no-store

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown/malformed `shortId`, or status ≠ `ready` (owner included)

---

#### GET /videos/{shortId}/download (SI-03.12)

Same as stream, but the presigned URL carries `ResponseContentDisposition: attachment; filename="<original_file_name>"` (per `phase-03-videos/TD-07` revision AMB-5).

**Response 302:**
- Location: presigned GET URL (attachment disposition), valid `S3_DELIVERY_URL_TTL` seconds
- Cache-Control: no-store

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown/malformed `shortId`, or status ≠ `ready`

---

#### GET /videos/{shortId}/thumbnail (SI-03.12)

Redirect to an inline presigned GET for `thumbnails/{videoId}.jpg` (`image/jpeg`) (per `phase-03-videos/TD-05`, `phase-03-videos/TD-11`).

**Response 302:**
- Location: presigned GET URL, valid `S3_DELIVERY_URL_TTL` seconds
- Cache-Control: no-store

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown/malformed `shortId`, or status ≠ `ready`

---

#### Validation Rules — videos

- `fileName`: required string, trimmed, 1–255 characters
- `fileSize`: required integer, min 1, max 10737418240
- `contentType`: required, `IsIn(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'])`
- `title`: optional string, trimmed, 1–100 characters
- `partNumbers`: required integer array, `ArrayMinSize(1)`, `ArrayMaxSize(160)`, `ArrayUnique`, each `Min(1)`
- `parts`: required array, `ArrayMinSize(1)`, `ArrayMaxSize(160)`, nested `{ partNumber: Int Min(1), etag: non-empty string }` (`ValidateNested` + `Type`)
- Unknown properties are rejected by the global `ValidationPipe` (`forbidNonWhitelisted`)

### Authorization Matrix

Owner = the authenticated user whose channel (`ChannelsService.findByUserId`, per `phase-03-videos/TD-09` revision DG-1) is the video's `channel_id`. A non-owner gets the same `404 VIDEO_NOT_FOUND` as a missing id (no existence leak). Delivery rows apply only to `status = ready`; any other status answers `404` to everyone, owner included (per `phase-03-videos/TD-11` + revision AMB-6).

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ (401) | ✓ (creates in own channel) | — |
| GET /videos/{id}/upload | ✗ (401) | ✗ (404) | ✓ (`draft` only, else 409) |
| POST /videos/{id}/upload/parts | ✗ (401) | ✗ (404) | ✓ (`draft` only, else 409) |
| POST /videos/{id}/upload/complete | ✗ (401) | ✗ (404) | ✓ (`draft` only, else 409) |
| DELETE /videos/{id}/upload | ✗ (401) | ✗ (404) | ✓ (`draft` only, else 409) |
| GET /videos/{id} | ✗ (401) | ✗ (404) | ✓ (any status) |
| GET /videos/{shortId}/stream | ✓ (`ready`) | ✓ (`ready`) | ✓ (`ready`) |
| GET /videos/{shortId}/download | ✓ (`ready`) | ✓ (`ready`) | ✓ (`ready`) |
| GET /videos/{shortId}/thumbnail | ✓ (`ready`) | ✓ (`ready`) | ✓ (`ready`) |

### Error Catalog

Inherited envelope `{ statusCode, error, message }` (`phase-02-auth/TD-07`); new `DomainException` subclasses live in `src/common/exceptions/domain.exception.ts`. `VALIDATION_ERROR` (400) and `401 Unauthorized` are inherited unchanged.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | `{id}` unknown or not owned; `{shortId}` unknown/malformed or video not `ready` |
| VIDEO_NOT_DRAFT | 409 | Upload operation (`GET/DELETE /videos/{id}/upload`, `POST .../parts`, `POST .../complete`) on a video whose status is not `draft` |
| CHANNEL_NOT_FOUND | 404 | `POST /videos` by a user without a channel |
| INVALID_PART_NUMBERS | 400 | `POST /videos/{id}/upload/parts` with a `partNumber` greater than the video's `partCount` |
| UPLOAD_INCOMPLETE | 400 | `POST /videos/{id}/upload/complete` whose `parts` do not cover `1..partCount`, reference a part missing from S3, or carry a mismatching `etag` |
| UPLOAD_SIZE_MISMATCH | 400 | `POST /videos/{id}/upload/complete` when the stored part sizes sum ≠ declared `fileSize` or > 10GiB (upload aborted, video `failed`, per `phase-03-videos/TD-03` revision) |

Worker-side failures are not HTTP errors: they end in `status = failed` with `processing_error` = the reason (`NO_VIDEO_STREAM`, `PROBE_FAILED: <message>`, `THUMBNAIL_FAILED: <message>`, or the last error message once retries are exhausted), visible through `GET /videos/{id}`.

### Events/Messages

#### video-processing / process-video

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideoProcessingQueue` (`src/videos/video-processing.queue.ts`, `@InjectQueue('video-processing')`), called by `VideosService.completeUpload` after the row is `processing` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`)
**Consumer:** `VideoProcessor` (`src/worker/video.processor.ts`, `@Processor('video-processing')` extends `WorkerHost`), registered only in `WorkerModule` loaded by `src/worker.ts` — the API process never consumes (per `phase-03-videos/TD-04`)
**Trigger:** successful `POST /videos/{id}/upload/complete`
**Job options:** `jobId = videoId` (idempotent enqueue), `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`, `removeOnComplete: true` (per `phase-03-videos/TD-09`)
**Processing:** skip unless status is `processing` → ffprobe over a presigned internal GET URL → no video stream ⇒ `UnrecoverableError('NO_VIDEO_STREAM')` → ffmpeg frame at 10% of duration (0s when duration < 1s) → `PutObject` `thumbnails/{videoId}.jpg` → row `ready` with metadata columns and `processed_at` (per `phase-03-videos/TD-05` + revision AMB-3)
**Failure:** `@OnWorkerEvent('failed')` sets `failed` + `processing_error` + `processed_at` when the error is `UnrecoverableError` or `job.attemptsMade >= job.opts.attempts`; intermediate failures are retried with backoff
**Delivery semantics:** at-least-once (per `phase-03-videos/TD-01`); the consumer is idempotent (status guard + overwrite of the same thumbnail key)

---

## Dependency Map

SI-03.1 (root — infra: deps, config, MinIO/Redis, FFmpeg)
├── SI-03.2 — depends on SI-03.1 (config + Compose before entity/migration)
│   └── SI-03.7 — depends on SI-03.1 + SI-03.2 (Redis/queueConfig + VideosModule)
├── SI-03.3 — depends on SI-03.1 (AWS SDK + storageConfig + minio)
│   └── SI-03.9 — depends on SI-03.1 + SI-03.3 (ffmpeg + presigned GET for fixtures)
SI-03.4 (root, independent — channel lookup + short id)
SI-03.5 — depends on SI-03.2 + SI-03.3 + SI-03.4 (entity, storage, channel/short id before draft endpoint)
├── SI-03.6 — depends on SI-03.5 (draft + multipart must exist to resume)
│   └── SI-03.8 — depends on SI-03.6 + SI-03.7 (findOwnedDraft + queue producer)
└── SI-03.11 — depends on SI-03.5 (controller/service in place)
SI-03.10 — depends on SI-03.7 + SI-03.9 + SI-03.3 (queue, media probe, storage)
SI-03.12 — depends on SI-03.10 + SI-03.11 (ready videos with thumbnail; read service)
└── SI-03.13 — depends on SI-03.12 (all endpoints exist before OpenAPI/doc sync)

---

## Deliverables

- [ ] SI-03.1 — Infra: dependências, namespaces de configuração e serviços MinIO/Redis
- [ ] SI-03.2 — Entidade Video e migration CreateVideos
- [ ] SI-03.3 — StorageService (S3/MinIO): buckets, multipart e URLs pré-assinadas
- [ ] SI-03.4 — Lookup de canal por usuário e gerador de short id
- [ ] SI-03.5 — Endpoint POST /videos (pré-cadastro e início do upload)
- [ ] SI-03.6 — Endpoints de retomada: GET /videos/{id}/upload e POST /videos/{id}/upload/parts
- [ ] SI-03.7 — Fila video-processing (BullMQ) e produtor
- [ ] SI-03.8 — Endpoints POST /videos/{id}/upload/complete e DELETE /videos/{id}/upload
- [ ] SI-03.9 — MediaProbeService: metadados via ffprobe e thumbnail via ffmpeg
- [ ] SI-03.10 — Video Worker: VideoProcessor, WorkerModule, entrypoint e serviço no Compose
- [ ] SI-03.11 — Endpoint GET /videos/{id} (status e metadados do dono)
- [ ] SI-03.12 — Endpoints públicos de entrega: stream, download e thumbnail
- [ ] SI-03.13 — Sincronização do contrato OpenAPI e da documentação

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e -- --runInBand`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
