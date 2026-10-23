---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-23T21:42:49+00:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-23T21:42:49+00:00"
issues:
  - id: AMB-1
    status: resolved
    summary: "Draft pre-registration input undefined (title rule, accepted file types)"
  - id: AMB-2
    status: resolved
    summary: "Upload resume undefined: presigned URL TTL and re-issue of part URLs"
  - id: MD-1
    status: resolved
    summary: "No TD decides who may stream/download a ready video (and its thumbnail)"
  - id: DG-1
    status: resolved
    summary: "Video→channel ownership needs authenticated user's channel lookup"
  - id: AMB-3
    status: resolved
    summary: "Extracted metadata set undefined: which fields besides duration are stored"
  - id: AMB-4
    status: resolved
    summary: "10GB limit checked only on declared size; stored part sizes never verified"
  - id: AMB-5
    status: resolved
    summary: "Presigned GET contract undefined: TTL vs long playback; download disposition"
  - id: AMB-6
    status: resolved
    summary: "TD-11 unclear if owner can stream/download before ready (label vs 404 rule)"
  - id: IC-1
    status: resolved
    summary: "TD-03 adds draft→failed transition absent from TD-09 lifecycle; abort undefined"
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._

## Resolved Issues

- **AMB-1** — Draft pre-registration input undefined. resolved_by: phase-03-videos/TD-02 revision 2026-10-23 — body `fileName`, `fileSize` (1 byte–10GiB), `contentType` ∈ {video/mp4, video/quicktime, video/webm, video/x-matroska}; optional `title` (1–100 chars) defaulting to the file name without extension.
- **AMB-2** — Upload resume undefined. resolved_by: phase-03-videos/TD-02 revision 2026-10-23 — part URLs TTL 1h (`S3_UPLOAD_URL_TTL`); `GET /videos/{id}/upload` lists stored parts and `POST /videos/{id}/upload/parts` re-issues URLs (owner, draft only).
- **MD-1** — No TD decided stream/download/thumbnail access. resolved_by: phase-03-videos/TD-11 (A) — public by short id once `ready`; 404 otherwise; status/metadata owner-only.
- **DG-1** — Channel lookup by user. resolved_by: phase-03-videos/TD-09 revision 2026-10-23 — new `ChannelsService.findByUserId` planned in this phase inside the channels module; VideosModule imports ChannelsModule.
- **AMB-3** — Extracted metadata set undefined. resolved_by: phase-03-videos/TD-05 revision 2026-10-23 — typed nullable columns `duration_seconds`, `width`, `height`, `video_codec`, `audio_codec`, `bitrate`, `format_name`; no video stream / unparseable → `UnrecoverableError` → `failed`.
- **AMB-4** — Stored size never verified. resolved_by: phase-03-videos/TD-03 revision 2026-10-23 — `ListParts` sum checked before `CompleteMultipartUpload`; mismatch or >10GiB → abort, `failed`, `400 UPLOAD_SIZE_MISMATCH`.
- **AMB-5** — Delivery URL TTL / download disposition. resolved_by: phase-03-videos/TD-07 revision 2026-10-23 — shared `S3_DELIVERY_URL_TTL` (default 21600s); download `attachment` with original fileName; stream/thumbnail inline.
- **AMB-6** — Owner access before ready. resolved_by: phase-03-videos/TD-11 revision 2026-10-23 — 404 for everyone until `ready`; owner uses `GET /videos/{id}`; label reworded.
- **IC-1** — TD-09 lifecycle vs draft→failed and abort outcome. resolved_by: phase-03-videos/TD-09 revision 2026-10-23 — full transition set listed (incl. `draft → failed` for `UPLOAD_SIZE_MISMATCH`); abort = `AbortMultipartUpload` + draft row deletion.
