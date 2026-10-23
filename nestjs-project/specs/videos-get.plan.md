---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: nestjs-project/test/videos-get.e2e-spec.ts
---

# GET /videos/{id} Test Plan

## Application Overview

Visão do dono sobre status e metadados extraídos de um vídeo, em qualquer estado do ciclo de vida.

## Test Scenarios

### 1. GET /videos/{id}

**Setup:** igual a `videos-create.plan.md`; vídeos semeados direto no repositório `Video` (draft/ready/failed) no canal do usuário

#### 1.1. returns-ready-metadata

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. Semear vídeo `ready` com `duration_seconds = 2.04`, `width = 320`, `height = 240`, `video_codec = 'h264'`, `file_size = 10737418240`; GET /videos/{id} com o token do dono
    - expect: status 200, `status` = "ready", `durationSeconds` = 2.04, `width` = 320, `height` = 240, `videoCodec` = "h264", `fileSize` = 10737418240 (número)
    - expect: `createdAt` e `updatedAt` são strings ISO; body não contém `uploadId` nem `storage_key`

#### 1.2. returns-failure-reason

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. Semear vídeo `failed` com `processing_error = 'NO_VIDEO_STREAM'`; GET /videos/{id}
    - expect: status 200, `status` = "failed", `processingError` = "NO_VIDEO_STREAM", `durationSeconds` = null

#### 1.3. hides-from-other-user

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. GET /videos/{id} com o token de outro usuário
    - expect: status 404, `error` = "VIDEO_NOT_FOUND"
  2. GET /videos/{id} sem token
    - expect: status 401

#### 1.4. validates-uuid

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. GET /videos/not-a-uuid
    - expect: status 400, `error` = "VALIDATION_ERROR"
