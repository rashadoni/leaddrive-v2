> Разведка 2026-10-13 для `docs/mtm-attendance/README.md`. Отчёт собран помощником-исследователем:
> пути и номера строк верны на эту дату, перед использованием сверяй с кодом. `<repo>` — корень репозитория.

# MTM attendance: map of what already exists

All paths are under `<repo>` (called ROOT below; every path is `ROOT/...`). Schema line numbers refer to `ROOT/prisma/schema.prisma`.

## Findings that change the plan

- **The dedicated workday endpoints are withdrawn too.** `/api/v1/mtm/mobile/workday`, `/api/v1/mtm/week/workday` and `/api/v2/mtm/mobile/sync/workforce` return 410 from the proxy. The only live HTTP writer of a workday is `POST /api/v1/mtm/mobile/sync/push` with `entity: "workdays"`.
- **Fake-GPS and device data reach the server and are dropped.** The workday parser accepts `attendance.location.isMock`, `provider`, a device enrollment and a Play Integrity token, but on the live path only a SHA-256 of them is kept.
- **The database guards the workday tables.** Events are append-only, workdays cannot be deleted, and a COMPLETED workday is immutable outside a correction ledger.
- **MTM has no branch/office entity.** The only site-with-geofence model is the withdrawn `WorkforceSite`.
- **Several manager views of workday detail are gated by the withdrawn capability**, so they are off for everyone today.

## 1. The live MTM workday

### Models and enums

`MtmWorkdayStatus` (5517): `STARTED | PAUSED | COMPLETED`.
`MtmWorkdayEventType` (5523): `START | PAUSE | RESUME | FINISH | REOPEN`. REOPEN is written only by a manager reopen; client parsers reject it.

`MtmAgentWorkday` (7637–7677, table `mtm_agent_workdays`):

| Column | Type | Note |
|---|---|---|
| `id` | String | Client-supplied on START (`data.id`) |
| `organizationId`, `agentId` | String | |
| `workDate` | Date | Organization-local date key stored as UTC midnight |
| `status` | enum | Default STARTED |
| `startedAt` | DateTime | Phone time (`occurredAt`) |
| `pausedAt`, `completedAt` | DateTime? | Phone time |
| `totalPausedSeconds` | Int | Default 0 |
| `startLatitude`, `startLongitude`, `endLatitude`, `endLongitude` | Float? | |
| `createdAt`, `updatedAt` | DateTime | |

- Unique: `[organizationId, agentId, workDate]` and `[organizationId, id]`.
- Indexes: `[organizationId, workDate]`, `[organizationId, agentId, status]`.
- One workday per agent per date. A second START on the same date conflicts with `MTM_WORKDAY_ALREADY_EXISTS`; a START while another day is open conflicts with `MTM_WORKDAY_ACTIVE`.

`MtmAgentWorkdayEvent` (7679–7733, table `mtm_agent_workday_events`):

| Column | Source |
|---|---|
| `id`, `organizationId`, `agentId`, `workdayId`, `type` | |
| `clientEventId` | Client; equals the sync `operationId` |
| `occurredAt`, `claimedAt` | Phone; must be equal |
| `capturedAt`, `queuedAt` | Phone |
| `serverReceivedAt`, `appliedAt` | Server only |
| `schemaVersion` | Client, 1–5, default 1 |
| `requestHash` | Server, SHA-256 of the request |
| `attendanceReviewState`, `attendanceReviewReasonCode` | Server-derived |
| `latitude`, `longitude`, `accuracy`, `note` | Client |
| `createdAt` | Server |

- Unique: `[organizationId, agentId, clientEventId]` and `[organizationId, id]`.
- Indexes on `(org, agent, occurredAt)`, `(org, agent, serverReceivedAt)`, `(org, agent, attendanceReviewState, serverReceivedAt)`, `(workdayId, occurredAt)`.

Other `*Workday*` models are Workforce-owned: `WorkforceWorkdayScheduleSnapshot` (8810) and `WorkforceWorkdayReopen` (8919). `MtmWorkCalendarDay` (5923) is the work calendar, not a workday.

### Database guards

Source: `ROOT/prisma/migrations/20260828224500_workforce_h3_legacy_fact_guard/migration.sql`.

- Trigger `workforce_workday_events_append_only` (lines 106–108) rejects UPDATE and DELETE on events. RLS policies exist for SELECT and INSERT only (136–145).
- Trigger `workforce_completed_workday_guard` (100–102):
  - DELETE on a workday is always rejected.
  - On an open row, `id`, `organizationId`, `agentId` and `workDate` are immutable.
  - On a COMPLETED row, only `status/startedAt/pausedAt/completedAt/totalPausedSeconds/updatedAt` may change, and only with a matching `workforce_time_corrections` row.
- The guard function was replaced in `20260828230000_workforce_direct_correction_contract` and referenced again in `20260915210100_workforce_workday_reopen_ledger`.

A new column on either table can therefore only be filled at INSERT time (or before FINISH for the workday row). Late-computed fraud signals need their own table.

### Writers

| Path | Status | Notes |
|---|---|---|
| `POST /api/v1/mtm/mobile/sync/push` | Live | `ROOT/src/app/api/v1/mtm/mobile/sync/push/route.ts`, POST at 407; workday validation 846–859; write branch 2989–3062 |
| `POST /api/v1/mtm/week/workday` | 410 | `ROOT/src/app/api/v1/mtm/week/workday/route.ts:157`; rejected new events older than 5 min (line 42, 257) |
| `GET /api/v1/mtm/mobile/workday` | 410 | `ROOT/src/app/api/v1/mtm/mobile/workday/route.ts:168`; read-only |
| `GET /api/v2/mtm/mobile/sync/workforce` | 410 | `ROOT/src/app/api/v2/mtm/mobile/sync/workforce/route.ts`; read-only. No v2 write route exists |
| `POST /api/v1/workforce/today/action` | 410 | Re-export of the week/workday POST |
| Demo pulse | Live, non-HTTP | `ROOT/src/lib/mtm/demo-pulse.ts:181–191` calls `applyMtmWorkdayEvent` for demo agents |
| Manager reopen, undo, direct time correction, request decision | 410 | `ROOT/src/lib/workforce/workday-reopen.ts:559,611`, `workday-reopen-undo.ts:344,372`, `direct-time-correction.ts:332`, `request-decision.ts:530` |

On the live sync path:
- Only the AGENT role can write a workday: the non-Workforce branch requires `FIELD_EXECUTE` (`canMutateRouteSyncOperation`, sync/push lines 397–405 and 731–739).
- Because `workforceHrm` is always false, `isRouteFieldSessionOperation` (227–234) is true and the `afterEvent` hook returns at line 2993. No Workforce verification, evidence, snapshot or audit row is written.
- There is no live web way to start, pause or finish a workday.

### Request body for a workday operation

Parser: `parseMtmWorkdayEvent`, `ROOT/src/lib/mtm/workday.ts:444–579`.

- **Envelope:** `operationId` (becomes `clientEventId`), `op: "create"`, `entity: "workdays"`, `data`, `clientTimestamp`. The body-level `clientId` ("stable device UUID for logging", comment at line 152) is never read.
- **`action`:** `START | PAUSE | RESUME | FINISH`.
- **`id` (START) or `workdayId` (others):** required.
- **`occurredAt`:** required, from the phone.
  - Rejected if more than 5 minutes ahead of the server (`MTM_WORKDAY_MAX_CLOCK_SKEW_MS`, line 142).
  - Rejected if more than 7 days old (`WORKFORCE_WORKDAY_OFFLINE_HORIZON_MS`, line 163).
- **`claimedAt`:** must equal `occurredAt`.
- **`capturedAt`, `queuedAt`:** `queuedAt` is required when `schemaVersion >= 2`.
- **`segmentId`:** needs `schemaVersion >= 3`.
- **`latitude` + `longitude`:** together or not at all. `accuracy` must be `>= 0`. `note` up to 500 characters.
- **`attendance.qrToken`, `attendance.device{enrollmentId, signature}`:** optional.
- **`attendance.location{capturedAt, provider, isMock}`:** needs `schemaVersion >= 4` plus coordinates and accuracy. `provider` is one of `FUSED|GPS|NETWORK|PASSIVE|UNKNOWN`.
- **`attendance.playIntegrity.token`:** needs `schemaVersion >= 5`.

Which `schemaVersion` the released Route Field app sends: **not found** (its source is not in this repo; only `ROOT/apps/workforce-android` is, and that is the withdrawn Workforce client).

### What is stored and what is dropped

- **Timestamps are the phone's.**
  - `workday.startedAt`, `pausedAt` and `completedAt` are set to `input.occurredAt` (`workday.ts:822, 898, 915`).
  - The server adds `serverReceivedAt` and `appliedAt` (770–771) on every event.
- **Clock-tamper raw data is already stored.**
  - `attendanceReviewState` becomes `PENDING_REVIEW` with reason `DELAYED_CLAIM` when the server received the event more than 15 minutes after the claimed time (`workforceAttendanceClaimReview`, 326–344; threshold at 178).
  - The review-case row (`WorkforceAttendanceReviewCase`) is skipped by the withdrawal check at line 636.
  - Events from before that migration are `LEGACY_UNKNOWN` with null provenance.
- **Coordinates and accuracy** are stored on every event. START copies them to `startLatitude/Longitude` (823–824); FINISH copies them to `endLatitude/Longitude` (917–918).
- **Dropped on the live path:** `isMock`, `provider`, `attendance.location.capturedAt`, the QR token, device enrollment id and signature, the Play Integrity token, `segmentId`. Only `requestHash` binds them (`mtmWorkdayRequestHash`, 591–628).
- **Never stored with a workday event:** device id, app version, user agent, IP. The `x-field-device-id` header is read in sync/push only for the Workforce write fence (lines 579, 974), which the live path skips.
- FINISH sets `MtmAgent.isOnline = false` in the same transaction (941–944).
- No server-side rejected-transition log was found. Conflicts return `riskCodes` (`DUPLICATE_ACTIVE_SHIFT_ATTEMPT`, `CLAIM_BEFORE_WORKDAY_START`, `CLAIM_PRECEDES_ACCEPTED_EVENT`, `CLAIM_BEFORE_REOPEN`, lines 9–14) in the response; the sync result, including them, is pinned in `MtmSyncOperation.result` (sync/push 3050, 3074–3084).

### Helpers

- **`ROOT/src/lib/mtm/workday.ts`** exports:
  - Types `MtmWorkdayAction`, `MtmWorkdayEventInput`, `MtmWorkdayResult`, `MtmWorkdayAttendanceEvidence`.
  - The constants cited above.
  - `recoveryActionsForMtmWorkday`, `recoveryForMtmWorkdayConflict`, `workforceAttendanceClaimReview`, `parseMtmWorkdayEvent`, `mtmWorkdayRequestHash`, `mtmWorkdayReplayMatches`.
  - `lockMtmWorkdayTransitions` (per-agent advisory lock, 713) and `applyMtmWorkdayEvent` (the single state machine, 720).
- **`ROOT/src/lib/mtm/workday-pauses.ts`** exports `MTM_WORKDAY_PAUSE_EVENT_TYPES`, `mtmWorkdayPauses`, `isDuringMtmWorkdayPause`, `serializeMtmWorkdayPauses`. This is the single reader of breaks.
- **`ROOT/src/lib/mtm/workday-break-summary.ts`** exports `mtmWorkdayBreakSummary`, returning count, minutes and ongoing.
- **`ROOT/src/lib/mtm/workday-open-anomaly.ts`** exports `MTM_WORKDAY_OPEN_ANOMALY_HOURS = 16`, `isMtmWorkdayLeftOpen`, `mtmManagerWorkdayState`.
- **`ROOT/src/lib/mtm/agent-day-state.ts`** exports `mtmAgentPresence`, `mtmAgentSilenceExplained`.

### Read surfaces

Live and ungated:
- `ROOT/src/app/api/v1/mtm/agents/route.ts:221–250` returns today's workday state and breaks per agent.
- `ROOT/src/app/api/v1/mtm/agent-period/route.ts:61–73` returns `startedAt`, `completedAt`, `totalPausedSeconds`.
- `ROOT/src/app/api/v1/mtm/locations/route.ts:325` returns workday state, date and start for the live map.
- `ROOT/src/app/api/v1/mtm/mobile/bootstrap/route.ts:394–413` returns the agent's own workday.

Gated by the withdrawn capability, so off for everyone:
- Live map `workdayPausedAt` and `workdayCompletedAt` (`locations/route.ts:480–481`).
- The workday block with start/end coordinates in `ROOT/src/app/api/v1/mtm/location-history/route.ts:181–197`.
- `ROOT/src/app/api/v1/mtm/week/route.ts:565,595` and `week/team/route.ts:164`.
- `ROOT/src/app/api/v1/mtm/kpi/route.ts:519` (the `gpsDays` drilldown).
- `ROOT/src/app/api/v1/mtm/locations/day-totals/route.ts:187–203`.

## 2. Device identity today

### Login, bootstrap, tokens

- **Login** (`ROOT/src/app/api/v1/mtm/mobile/auth/route.ts`):
  - The body is `{email, password, organizationSlug}` only (lines 43–55).
  - The JWT lasts 7 days and carries no device claim (393–406).
  - There is no refresh-token route and no session table (not found).
- **The only per-login device trace** is `MtmAuditLog` (9551): the `MOBILE_LOGIN` and `MOBILE_LOGIN_FAILED` rows (auth route 365–374, 299–308) store `ipAddress` and `userAgent` via `ROOT/src/lib/mtm-audit.ts:64–68`.
- **Bootstrap** (`ROOT/src/app/api/v1/mtm/mobile/bootstrap/route.ts:240`) reads `x-field-device-id` only to look up rollout cohorts. App version, build, platform and device class go to a console log with hashed ids (`ROOT/src/lib/mtm/mobile-sync-telemetry.ts`), not to the database.

### Tables with a device column

| Table | Device data | Written by | Use for "two agents, one phone" |
|---|---|---|---|
| `MtmDeviceToken` (6457) | `token`, `platform`, `deviceId?`, `appVersion?`, `lastSeenAt`, `disabledAt?` | `ROOT/src/app/api/v2/mtm/mobile/route-field/device-tokens/route.ts` (AGENT role only) | Weak. Unique on `[organizationId, token]`; the upsert overwrites `agentId` (66–87); sign-out deletes the row (122). It holds the current owner, not history. An older row for the same `deviceId` survives, disabled, only if the FCM token changed (89–99) |
| `MtmMobileRouteCommandReceipt` (9619) | `agentId`, `deviceId` (required), `createdAt`; index `(org, agent, device, createdAt)` | `ROOT/src/lib/mtm/mobile-route-command.ts:1205`, on `POST /api/v1/mtm/mobile/route-commands` | Best existing source. Kept 90 days (`ROOT/src/lib/mtm/mobile-route-command-receipt.ts:5`). Covers only agents who send route commands such as starting a route, not workday START |
| `MtmMobileSyncSnapshot` (9729), `MtmMobileSyncSnapshotLease` (9757) | `agentId`, `deviceId` | v2 sync routes | Short-lived; only devices enrolled in a v2 cohort |
| `MtmMobileSyncCohort` (9798) | `agentId`, `deviceId`, `stream`, `enabled` | Only `ROOT/src/lib/workforce/mobile-write-fence.ts:314–319,407` in code; runbooks under `ROOT/docs/mobile-sync-v2-*.md` mention it | Server-side enrollment, not observed usage |
| `MtmAgent.expoPushToken` (5773) | One Expo token | `ROOT/src/app/api/v1/mtm/agents/push-token/route.ts:54–57` | Legacy; never cleared on the previous agent |
| `WorkforceAttendanceDeviceEnrollment` (9038) | Public key and fingerprint | Withdrawn routes | Switched off |

### Location uploads

`MtmAgentLocation` (9401) columns: `workdayId?`, `clientLocationId?`, `payloadSha256?`, `latitude`, `longitude`, `accuracy?`, `speed?`, `heading?`, `altitude?`, `battery?`, `isMoving`, `recordedAt`. There is no `isMock`, `provider`, `deviceId` or `appVersion` column.

- `POST /api/v1/mtm/mobile/location` (`ROOT/src/app/api/v1/mtm/mobile/location/route.ts:93`) accepts exactly those metrics plus `mode`.
- `POST /api/v2/mtm/mobile/location/batch` (`ROOT/src/app/api/v2/mtm/mobile/location/batch/route.ts:365`) requires `x-field-device-id` (384–388). It uses it for the cohort check and rate limit, and does not store it.
- Raw points are deleted after 30 days (`ROOT/src/app/api/cron/mtm-cleanup/route.ts:9`). Workday start/end coordinates are not purged by any live job.

### Mock location

- The only live endpoint that acts on `isMock` is the "customer is here" request: `ROOT/src/app/api/v2/mtm/mobile/route-field/organizations/[id]/location-request/route.ts:48`. It refuses via `ROOT/src/lib/mtm/customer-location-request.ts:93` and stores no flag.
- `ROOT/src/components/mtm/live-map-agent-device.tsx:66–67` states that no phone reports a mocked location, GPS-off, OS version or model to the server.
- `MtmAlertType` (5550) contains `GPS_SPOOFING`, `GPS_ANOMALY`, `LATE_START` and `OVERTIME`, but no code creates them. Only `OUT_OF_ZONE` and `LONG_BREAK` are generated.
- The comment at `ROOT/src/lib/mtm-settings.ts:27–31` records that the decorative `alertGpsSpoofing` and `alertLateStart` settings were removed.

### Verdict

"Two agents on one device" cannot be detected reliably from stored data.
- Partial sources are `MtmMobileRouteCommandReceipt` (90 days, route commands only) and `MtmAuditLog` login rows (IP and user agent, which are not a device id).
- Whether the released Route Field app sends `x-field-device-id` on sync/push, or `deviceId` on token registration: **not found**.

## 3. The withdrawn Workforce/HRM module

### How the withdrawal is enforced

Single source: `ROOT/src/lib/crm-product-availability.ts`.
- `withdrawnCapabilities` (lines 6–10) is `workforce-hrm`, `attendance-qr`, `attendance-device-trust`.
- `isCrmCapabilityAvailable` (12) returns false for those.
- `isWithdrawnCrmPath` (30) matches these prefixes (16–28): `/workforce`, `/api/v1/workforce`, `/api/v1/mtm/mobile/hrm`, `/api/v1/mtm/mobile/attendance`, `/api/v1/mtm/mobile/workday`, `/api/v1/mtm/week/workday`, `/api/v1/mtm/work-calendar`, `/api/v1/mtm/operations/hrm`, `/api/v2/mtm/mobile/sync/workforce`, `/api/cron/workforce-no-show-review`, and the three marketplace demo pages.

Callers:
- `ROOT/src/proxy.ts:396` runs before every bypass branch: 404 for UI paths, 410 `CRM_MODULE_UNAVAILABLE` for API paths.
- `ROOT/src/lib/tenant-capabilities.ts:238` makes `isTenantCapabilityEnabled` AND the availability check with the stored entitlement. Line 560 filters the catalog.
- `ROOT/src/lib/tenant-capability-access.ts:23`.
- `ROOT/src/lib/mobile-auth.ts:182–200` therefore resolves `workforceHrm`, `attendanceQr` and `attendanceDeviceTrust` to false on every request.
- `ROOT/src/lib/with-mobile-rls.ts:47–52`.
- `ROOT/src/app/(dashboard)/workforce/layout.tsx` calls `notFound()`.
- `ROOT/src/lib/mtm/workday.ts:636` skips review cases.
- `ROOT/src/lib/tenant-provisioning-v2.ts:184` and `ROOT/src/app/api/v1/admin/tenants/[id]/capabilities/route.ts:223` block provisioning and re-activation.
- UI filters in `ROOT/src/lib/admin-sidebar-catalog.ts:155`, `ROOT/src/app/(dashboard)/settings/roles/page.tsx:47`, `settings/users/page.tsx:220`, `marketplace/demo/[id]/page.tsx:13`.

Pinned by `ROOT/src/__tests__/crm-workforce-withdrawal.test.ts`. The decision is in `ROOT/docs/hrm-crm-withdrawal-session-log-2026-10-10.md`: hide and close access, keep code, rows, migrations and roles, no destructive cleanup, and re-enabling needs a reviewed release.

### Is anything live still writing these tables?

No live writer of any `Workforce*` table was found.
- Their route handlers sit behind withdrawn prefixes.
- The sync/push hook returns early.
- The review-case insert is skipped.
- Bootstrap's attendance manifest returns "disabled" (`bootstrap/route.ts:98`).
- The raw-location retention job (`ROOT/src/lib/workforce/raw-location-retention.ts`) is only reachable through `/api/v1/workforce/retention/raw-location`.

Still live: the two shared `Mtm*` workday tables, and the three `Workforce*`-named DB triggers on them.

### Attendance-related models

| Model (line) | Purpose | Key columns |
|---|---|---|
| `WorkforceSite` (8227) | Tenant work location, unrelated to route customers | `code` (unique per org), `name`, `type` (`OFFICE/WAREHOUSE/TEMPORARY/CUSTOMER/HOME_REMOTE`), `timezone`, `addressLabel`, `responsibleTeamId` → MtmTeam, `status`, `archivedAt` |
| `WorkforceSiteGeofenceRevision` (8330) | Immutable versioned geofence of a site; circle only | `siteId`, `revision`, `centerLatitude`, `centerLongitude`, `radiusMeters`, `calibrationReference`, `definitionHash`, `effectiveFrom/To` |
| `WorkforceSiteAssignment` (8361) | Effective-dated employee-to-site eligibility | `agentId`, `siteId`, `kind` (`PRIMARY/SECONDARY/TEMPORARY`), `effectiveFrom/To` |
| `WorkforceSiteAssignmentBulkOperation` (8387) | Receipt of a bulk assignment publish | `operationId`, `requestHash`, `siteId`, counts |
| `WorkforceShiftSegment` (8507) | Planned slice of a shift | `templateId`, `sequence`, `mode` (`SITE/REMOTE/FIELD/TRAVEL/ON_CALL/EXCEPTION`), `siteId?`, `startTime`, `endTime`, `lateGraceSeconds`, `proofPolicyReference` |
| `WorkforceSiteTransition` (8538) | Append-only arrival/departure claim for a segment; no coordinates | `workdayId`, `segmentId`, `kind`, `clientTransitionId`, `claimedAt/capturedAt/queuedAt/serverReceivedAt/appliedAt`, `requestHash`, review state |
| `WorkforceAttendanceQrStation` (8993) | Physical QR display; the rotating QR is never stored | `code`, `name`, `status`, `rotationSeconds` (60), `siteId?`, `areaLabel`, `geofenceRevisionId?`, `effectiveFrom/To` |
| `WorkforceAttendanceDeviceEnrollment` (9038) | Approved device public key per employee | `agentId`, `deviceLabel`, `publicKeySpki`, `publicKeyFingerprint` (unique per org), attestation fields, `status` (`PENDING/ACTIVE/REVOKED/REPLACED`), approve/revoke fields, `replacesEnrollmentId` |
| `WorkforceAttendanceDeviceEnrollmentChallenge` (9082), `...AttestationChallenge` (9102) | One-time challenges | `challengeFingerprint`, `expiresAt`, `consumedAt` |
| `WorkforceAttendanceVerification` (9122) | Proof ledger per workday event | `workdayEventId`, `policyId/Version/DefinitionHash`, `method` (`QR/DEVICE_KEY/PLAY_INTEGRITY`), `stationId?`, `deviceEnrollmentId?`, `nonceFingerprint`, `proofFingerprint`, `verifiedAt` |
| `WorkforceAttendanceEvidence` (9157) | Encrypted raw evidence for one event or transition | `workdayEventId?`, `siteTransitionId?`, `source` (`LOCATION/QR/DEVICE/KIOSK/MANUAL`), `capturedAt`, `payloadHash`, `redactedReceipt`, `rawEnvelopeCiphertext`, `rawExpiresAt`, `rawPurgedAt` |
| `WorkforceEvidenceAssessment` (9192) | Derived verdict without coordinates | `evidenceId`, `kind` (`GEOFENCE/LOCATION_QUALITY/PROOF_POLICY`), `verdict` (`INSIDE/OUTSIDE/UNKNOWN/ELIGIBLE/REVIEW_REQUIRED/UNAVAILABLE/SATISFIED`), `reasonCodes`, `geofenceRevisionId`, `distanceMeters`, `accuracyMeters` |
| `WorkforceAttendanceReviewCase` (7738) | Review queue for delayed claims | `workdayEventId` (unique per org), `status`, `reasonCode`, `claimAgeSeconds`, `claimedAt`, `serverReceivedAt` |
| `WorkforceExceptionCase` (7768) with decision, response and policy-revision models (7812–7873) | Exception case envelope and ledger | `kind`, `detectorVersion`, `deduplicationKey`, `workdayId?`, `workdayEventId?`, `evidenceId?`, `segmentId?`, `expectedWorkDate?` |
| `WorkforceAttendanceException` (8842) | Computed deviation | `type` (`LATE_START/UNDERTIME/OVERTIME/LONG_PAUSE`), `valueSeconds`, `thresholdSeconds`, `excessSeconds`, `status` |
| `WorkforcePolicySnapshot` (8735), `WorkforceShiftSnapshot` (8769), `WorkforceWorkdayScheduleSnapshot` (8810) | Immutable per-workday policy, shift and schedule/site context | `expectedWorkSeconds`, `lateGraceSeconds`, `plannedStartAt/EndAt`, `segments`, `sites` JSON |
| `WorkforceTimeCorrection` (8879), `WorkforceWorkdayReopen` (8919) | Append-only correction and reopen ledgers | `operationId`, `requestHash`, `actorUserId`, `reason`, `beforeFacts`, `afterFacts` |
| `WorkforceTimesheetApproval` (8952) | Immutable approved timesheet period with revisions | `agentId`, `periodStart/End`, `recordKind`, `revision`, `rows` JSON, hashes, `approvedByUserId` |
| `WorkforceMobileWriteFence` (9248) | Per-tenant mobile write mode | `mode` (`LEGACY_ALLOWED/COHORT_ONLY/FROZEN`) |

### Dormant logic under `ROOT/src/lib/workforce/`

- `location-evidence-policy.ts`: `assessWorkforceLocationEvidence`, with reason codes including `LOCATION_MOCK_SUSPECTED`, `LOCATION_STALE`, `LOCATION_ACCURACY_EXCEEDED`, `LOCATION_FUTURE_TIMESTAMP`.
- `geofence-evaluation.ts`: `evaluateWorkforceSnapshottedGeofence`, returning INSIDE, OUTSIDE or UNKNOWN.
- `attendance-risk-signals.ts`: `CLOCK_FUTURE_SKEW`, `CAPTURE_AFTER_CLAIM`, `IMPOSSIBLE_SITE_TRANSITION` (over 180 km/h).
- `attendance-security-triage.ts`: `MULTIPLE_TRUSTED_DEVICES_USED`, `RAPID_DEVICE_ENROLLMENT_CHURN`, `ABNORMAL_ATTENDANCE_ACTION_VOLUME`. These are per agent; a device-shared-by-several-agents signal is not there.
- `attendance-security.ts`, `attendance-trust.ts`, `site-management.ts`, `play-integrity.ts`, `android-key-attestation.ts`.

## 4. Branches and offices in MTM

MTM has no office, branch, site, depot or warehouse entity with coordinates.

- `MtmRegion` (5682): `name`, `code`, `description`, `isActive`. No coordinates.
- `MtmTeam` (5703): `regionId`, `name`, `code`, `isActive`. No coordinates or address. The supervisor is not stored on the team; agents carry `teamId` and `managerId`.
- `MtmAgent` (5735): `teamId`, `managerId`. No home branch.
- `MtmMapZone` (6488, the live-map "own zones"):
  - Columns: `name`, `kind` (`CIRCLE | POLYGON`, as a string with DB checks), `color` (palette key), `centerLatitude`, `centerLongitude`, `radiusMeters`, `polygon` (GeoJSON, one ring), `createdBy`, `deletedAt` (soft delete).
  - The schema comment (6481–6487) and `ROOT/src/lib/mtm/live-map-zones.ts:11–12` say it is a drawing only and nothing computes whether an employee is inside one.
  - API: `/api/v1/mtm/locations/zones` and `/[id]`. Administrators and managers write, supervisors read, agents get nothing (`ROOT/src/lib/mtm/map-zone-access.ts`). Limit of 500 zones.
- `MtmCustomer` (5969) is the only MTM entity with a pin and geofence (`latitude`, `longitude`, `geofenceRadius`, `objectType` `PHARMACY/CLINIC/DOCTOR/STORE/OTHER`), and it is a customer.
- `MtmSetting` (9476) has no office coordinates; `geofenceRadius` in the defaults is the customer check-in radius.
- `Warehouse` (12604, the inventory module) has `code`, `name`, `address` and no coordinates.

Candidates for "the branch where the employee checked in":
- A new MTM table.
- A typed reuse of `MtmMapZone`, which today has no type or flag distinguishing a branch from a drawing.
- The withdrawn `WorkforceSite` + `WorkforceSiteGeofenceRevision` + `WorkforceSiteAssignment`.

Reusable geometry: `calculateDistance` in `ROOT/src/lib/geo-utils.ts:5`; `placeCheck` in `ROOT/src/lib/mtm/visit-place-check.ts:56`; `clampCheckInGeofenceRadius` in `ROOT/src/lib/mtm/check-in-geofence.ts:28`; `normalizeMtmCoordinates` and `hasMtmCoordinates` in `ROOT/src/lib/mtm/geo-coordinates.ts`.

## 5. Feature switches, permission matrix, navigation

### Per-organization switch

`MTM_SETTING_DEFAULTS` is in `ROOT/src/lib/mtm-settings.ts:32`, not under `src/lib/mtm/`. Values are stored as `MtmSetting(organizationId, key, value Json)` rows.

- **Reading:** `getMtmSettings(orgId)` (241) merges rows over defaults and coerces by the default's type. Single-key reads inside transactions use `coerceMtmBooleanSetting` from `ROOT/src/lib/mtm/setting-values.ts`.
- **Adding a switch:**
  1. Add a key to `MTM_SETTING_DEFAULTS` with the pre-existing behaviour as default. The header comment (27–31) requires every key to be read somewhere.
  2. `ROOT/src/app/api/v1/mtm/settings/route.ts` PUT (44) whitelists to those keys (61) and type-checks booleans via `validateMtmSettingChanges`. For administrator-only, add the key to `MODULE_TOGGLE_KEYS` (20) or `ADVANCED_KEYS` (23).
  3. Add a row to `settingGroups` in `ROOT/src/app/(dashboard)/mtm/settings/page.tsx:370` (`{ key, labelKey, hintKey, type: "boolean", adminOnly? }`), with texts in the `mtmSettingsPage` namespace of all three files in `ROOT/messages`.
  4. To also hide a menu entry, add the key to `NAV_ORG_SETTING_KEYS` (`ROOT/src/lib/nav-items.ts:109`) and set `orgSetting` on the nav item.
  5. The field app receives policies from bootstrap `data.policies` (`bootstrap/route.ts:460–503`).
- Existing tests to follow: `ROOT/src/__tests__/mtm-settings-tabs-ui.test.ts`, `mtm-settings-safe-save.test.ts`, `mtm-field-contacts-toggle.test.ts`, `mtm-pharmacy-promotions-toggle.test.ts`.

### Agent permission matrix

File: `ROOT/src/lib/mtm/agent-permissions.ts`.

- Groups (24): `workday, routes, visits, clients, tasks, team`.
- `AGENT_PERMISSION_ROWS` (76) holds rows of kind `always`, `never`, `perAgent` (with `cardFlag`), or `switch`.
- A switch row is declared as `{ id, group, kind: "switch", setting: <key>, surfaces: ["app" | "web"], requires?: <key> }`. Its `setting` must be listed in `AGENT_PERMISSION_SETTING_KEYS` (30), and in `AGENT_PERMISSION_ADMIN_ONLY_KEYS` (52) if only an administrator may change it.
- Enforcement: `agentPermissionEnabled(settings, id)` (174) and `agentPermissionDeniedBody(id)`, giving 403 `MTM_AGENT_PERMISSION_DISABLED` (161).
- The app gets all switches as `policies.agentPermissions` via `agentPermissionStates` (181).
- Existing workday rows (78–81): `workdayOwn` (always), `locationShare` (always), `locationHistoryOwn` (always), `locationTeam` (never).
- `ROOT/src/__tests__/lib-mtm-agent-permissions.test.ts`:
  - Every always/never row needs a `FACTS` entry (125).
  - Every switch row needs an entry in the "refused by its endpoint" table (228–236).
  - The `workdayOwn` fact (126–130) is pinned to a source line in the withdrawn `week/workday/route.ts`.
- UI: `ROOT/src/components/mtm/agent-permission-matrix.tsx`, on `/mtm/access`.

### Navigation

- `ROOT/src/lib/mtm/navigation.ts` holds `MTM_PRIMARY_NAVIGATION` (61, six pills) and `MTM_TOOL_GROUPS` (75), the list behind the "Bütün MTM alətləri" popover (`ROOT/messages/az.json:664`, key `mtmModuleNavigation.allTools`). Groups are `work, reference, control, analytics, administration`.
- A tool item is `{ href, icon, navKey, orgSetting?, adminOnly? }`. `navKey` is a key in the `nav` namespace.
- Rendered by `ROOT/src/components/mtm/mtm-module-navigation.tsx`.
- A new page must also be added to `navItems` in `ROOT/src/lib/nav-items.ts` (MTM block 332–354, shape `{ module: "mtm", tenantCapability: "route-field", href, icon, tKey, group: "Route & Field" }`).
- `ROOT/src/__tests__/mtm-module-navigation.test.ts` requires both lists to contain the same hrefs exactly once, pins the tool count at 14 (line 54), and pins the exact group contents (58–66). Adding "Attendance" means updating those assertions.

## 6. Existing per-agent, per-day reports

- **Closest in content: the agent period view.**
  - `ROOT/src/components/mtm/agent-period-view.tsx` (`MtmAgentPeriodView`, 54), mounted on `ROOT/src/app/(dashboard)/mtm/routes/page.tsx:1264`.
  - Backed by `GET /api/v1/mtm/agent-period?agentId=&from=&to=` (`ROOT/src/app/api/v1/mtm/agent-period/route.ts`) and `ROOT/src/lib/mtm/agent-period.ts` (`buildAgentPeriod`, `AGENT_PERIOD_MAX_DAYS = 31`).
  - One row per day with shift start and end, a `carriedOver` flag, field seconds, visits, first and last GPS fix, distance, and a status (`FULL/PARTIAL/NOT_WORKED/UNPLANNED/DAY_OFF/UPCOMING/SHIFT_OPEN/GPS_ONLY`).
  - It covers one agent at a time, has no export, and returns no workday coordinates.
- **Closest in mechanics: `/mtm/reports`.**
  - `ROOT/src/app/(dashboard)/mtm/reports/page.tsx` is driven by `ROOT/src/lib/mtm/report-config.tsx` (`REPORTS`, `REPORT_TYPES`, column kinds `text/status/role/number/percent/minutes/date`).
  - A new card needs a config entry plus an API returning `{summary, series, reportData, total}`.
  - `route_execution` is a per-agent, per-date row set with team and region (`ROOT/src/app/api/v1/mtm/management-reports/route.ts`).
  - Two export paths in `exportReport` (page line 97):
    - Server-side xlsx for management reports: `?format=xlsx` builds a workbook with `buildXlsxWorkbook` (route 180–188).
    - Client-side CSV for the base reports, built from the loaded rows.
- **Excel helpers:**
  - `ROOT/src/lib/export/tabular.ts`: `buildXlsxWorkbook` (41), `toCsv` (33), `contentDispositionAttachment` (60).
  - `ROOT/src/lib/mtm/excel-contract.ts`: `protectMtmExcelText` (152, formula-injection guard), `mtmExcelAttachment` (344).
- **Other export patterns:**
  - Typed server exports: `GET /api/v1/mtm/excel/exports/[type]` using `buildMtmExcelExport` (`ROOT/src/lib/mtm/excel-export.ts:52`; types `CUSTOMERS, ROUTES, SALES_FACTS, VISIT_RESULTS, PLAN_FACT, CUSTOMER_REQUESTS`).
  - Screen-as-file: `POST /api/v1/mtm/locations/export` turns a table built in the browser by `ROOT/src/lib/mtm/live-map-roster-export.ts` into xlsx.
  - `GET /api/v1/mtm/analytics/export` (ExcelJS directly) and `GET /api/v1/mtm/kpi/export` (CSV).
- **Access scoping used by all of them:** `resolveMtmRouteActor` with `scopedAgentIds`, or `resolveMtmFieldScope` with `fieldScopeAgentIdWhere`, behind `withRouteFieldWebRlsAuth`.
- **Per-agent today view with breaks:** `ROOT/src/app/(dashboard)/mtm/agents/page.tsx:314`, fed by `agents/route.ts:221–250`.

## 7. CLAUDE.md constraints

`ROOT/CLAUDE.md`, section "MTM: координаты за перерыв не пишутся" (463–498):

- A break is the employee's personal time (owner's rule). Where it was spent is neither recorded nor shown to anyone.
- All three location writers refuse or drop a point captured during a break:
  - `POST /api/v1/mtm/mobile/location` returns `MTM_LOCATION_WORKDAY_PAUSED` (`mobile/location/route.ts:224`).
  - `POST /api/v2/mtm/mobile/location/batch` drops the point and names it in `pausedClientLocationIds` (`batch/route.ts:460–468`).
  - `POST /api/v1/mtm/locations` (web and API key) has refused since 2026-10-12 (`locations/route.ts:703–724`).
- The public share link is guarded separately in `ROOT/src/lib/mtm/location-share-link-position.ts`.
- `workday-pauses.ts` is the only reader that decides what a break is. A second journal parser must not be written.
- The first and last second of a break count as work; the capture moment decides, not the shift status at upload.
- Any new write path into `mtm_agent_locations` must ask that reader first and add a case to `ROOT/src/__tests__/mtm-mobile-location-break-postgres.test.ts`, which is a gate in `static-checks` and deploy.
- One deliberate exemption: a manager's own `mode: "SELF_SHARE"` point. It was a session proposal the owner did not object to; it is not a formal decision.
- The server only refuses for a break already in the journal. Coordinates sent before the PAUSE event arrives are stored.

Consequence for attendance: PAUSE and RESUME events already store `latitude`, `longitude` and `accuracy` at the boundary instants, which the rule counts as work. Any position between them must not be stored, shown or exported.

The preceding section (443–461), "MTM: что может агент", adds:
- A new agent function needs a row in the matrix.
- A new switch needs a key in `MTM_SETTING_DEFAULTS`, a check in the route, and a test for both the refusal and that nothing was created.
- An always/never row needs a `FACTS` entry.
- The agent-cannot-edit-clients rule must not become a switch.

## Summary

### Can be reused as is

- `MtmAgentWorkday` and `MtmAgentWorkdayEvent`: start, finish and pause times, coordinates and accuracy per event, and the phone-versus-server timestamp pair.
- The state machine and its lock (`applyMtmWorkdayEvent`, `lockMtmWorkdayTransitions`) and the parser.
- The break reader (`workday-pauses.ts`), break summary, left-open detection and `mtmAgentPresence`.
- `attendanceReviewState = PENDING_REVIEW / DELAYED_CLAIM` on events, as a stored late-sync signal.
- Geometry helpers: `calculateDistance`, `placeCheck`, `clampCheckInGeofenceRadius`, the coordinate normalizers.
- Settings plumbing, the agent permission matrix, MTM navigation, and the scoping helpers.
- `/mtm/reports` with `report-config.tsx`, `buildXlsxWorkbook` and `protectMtmExcelText`; `agent-period.ts` for per-day verdicts.
- `MtmAlert` with unused enum values `GPS_SPOOFING`, `GPS_ANOMALY`, `LATE_START`, `OVERTIME`, plus the alerts page.
- `MtmAuditLog` login rows (IP, user agent) and `MtmMobileRouteCommandReceipt` (agent and device pairs, 90 days) as partial device evidence.

### Exists but is switched off

- Sites and geofences: `WorkforceSite`, `WorkforceSiteGeofenceRevision`, `WorkforceSiteAssignment`, with `site-management.ts` and `geofence-evaluation.ts`.
- QR stations, device enrollment with key attestation, Play Integrity, the verification ledger, encrypted evidence and assessments.
- Mock-location and location-quality assessment, risk signals for clock skew and impossible transitions, and per-agent device triage.
- Review cases, exception cases, late/undertime/overtime/long-pause exceptions, policy and shift snapshots, time corrections, manager reopen, timesheets.
- The dedicated workday endpoints, the web workday action, and the work-calendar API.
- Manager views of workday detail: pause and finish times on the live map, the workday block with start/end coordinates in location history, the week and team-today workday data, and the KPI `gpsDays` drilldown.
- Persistence of `attendance.location.isMock` and `provider`, device proof and `segmentId` from workday events.
- The Android client in `ROOT/apps/workforce-android`, which captures `isMock`.

### Does not exist at all

- An MTM branch or office entity with coordinates, and any agent-to-branch link.
- Any computation of which branch or zone a workday START or FINISH fell in, or its distance from one.
- A device identifier stored with workday events or with GPS points, and a device id at login.
- Detection of several agents on one device.
- `isMock` or `provider` on `mtm_agent_locations`, and any generated `GPS_SPOOFING` alert.
- A persisted clock-tamper flag beyond the delayed-claim state, and any uptime or monotonic-clock evidence from the phone.
- A live web or manager action on a workday (start, finish, reopen, correct).
- A multi-agent, per-day attendance report with export, or an "Attendance" page or nav entry.
- A workday for non-AGENT roles: managers and supervisors cannot write one through the live path.
- The Route Field app source in this repository, so what it actually sends (schema version, device id header, any mock flag) could not be verified.
