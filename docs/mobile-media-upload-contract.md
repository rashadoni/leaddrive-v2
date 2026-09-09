# LeadDrive Field — media upload contract

**Status:** server-first additive safety slice.
**Compatibility:** `/api/v1/mtm/photos` and
`/api/v1/mtm/mobile/documents/upload` remain protocol-v1 endpoints. Existing
APKs keep using them; the additive bootstrap `manifest.media` field is ignored
by clients that do not understand it.

## Admission and rollout

Every mobile upload is authenticated through the mobile JWT, tenant RLS and
`FIELD_EXECUTE` plus the tenant `route-field` entitlement. Tenant, agent and
role are never accepted from multipart fields.

The server may enable the `media` stream in `mtm_mobile_sync_cohorts` for an
exact `(tenant, agent, device)` after the compatible APK is installed. The
bootstrap manifest then advertises:

```json
{
  "media": { "uploads": true, "uploadsEpoch": "server-owned-epoch:media" }
}
```

The request header `x-field-device-id` only selects a server-owned cohort; it
does not enable a protocol or disable protection. Once an active media cohort
exists for an authenticated agent, a missing or different device ID is denied
with `403 MTM_MOBILE_MEDIA_DEVICE_COHORT_REQUIRED` rather than falling back to
the legacy path. This prevents a mutable header from opting an enrolled device
out of protection. A device outside any active cohort remains protocol-v1
compatible. The header is not cryptographic device attestation: the current
mobile JWT predates device-bound claims. It is deliberately insufficient to
gain a less-protected path; a future device-registration/token change can bind
the selector without changing this fallback rule.

`GET /api/v1/mtm/mobile/media/preflight` is advisory and no-store. It returns
the server-selected contract plus hard file/envelope limits. Both POST routes
repeat all admission before parsing multipart data, so a preflight response is
never an authorization token.

## Backpressure

The current multipart runtime materializes a bounded body before validation.
Until streaming intake/object storage is introduced, mobile uploads acquire a
Redis-backed global, tenant, user and device admission slot before body parsing:

- global: 2 concurrent uploads;
- tenant/user/device: 1 concurrent upload each;
- tenant/user/device request budgets: 120/30/20 per minute.

The guard fails closed with `503 MTM_MOBILE_MEDIA_GUARD_UNAVAILABLE` if Redis
is unavailable in production. Exhaustion returns
`429 MTM_MOBILE_MEDIA_RATE_LIMITED`. Both include a bounded `Retry-After`
header. The Field media supervisor must retry these independently with jitter;
they must not stop unrelated Field outbox operations.

Multipart envelopes are rejected before `formData()` at 11 MiB for photos and
26 MiB for documents (`413 MTM_MOBILE_MEDIA_PAYLOAD_TOO_LARGE`). These are
temporary conservative limits, not an object-storage implementation.

## Durable retry and idempotency

Photo `clientPhotoId` and document `clientDocumentId` are durable IDs. The
server computes SHA-256 from the original bytes before acknowledging a retry.
It replays only an exact match of bytes and causal binding:

- photo: digest, visit, category and coordinates;
- document: digest, filename, MIME type, byte size, title, visit and task.

A reused ID with a different payload receives `409 MTM_PHOTO_ID_CONFLICT` or
`409 MTM_DOCUMENT_ID_CONFLICT`; the client must retain its encrypted local
file and show recovery rather than deleting it. Historic photo rows without a
digest intentionally conflict on replay, because equality cannot be proven.

`checksumSha256` on `mtm_photos` is an additive nullable migration. Deploy the
migration before code that writes the new column. No existing photo data is
rewritten, and existing RLS policies remain in force.

## Telemetry and rollback

Upload telemetry carries only HMAC tenant, endpoint, contract version, safe APK
version, result class, byte bucket and duration. It excludes device IDs, media
IDs, paths, filenames, exact bytes, document metadata and GPS coordinates.

To roll back the enhanced client path, disable the exact `media` cohort row.
The protocol-v1 endpoints and stored local media remain intact. Do not clear
the mobile outbox or delete local media as part of rollback.

## Object-storage M3: exact-cohort, single-authority path

The server may additionally set `MTM_MEDIA_OBJECT_STORAGE_MODE=s3`. This is
still **disabled by default**. It is consulted only after the server selected
the exact active `media` cohort; v1 callers and an isolated cohort while the
mode is disabled continue using the existing local-file path.

When both the exact cohort and complete object-storage configuration are
present, a new upload has exactly one authoritative byte path:

```text
exact Field media cohort + M3 enabled  -> encrypted private S3-compatible object
all other/old Field callers            -> existing v1 local file
```

The server never writes both an object and a local file for one upload. It
creates an RLS-protected `mtm_media_objects` `PENDING` row first, keyed by
`(tenant, uploader agent, client media ID)`, then PUTs one opaque object key,
and only attaches it to the photo/document in the same transaction that marks
the row `COMMITTED`. A retry with the same ID and exact request hash resumes
the same reservation. A different request hash is a visible conflict, not a
second object. A process death after PUT is recovered by a signed HEAD check of
immutable metadata; a mismatch is quarantined rather than overwritten.

The object key contains only a random value and media kind. It contains no
tenant, agent, filename, visit, GPS or document title. The application encrypts
bytes with AES-256-GCM before PUT, binds the ciphertext to the tenant/media row
as additional authenticated data, verifies SHA-256 and size after GET, and also
requests provider-side SSE plus Object Lock. The private Field bucket and IAM
credential must be distinct from `BACKUP_S3_*`/backup buckets. Required media
configuration is deliberately separate:

```text
MTM_MEDIA_S3_ENDPOINT / REGION / BUCKET
MTM_MEDIA_S3_ACCESS_KEY_ID / SECRET_ACCESS_KEY
MTM_MEDIA_ENCRYPTION_KEY_ID / ENCRYPTION_KEY_BASE64
MTM_MEDIA_OBJECT_RETENTION_DAYS / OBJECT_LOCK_MODE / OBJECT_LEGAL_HOLD
```

There is no fallback default for retention or legal hold. Operators must supply
an approved value before `s3` can activate. `MTM_MEDIA_ENCRYPTION_KEYRING_JSON`
may provide explicitly retained historic decryption keys during a key rotation;
the active key remains the only key used for new reservations.

Existing `/uploads/mtm-photos/*` URLs and document download endpoints keep
their authorization checks. If their DB row has attached object metadata, the
server reads/decrypts that object after authorization and **never** falls back
to `public/uploads` or `storageKey`. A missing/integrity-failed committed
object returns controlled recovery/availability responses instead of silently
serving a different local file.

Physical object purge is intentionally not implemented in this slice: an
object-backed photo delete returns `MTM_MEDIA_RETENTION_LOCKED` until the
approved retention/legal-hold purge procedure is delivered. This prevents a
user action from deleting encrypted evidence or leaving untracked bytes.

To roll back new media writes, disable the exact `media` cohort. Keep the M3
reader, private bucket and keyring available for already committed object rows;
do not deploy pre-M3 code, clear an outbox, or delete local/object data as part
of rollback.
