# Security audit 10 — file uploads / malicious upload content

Date: 2026-07-22

## Scope

Reviewed user-controlled upload routes that store files under runtime upload directories and later serve them from `/uploads/...`.

## Fixed

### P1 — MIME spoofing on publicly served attachment uploads

Several attachment routes validated size, extension, and client-supplied MIME type, but did not verify the uploaded bytes before writing the file:

- `POST /api/v1/public/web-chat/upload`
- `POST /api/v1/tasks/[id]/files`
- `POST /api/v1/contracts/[id]/files`

Impact: a client could send active/binary content with a benign `Content-Type` and safe-looking extension. The `/uploads` proxy already applies auth/org checks and forces attachment for archives/unknowns, but saving spoofed content remains risky because uploads live in public upload trees and legacy/static server drift has existed before.

Mitigation:

- Added `src/lib/upload-security.ts` with signature/content checks for PDF, raster images, ZIP-based Office docs, legacy Office docs, ZIP, and text/csv.
- Public web-chat, task attachments, and contract attachments now validate bytes before writing to disk or creating DB rows.
- Stored MIME type is normalized to lowercase.

## Existing protections confirmed

- Upload size caps exist on reviewed routes.
- Dangerous extensions such as HTML/SVG/executables are blocked in public web-chat uploads.
- `/api/v1/uploads/[...path]` gates uploaded file reads by auth and organization ownership for web-chat/tasks/contracts.
- Archives are served as attachment by the uploads proxy.
- MTM mobile documents already had MIME/extension/magic-byte validation and private storage outside `public/uploads`.

## Residual risks / follow-up

- Avatar/image-only routes should also use shared byte validation for consistency.
- Telegram/WhatsApp/inbox media ingestion should be inventoried separately because those files originate from external providers rather than direct browser uploads.
- The existing code comments mention historical nginx alias drift for wildcard tenant domains; production routing should remain monitored so `/uploads` is always served through the auth gate.

## Verification

- `vitest run src/__tests__/lib-upload-security.test.ts`
- `eslint src/lib/upload-security.ts src/app/api/v1/public/web-chat/upload/route.ts src/app/api/v1/tasks/[id]/files/route.ts src/app/api/v1/contracts/[id]/files/route.ts src/__tests__/lib-upload-security.test.ts`
- `git diff --check`
