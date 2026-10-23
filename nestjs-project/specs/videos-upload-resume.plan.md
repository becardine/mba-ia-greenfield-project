---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: nestjs-project/test/videos-upload-resume.e2e-spec.ts
---

# Upload resume (GET /videos/{id}/upload, POST /videos/{id}/upload/parts) Test Plan

## Application Overview

Permite ao dono de um `draft` descobrir quais partes já estão no storage e reemitir URLs pré-assinadas expiradas, retomando o upload sem reiniciá-lo.

## Test Scenarios

### 1. GET /videos/{id}/upload

**Setup:** igual a `videos-create.plan.md` (AppModule, override de `S3_PUBLIC_ENDPOINT`, usuário confirmado via `test/helpers/videos-e2e.ts`); cada cenário cria um draft com `fileSize = 134217729` (3 partes)

#### 1.1. lists-uploaded-parts

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. PUT de 1024 bytes na URL da parte 1
    - expect: status 200 com `ETag`
  2. GET /videos/{id}/upload com o token do dono
    - expect: status 200, `status` = "draft", `partCount` = 3
    - expect: `uploadedParts` tem um único item `{ partNumber: 1, size: 1024 }` cujo `etag` (sem aspas) é igual ao `ETag` do passo 1 (sem aspas)

#### 1.2. hides-video-from-other-user

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. GET /videos/{id}/upload com o token de um segundo usuário confirmado
    - expect: status 404, `error` = "VIDEO_NOT_FOUND"
  2. GET /videos/{uuid aleatório}/upload com o token do dono
    - expect: status 404, `error` = "VIDEO_NOT_FOUND"
  3. GET /videos/not-a-uuid/upload
    - expect: status 400, `error` = "VALIDATION_ERROR"

#### 1.3. rejects-non-draft

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. Atualizar no banco o status do vídeo para `processing`; GET /videos/{id}/upload com o token do dono
    - expect: status 409, `error` = "VIDEO_NOT_DRAFT"

### 2. POST /videos/{id}/upload/parts

**Setup:** igual ao grupo 1

#### 2.1. reissues-part-urls

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. POST /videos/{id}/upload/parts com `{ partNumbers: [3, 2] }`
    - expect: status 200, `parts` com `partNumber` [2, 3] em ordem crescente e `url` no host de `S3_PUBLIC_ENDPOINT`
    - expect: `expiresAt` futuro
  2. PUT de 1KiB na URL reemitida da parte 2
    - expect: status 200

#### 2.2. rejects-part-number-beyond-count

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-23T21:50:00Z

**Steps:**
  1. POST /videos/{id}/upload/parts com `{ partNumbers: [4] }`
    - expect: status 400, `error` = "INVALID_PART_NUMBERS"
  2. POST /videos/{id}/upload/parts com `{ partNumbers: [] }` e depois com `{ partNumbers: [1, 1] }`
    - expect: status 400, `error` = "VALIDATION_ERROR" nos dois
