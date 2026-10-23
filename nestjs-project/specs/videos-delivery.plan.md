---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.12
target_file: nestjs-project/test/videos-delivery.e2e-spec.ts
---

# Public delivery (GET /videos/{shortId}/stream | download | thumbnail) Test Plan

## Application Overview

Fluxo ponta a ponta: upload real de uma fixture gerada com FFmpeg, processamento pelo worker (`WorkerModule` iniciado no mesmo processo de teste, consumindo do Redis real) e entrega pública por redirecionamento a URLs pré-assinadas, com o storage respondendo `206` a requisições de intervalo.

## Test Scenarios

### 1. Delivery of a ready video

**Setup:** igual a `videos-create.plan.md`; `beforeAll` gera a fixture MP4 de 2s 320x240 h264/aac via `src/test/video-fixture.ts`, inicia `NestFactory.createApplicationContext(WorkerModule)` e executa POST /videos → PUT da parte → POST complete, aguardando (poll de GET /videos/{id}, timeout 30s) `status = "ready"`; o contexto do worker é fechado em `afterAll`

#### 1.1. streams-with-range

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. GET /videos/{shortId}/stream sem Authorization, sem seguir redirect
    - expect: status 302, `Cache-Control` = "no-store", `Location` no host de `S3_PUBLIC_ENDPOINT`
  2. fetch do `Location` com `Range: bytes=0-1023`
    - expect: status 206, 1024 bytes, `Content-Range` começando com "bytes 0-1023/", `Content-Type` = "video/mp4"

#### 1.2. downloads-as-attachment

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. GET /videos/{shortId}/download sem token
    - expect: status 302
  2. fetch do `Location`
    - expect: status 200, `Content-Disposition` = `attachment; filename="<fileName enviado no POST /videos>"`, tamanho igual ao da fixture

#### 1.3. serves-thumbnail-and-metadata

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. GET /videos/{shortId}/thumbnail sem token
    - expect: status 302
  2. fetch do `Location`
    - expect: status 200, `Content-Type` = "image/jpeg", corpo começa com os bytes `FF D8 FF`
  3. GET /videos/{id} com o token do dono
    - expect: `durationSeconds` entre 1.9 e 2.1, `width` = 320, `height` = 240, `videoCodec` = "h264", `audioCodec` = "aac"

### 2. Non-ready and unknown videos

**Setup:** igual ao grupo 1, sem depender do worker: vídeo semeado como `processing` no canal do usuário

#### 2.1. hides-non-ready-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. GET /videos/{shortId}/stream, /download e /thumbnail do vídeo `processing` com o token do dono
    - expect: status 404, `error` = "VIDEO_NOT_FOUND" nos três
  2. Repetir sem token
    - expect: status 404, `error` = "VIDEO_NOT_FOUND" nos três

#### 2.2. rejects-unknown-short-id

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. GET /videos/abc/stream
    - expect: status 404, `error` = "VIDEO_NOT_FOUND"
  2. GET /videos/AAAAAAAAAAA/download (padrão válido, inexistente)
    - expect: status 404, `error` = "VIDEO_NOT_FOUND"
