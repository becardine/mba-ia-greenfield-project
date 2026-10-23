---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: nestjs-project/test/videos-upload-complete.e2e-spec.ts
---

# Upload completion and abort (POST /videos/{id}/upload/complete, DELETE /videos/{id}/upload) Test Plan

## Application Overview

`complete` verifica no storage as partes e o tamanho real antes de montar o objeto, move o vídeo para `processing` e enfileira `process-video`; `DELETE` aborta o multipart e remove o rascunho.

## Test Scenarios

### 1. POST /videos/{id}/upload/complete

**Setup:** igual a `videos-create.plan.md`; obtém a `Queue` `video-processing` via `getQueueToken` e a esvazia (`obliterate({ force: true })`) em `beforeEach`; nenhum worker é iniciado neste arquivo

#### 1.1. completes-and-enqueues

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. POST /videos com `fileSize: 2048`; PUT dos 2048 bytes na URL da parte 1
    - expect: PUT 200 com `ETag`
  2. POST /videos/{id}/upload/complete com `{ parts: [{ partNumber: 1, etag }] }`
    - expect: status 202, body `{ id, shortId, status: "processing" }`
    - expect: linha com `status = 'processing'` e `upload_id` nulo
    - expect: `queue.getJob(id)` existe com nome `process-video` e data `{ videoId: id }`

#### 1.2. rejects-missing-or-wrong-parts

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. Draft de 3 partes com só a parte 1 enviada; POST complete com apenas a parte 1
    - expect: status 400, `error` = "UPLOAD_INCOMPLETE"
    - expect: vídeo continua `draft` e GET /videos/{id}/upload ainda responde 200
  2. Draft de 1 parte enviada; POST complete com `etag` inválido na parte 1
    - expect: status 400, `error` = "UPLOAD_INCOMPLETE"

#### 1.3. rejects-size-mismatch

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. POST /videos com `fileSize: 1024`; PUT de 2048 bytes na parte 1; POST complete com o ETag
    - expect: status 400, `error` = "UPLOAD_SIZE_MISMATCH"
  2. GET /videos/{id}
    - expect: status 200, `status` = "failed", `processingError` = "UPLOAD_SIZE_MISMATCH"
  3. Consultar a fila
    - expect: nenhum job para o vídeo

#### 1.4. rejects-second-complete

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. Após completar com sucesso, repetir POST complete com o mesmo body
    - expect: status 409, `error` = "VIDEO_NOT_DRAFT"
  2. POST complete de um draft por outro usuário
    - expect: status 404, `error` = "VIDEO_NOT_FOUND"
  3. POST complete com `{ parts: [] }`
    - expect: status 400, `error` = "VALIDATION_ERROR"

### 2. DELETE /videos/{id}/upload

**Setup:** igual ao grupo 1

#### 2.1. aborts-draft

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. DELETE /videos/{id}/upload de um draft com uma parte enviada
    - expect: status 204
  2. GET /videos/{id}
    - expect: status 404, `error` = "VIDEO_NOT_FOUND"
  3. PUT na URL ainda não expirada da parte 2
    - expect: status 404 (NoSuchUpload) do storage

#### 2.2. abort-requires-draft-and-auth

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. DELETE /videos/{id}/upload de um vídeo `processing`
    - expect: status 409, `error` = "VIDEO_NOT_DRAFT"
  2. DELETE sem token
    - expect: status 401
