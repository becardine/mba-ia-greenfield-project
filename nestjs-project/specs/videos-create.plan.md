---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: nestjs-project/test/videos-create.e2e-spec.ts
---

# POST /videos Test Plan

## Application Overview

`POST /videos` pré-cadastra o vídeo como `draft` no canal do usuário autenticado e inicia o multipart upload no MinIO, devolvendo URLs pré-assinadas por parte — os bytes vão do cliente direto ao storage.

## Test Scenarios

### 1. POST /videos

**Setup:** `beforeEach` limpa as tabelas via `cleanAllTables`; `beforeAll` sobe `AppModule` via `Test.createTestingModule(...).compile()` com `ValidationPipe` e filtros globais iguais ao `main.ts`, força `S3_PUBLIC_ENDPOINT = S3_ENDPOINT` (o host público `localhost:9000` não é alcançável de dentro do container) e cria um usuário confirmado com login via helper `test/helpers/videos-e2e.ts`

#### 1.1. creates-draft-with-part-urls

**Covers AC:** #1, #5
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. POST /videos com Bearer válido e body `{ fileName: "aula.mp4", fileSize: 134217729, contentType: "video/mp4" }`
    - expect: status 201
    - expect: `status` = "draft", `title` = "aula", `partSize` = 67108864, `partCount` = 3, `shortId` casa `^[0-9A-Za-z]{11}$`
    - expect: `parts` tem 3 itens com `partNumber` 1..3 e `url` iniciando com o valor de `S3_PUBLIC_ENDPOINT`
    - expect: `expiresAt` é uma data ISO futura
    - expect: body não contém as chaves `uploadId`, `upload_id` nem `storage_key`
    - expect: linha em `videos` com `status = 'draft'`, `upload_id` não nulo e `channel_id` do canal do usuário
  2. PUT de 1KiB na URL da parte 1
    - expect: status 200 com header `ETag`

#### 1.2. uses-explicit-title

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. POST /videos com `{ fileName: "x.webm", fileSize: 1024, contentType: "video/webm", title: "  Meu vídeo  " }`
    - expect: status 201, `title` = "Meu vídeo", `partCount` = 1

#### 1.3. rejects-file-over-10gib

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. POST /videos com `fileSize: 10737418241`
    - expect: status 400, `error` = "VALIDATION_ERROR"
    - expect: nenhuma linha criada em `videos`

#### 1.4. rejects-non-video-content-type

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. POST /videos com `contentType: "application/pdf"`
    - expect: status 400, `error` = "VALIDATION_ERROR"
  2. POST /videos com propriedade desconhecida `foo: 1`
    - expect: status 400, `error` = "VALIDATION_ERROR"

#### 1.5. requires-authentication

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. POST /videos sem header Authorization
    - expect: status 401
