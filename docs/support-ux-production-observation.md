# Support UX production observation and final admission

Status: **RELEASE VERIFIED; OWNER TEST TENANT SELECTED; FLAG OFF; ACTIVATION UNVERIFIED**.
Owner: `@rashadoni`. Reviewed: 2026-10-03, Asia/Baku.

This is the execution record for `SUPUX-ROL-006` and the outstanding literal
acceptance measurements in the [implementation plan](support-module-ux-redesign-implementation-plan.md#25-acceptance-matrix).
The [release ledger](support-ux-performance-and-rollout.md#release-ledger)
closes `SUPUX-ROL-005`. Completed releases and matrices are reused as recorded
evidence; this protocol does not require repeating them.

## Admission before starting the clock

| Required fact | Current evidence / action |
| --- | --- |
| Representative authorized production tenant | Owner selected his production test tenant `leaddrive` / LeadDrive Inc. through the coordinator. This resolves selection; actual representative activity still needs evidence. Controlled test traffic remains labeled as such and is not an isolated CI fixture or proof of natural usage |
| Current production route | `rashadoni/leaddrive-v2`, protected `main`, GitHub Actions, `13.140.132.245:/opt/leaddrive-v2`; public app `https://app.leaddrivecrm.org` |
| Last verified production snapshot | Runtime `022c4a453e80f58e13d71e5808354d12daeb65aa`, independently observed after another task's automatic deploy `37141070643` SUCCESS; ping200/oktrue and build-info200/exact full SHA, both no-store, at `2026-10-03 22:21:05` (Asia/Baku). This task did not dispatch or repeat that deploy. Earlier source-identity comparisons and runtime receipts remain dated evidence |
| Authenticated flag state | Coordinator's normal selected-tenant Chrome request reports `/api/v1/support/ux-rollout` HTTP200 with explicit `enabled:false`; Macros DOM reports browser storage. This corroborates protected metadata. Root has no authenticated browser access. Exact request timestamp/cache header was not supplied; any mutation still needs fresh reads |
| Audited activation | NOT PERFORMED. Coordinator's selected-tenant `support_ux_canary` audit read reports success with total0/logs[]. No earlier activation or observation is inferred. A future action needs actor/source/before-after state, a trusted receipt and a fresh authenticated state read |
| Safe operator path | PR #544 delivered the fixed-flag atomic superadmin operator described below, with protected/PG/release/public-SHA admission complete. PR #530's protected read-only `support-ux-rollout` run37143634459 SUCCESS reports selected `leaddrive` active, flag false, native feature array, four macros and zero stored categories at18:17:48UTC. It performed no activation and does not replace authenticated flag/audit reads. Direct SSH was rejected at its dated check |
| Permissions and rollback | Verify selected administrator/manager permissions and tenant fences. Preserve all unrelated features and existing macro/category data. Removing the tenant flag restores browser mode while retaining DB categories |
| Error and latency baseline | Actual selected-tenant baseline PENDING. PR #530 released unsampled category-handler instrumentation and the reviewed-main bounded read-only daily collector. Effective logging, selected-tenant collection and daily coverage remain UNVERIFIED/NOT RUN. Generic Sentry configuration, endpoint RTT and a short PM2 tail are insufficient |
| Baseline validity | Fresh bounded current-source48-cell seven-sample capture/comparison and independent PNG/quantile review are complete; see the dated review in the rollout contract. Existing ceilings/2026-10-08 boundary remain, original96 dimensions are not replaced or extended, and real handler baseline is still PENDING. Broader validity requires review before final admission; do not increase a ceiling to fit a slow candidate |

The relevant persisted-state boundary is Macros custom-category storage. The
redesign's presentation and previously shipped navigation do not become a new
tenant canary merely because this flag is present.

Activation changes only the selected tenant's `support_ux_v2_canary` admission
flag through an audited transaction. It must preserve the existing feature
representation and unrelated flags. Record an idempotent already-enabled
result without inventing an earlier activation timestamp. Re-read authenticated
state after activation. No other tenant, category, macro, permission, billing
setting or customer message changes as an incidental action.

Independent operator release (2026-10-03): a dedicated superadmin
`POST /api/v1/admin/tenants/[id]/support-ux-canary` was delivered in
[PR #544](https://github.com/rashadoni/leaddrive-v2/pull/544). Strict
input binds the tenant slug/id, desired and expected flag states and compiled
artifact SHA. The serialized, row-locked transaction changes only features
and writes the actor/old-new state/SHA audit through its transaction client;
audit failure must roll back the flag. Native arrays and encoded arrays retain
their representation and every unrelated entry; unsupported state fails closed.
Confirming an existing state writes a separately named confirmation and does
not establish an earlier activation time. Receipt issuance after commit is
separate from the required authenticated flag re-read. Preparation/unit checks
do not authorize selecting or activating an arbitrary production tenant.
Final protected admission and production release are complete on merge
`3294093a4364be8be35d8a03c1b9fde57c3dd3b9`: real PostgreSQL 10/10, full
compiler with both unchanged blockers, standalone build and automatic deploy
passed. Independent public ping/build-info matched the exact merge SHA;
unauthenticated operator POST returned 401. These results admit the delivered
source, not a selected tenant, authenticated activation or observation day.

The action accepts only these four keys. This is an intentionally unusable
template until an authorized exact tenant and current public artifact are
supplied; credentials and actual tenant payloads do not belong in this document.

```json
{
  "tenantSlug": "<exact-authorized-slug>",
  "enabled": true,
  "expectedEnabled": false,
  "expectedArtifactSha": "<full-current-public-artifact-sha>"
}
```

Use the selected organization's exact ID in the path. First retain the approved
tenant identity and a rollout read using a session authorized for that selected
tenant. The superadmin mutation uses the ID in its path, while rollout/audit
GETs scope reads to the caller's organization; the operator's own-organization
session alone cannot verify a different tenant. After a successful write retain
the receipt's audit ID, actor-bound audit/source and UTC issuance time, then
independently re-read authenticated rollout state. An existing enabled state
uses `enabled: true` and `expectedEnabled: true` and records confirmation only.
Rollback uses `enabled: false` with the observed expected state and current
artifact; it retains saved categories and unrelated entitlements.

A 409 state/source conflict requires fresh reads and an explicit decision,
never automatic retry. Unsupported features or inactive enabling require a
separate resolution; do not fall back to the generic tenant update. If a
response is lost or fails, re-read flag and audit before deciding what happened;
a client transport error alone cannot prove rollback or commit. An audit
INSERT failure inside the transaction is covered by the real PostgreSQL gate.

The database audit creation timestamp can precede commit while the row lock is
held. Neither it nor the receipt's later issuance timestamp proves the exact
commit instant. For a fresh activation use the retained post-commit receipt
and authenticated re-read as a conservative verified admission bound. Do not
count a midnight exception from audit creation time alone; if that boundary
is uncertain, start with the next full Asia/Baku day after verified admission.

The generic audit POST reserves `support_ux_canary` for trusted server writes,
including enable, disable and confirmation. The new reservation does not
authenticate older records: a historical entry of unknown origin remains
UNVERIFIED. Admit new evidence only with the reviewed reservation release,
operator receipt/matching audit and selected-tenant state reads. Confirmation
does not establish an earlier activation or recover missing observation days.

## Seven full calendar days

Use Asia/Baku calendar boundaries and retain UTC timestamps. The partial
activation day does not count. The first full day begins at the next local
midnight, unless activation was exactly at midnight; earliest admission is
midnight after seven complete, evidenced days. For example, activation during
2026-10-02 would make 2026-10-03 through 2026-10-09 the seven full days, with
earliest admission 2026-10-10T00:00:00+04:00. This is an example, not an actual
activation or committed completion date.

Elapsed wall-clock time is necessary but insufficient. Each day needs actual
selected-tenant activity, source/flag identity and supported error/latency
evidence. Missing coverage, an unexplained admission change, or an unresolved
P0/P1 incident prevents final admission. Record the gap and recovery; do not
fill it with synthetic fixture results or rewrite earlier entries.

| Full local day | Artifact/source and flag | Relevant activity / sample coverage | Error and latency evidence | Incident / decision | Immutable reference |
| --- | --- | --- | --- | --- | --- |
| Not started / verified | PENDING selected tenant and activation record | PENDING | PENDING | No longitudinal conclusion | PENDING |

For each day, append a dated receipt with:

- Tenant slug and observation day; no customer names, raw payloads, passwords,
  tokens, private keys or authentication cookies.
- Exact artifact SHA and explicit flag state. Note intervening source changes
  and their relevance to the admitted boundary; do not silently reset history.
- Actual category-use coverage and error numerator/denominator from the
  approved telemetry source. Distinguish no traffic, missing data and zero
  observed failures.
- Matched metric definitions and p50/p75 latency with sample count and scope.
  Public ping RTT, isolated page-load p75 and real tenant API/page measurements
  are different metrics and must retain those labels.
- P0/P1 incident review and the resulting retain/rollback decision. An empty
  bounded log tail does not establish a complete zero-incident history.
- Accountable owner and durable run/report reference. Future checks should
  notify on meaningful changes, failure or required action; they should not
  produce repetitive unchanged status messages.

If reliable tenant telemetry does not already exist, prepare and verify the
smallest reviewed collection path before starting the window. Never weaken
tenant authorization or expose request content to make observation easier.

## Literal acceptance measurement status

| Claim | Existing evidence | Remaining bounded work |
| --- | --- | --- |
| First viewport at exactly 1366 x 768 | DONE: additive `37055428421`, artifact `11249886749`, 66/66 pass at measured 1366 x 768 with zero touch, plus eight actual representative screenshot reviews | Exact-source admission completed below; preserve the canonical matrix and all thresholds |
| Color-blind inspection | DONE: run `37055624370`, artifact `11251457434`, 336/336 pass plus 12 actual representative screenshots | Bounded receipt below covers three named simulations, EN/typical/admin/customer and paired themes/device modes. Simulation is not a human-user study or a new WCAG certification |
| Old/new block and vertical-distance comparison | DONE: exact original/current run `37074506981`, matched fixture and three samples per surface/stage, eight actual screenshots inspected | Accepted receipt below preserves source identities, geometry and separate block counts; synthetic layout evidence has its own scope |
| At least 35% distance reduction | DONE: Service Desk67.00%, Agent Desktop60.26%, Entitlements48.34%, Calendar52.99%; all four independently pass | Unchanged formula and35% gate; no averaging, same-source substitute or claim about human task completion time |

The frozen historical distance metric uses the first specific actionable
representation of the same fixture work item: Service Desk row -> priority
action strip; Agent Desktop open-case row -> next-case panel; Entitlements card
-> row; Calendar timed node -> next-item button. Generic summaries, filters,
enclosing page wrappers and later duplicate representations are ineligible.
These mappings were reviewed before any position/percentage was captured.
Record representation identity and label geometry alongside container position;
the35% target applies independently to all four surfaces. This synthetic
first-item metric is separate from canonical table/grid position and production
task-time measurements. Both stages use an explicitly unsupported service-worker
capability plus context-level blocking and verify no registered workers. The
synthetic organization enables the same eight modules, including VoIP,
Omnichannel, MTM and AI required by shared-shell probes; no voice pilot or
provider is enabled. All application, HTTP, external
request and unexpected-write counters remain strict. Source-confirmed CSP
reporting and self-navigation preferences are separately counted: exact bounded
same-origin payloads, at most one each per sample, completed real204/200
responses and read-only DB ownership/cohort proof. All other writes are
blocked; an empty navigation list is permitted by the unchanged API and still
requires the actual self-owned DB row. Both stages wait65 seconds between
closed route pages so the original's unchanged public rate limit expires
naturally. No console filter, rate-limit reset or CSP/security-header bypass
is admitted. This measurement does not validate PWA/offline functionality.

Heavy capture/build work runs in GitHub CI or the authorized ephemeral worker.
Additive dimensions must preserve the original default matrix and every
existing threshold. Do not repeat the completed 1296-cell matrix to capture a
small missing viewport/vision cell. A new dimension must participate in report
identity, blocked-cell cardinality and baseline compatibility.

## Additive capture queue

The prepared capture dimensions keep the original four viewport defaults and
standard vision unchanged. New dimension identity includes exact width/height,
mouse-versus-touch modality and vision state. Visual and performance comparison
must reject an incompatible baseline. Optional viewport/vision captures are
read-only; selecting them with a mutating journey is rejected before building.

| Prepared capture | Exact subset | Size / evidence boundary |
| --- | --- | --- |
| First-viewport inspection | `service-desk,agent-desktop,support-entitlements,agent-calendar`; `agent,manager,admin`; AZ/RU/EN; light/dark; `desktop-1366`; typical fixture; standard vision; canary enabled | 66 permitted cells, three samples each; real 1366 x 768 mouse/keyboard capture. [37055428421](https://github.com/rashadoni/leaddrive-v2/actions/runs/37055428421) completed on `988163b8370daa5a464ccff9a7ad3ba6b1216ee6`; 66/66 PASS; eight screenshots inspected |
| Color-blind inspection | All scenarios; `admin,customer`; EN; light/dark; desktop/mobile; typical fixture; protanopia/deuteranopia/tritanopia; canary enabled | [37055624370](https://github.com/rashadoni/leaddrive-v2/actions/runs/37055624370) completed on `988163b8370daa5a464ccff9a7ad3ba6b1216ee6`; actual 336/336 PASS, one sample per cell; 12 representative screenshots inspected |
| Historical quantitative comparison | Four daily-work surfaces; matched fixture/role/locale/theme/viewport/data and old/current source identities | DONE: `37074506981` built and captured exact public original `76994875a251e0956b56f8d300625b97eb098661` and current `89576dc676e2bdced2b6a0d231ccdf08e155880a`; all four independently pass35%. Earlier failed diagnostic runs remain in the append-only journal and do not provide accepted geometry |
| Corrected Calendar semantic receipt | `agent-calendar`; admin/EN; both themes; desktop-1366; typical fixture; standard vision; three samples | New bounded run `37061949081` completed on43440b2dd, two permitted cells PASS; actual report and both screenshots inspected. Header12 equals the selected week day total12; no full matrix replay |

These runs are additive evidence for previously untested dimensions. Record
the dispatched branch SHA, Actions run, retained artifact and actual result
before changing an acceptance status. The full completed 1296-cell matrix,
original release workflows and original deploy are not repeated.

## Exact 1366 x 768 receipt — accepted 2026-10-03 (Asia/Baku)

[Run 37055428421](https://github.com/rashadoni/leaddrive-v2/actions/runs/37055428421)
completed successfully on `988163b8370daa5a464ccff9a7ad3ba6b1216ee6`. Retained
artifact `11249886749`, 7,627,722 bytes, digest
`sha256:708f1693b401391cc41007010b84172b88c6aa84091e22799dfb24f96f58a09e`.
Its JSON contains exactly 66 passed cells, production-mode isolated typical
fixture, enabled canary, standard vision and three samples per cell. Every
cell reports/measures 1366 x 768 and zero touch points. All primary work areas
are visible; page overflow, runtime errors, environment mismatch, Axe
violations and local accessibility issues are zero. This is source/fixture
browser evidence, not authenticated production-tenant observation.

| Daily-work scenario | Cells | Primary work top from viewport |
| --- | --- | --- |
| Service Desk | 18 | 488 px |
| Agent Desktop | 18 | 183 px |
| Support Entitlements | 12 | 453–473 px |
| Agent Calendar | 18 | 341 px |

Actual screenshot inspection covered two cells per surface: Service Desk
agent/RU/light and admin/EN/dark; Agent Desktop agent/EN/dark and
manager/AZ/light; Entitlements admin/EN/light and manager/RU/dark; Calendar
manager/AZ/dark and agent/EN/light. In these images the main work surface and
controls appear within the viewport. Tables/calendar retain their owned
containment and longer labels can truncate; this review does not assert that
every label or every record is fully visible at once. The exact first-viewport
criterion is DONE; the color-vision receipt below closes its separate
criterion. Quantitative before/after improvement is accepted in the separate
matched receipt below.

### Calendar semantic correction discovered during screenshot audit

The dimensions receipt does not prove every business count. The Calendar
header counted 50 tickets while the selected week contained 13: the API admitted
all open tickets when today was in the requested range, even if an individual
SLA date was outside it. Conversely it hid SLA-dated work in a future week when
today was outside that week. The correction filters by the actual emitted date
(`slaDueAt`, or today for undated open tickets), preserving organization fences
and resolved/closed-date behavior. Four route regression cases pass locally;
two failed against the preceding implementation. The no-misleading-metrics
criterion was reopened at discovery; the corrected candidate receipt below
subsequently closes source/API/UI admission. The correction then reached
production through approved PR #530 and successful release 37110761933, with
independent full-SHA verification below. The original viewport evidence remains
valid for its recorded source; no new authenticated production count was observed.

### Corrected candidate Calendar receipt — accepted 2026-10-03 (Asia/Baku)

[Run37061949081](https://github.com/rashadoni/leaddrive-v2/actions/runs/37061949081)
completed on43440b2dda9c8f5bc403750296553399b111e0f4. Artifact11252200158,
181,526 bytes,digest
`sha256:7ff175128f5b06fab1245bf2c9335889351053d938dc86edcb89217a0aae0553`.
Both admin/EN/light-and-dark1366x768 cells PASS with three samples, primary top
341px and zero runtime/Axe/accessibility/overflow failures. Both actual PNGs
show header12 tickets and Friday12, with the other six days0. The corrected
summary is consistent with the selected week. Fresh seed time differs from the
earlier66-cell fixture, so this is not a claim that the old13 must be preserved
or a matched timing comparison. Current/future-week route cases passed; source
and tenant fences retain their recorded tests. Later controller-only edits
leave this Calendar page/API source unchanged. The candidate metrics criterion
is accepted. PR#530's protected admission and production update subsequently
passed; the Calendar page/API blobs remain identical to this corrected receipt.

## Explicit color-vision receipt — accepted 2026-10-03 (Asia/Baku)

[Run 37055624370](https://github.com/rashadoni/leaddrive-v2/actions/runs/37055624370)
completed successfully on `988163b8370daa5a464ccff9a7ad3ba6b1216ee6`.
Artifact `11251457434`,29,623,662 bytes, digest
`sha256:b61cfe57aca8db3200692f205e114c609799f39250b3562c9951ff367879874d`.
Actual JSON contains336/336 passed cells:112 each for protanopia,
deuteranopia and tritanopia;276 admin/60 customer;168 desktop1440 x900
with zero touch points and168 mobile375 x812 with one touch point.
All28 scenarios appear. Reported runtime/Axe/accessibility/touch/environment
and whole-page horizontal-overflow failures are zero. One load per cell is
coverage evidence, not comparable p75 performance.

Twelve retained screenshots were actually opened: Service Desk, Agent Desktop,
Calendar, Entitlements, Macros, SLA Policies, portal tickets/detail/chat, VoIP,
Escalation Rules and Knowledge Base. Across the set all three simulations,
both themes, both device modes and both roles are represented. Ticket status,
priority and SLA warnings use text and icons; entitlement states, published
articles, active rules and call direction/completion remain labeled. Portal
statuses and manual-support mode also retain text/icon meaning.

The Agent Desktop admin fixture has an empty assigned queue, so that image
proves the empty state and actions rather than populated assigned-case states.
The old Calendar screenshot retains its known count/date defect and is not a
corrected semantic receipt. Long labels, previews and calendar content can
truncate within owned containers. The review covers static visible regions;
it does not claim an inspection of every row after scrolling, keyboard
interaction, a representative human-user study or a new WCAG certification.
Existing keyboard/source receipts keep their original scope. No new blocking
color-dependence issue was found in the inspected states. The explicit
color-vision criterion is DONE at these recorded dimensions.

## Matched original/current receipt — accepted 2026-10-03 (Asia/Baku)

[Run37074506981](https://github.com/rashadoni/leaddrive-v2/actions/runs/37074506981)
completed successfully: exact original production build/capture, exact current
production build/capture and unchanged comparison gate. Original source
`76994875a251e0956b56f8d300625b97eb098661`; current/controller source
`89576dc676e2bdced2b6a0d231ccdf08e155880a`. Shared fixture digest
`c912f206b8a34fa434a678231b2cf8b98b68ffecf4959a87744c41d959ea5401`, anchor
`2026-10-03T08:00:00.000Z`, common-main base
`420e5be1285a68954d45653d9f0740f212f6adea`, observed main snapshot
`ba2326c270b138b025dc2975b370e90725c69483`. No application source overlay.

| Retained artifact | Bytes | SHA256 digest |
| --- | --- | --- |
| Original11256806428 | 606697 | `3760dae4ab15453f8bedf6671e6e4e4fa40b189f57f0d7b40042b5eaa8a193e0` |
| Current11257401916 | 434363 | `7401efd80df3c802454b3357bd56296612c732340f402ead076083a999af4f70` |
| Comparison11256639823 | 2053 | `f86734612222b7304014e410202e479d121353afd5b43a7651171a458393eb8a` |

Metric: first matched actionable work-item container top from viewport at zero
scroll. Formula: `(beforeTop-afterTop)/beforeTop*100`. Admin/EN/light/UTC,
1366x768, zero touch, reduced motion, standard vision and matched50-ticket
fixture; three samples per surface/stage. Each surface independently needs35%.

| Surface | Original/current top px | Reduction | Original/current label top px | Original/current rendered blocks |
| --- | --- | --- | --- | --- |
| Service Desk | 757.625 /250 | 67.0021% | 769.125 /269 | 37 /32 |
| Agent Desktop | 460.5 /183 | 60.2606% | 470.5 /220 | 12 /17 |
| Entitlements | 876 /452.5 | 48.3447% | 897 /461 | 34 /10 |
| Calendar | 585 /275 | 52.9915% | 589 /312 | 112 /18 |

All three top/label samples are identical within each surface/stage. All
external-request, unexpected-write, page, console and HTTP-failure counters
are zero. Each sample completed one real CSP204 and one preferences200; both
runtimes prove exactly one valid self-owned preferences row,50 fixture tickets
and one entitlement. Actual eight PNGs were opened; independent review also
inspected all four current images. Original Service Desk label and entitlement
card are below the viewport; their matched identities/positions are DOM/API
evidence, not a claim that these labels are visible in the original PNGs.

Blocks count all rendered bordered/rounded descendants of main, including
offscreen content. Agent Desktop's count rises12→17 while its matched first
action moves upward; a universal block-count reduction is not claimed. These
synthetic measurements close the documented layout-comparison criterion, not
a human cognitive-load/task-time study, PWA test or production observation.
Later instrumentation/type-only edits must preserve these four page blobs and
their data paths before this receipt is reused; new required PR checks still
apply to each published candidate.

## Released category-handler telemetry and prepared daily collection

PR#530 instruments category-list GET and category create/rename/delete handlers
after successful base auth. It keeps authorization, RLS, transactions, response
bodies/statuses and category behavior. Each completed handler emits one bounded
structured event with compiled artifact SHA, UTC completion time, operation, observed
database/browser/unverified mode, outcome/status and monotonic duration. Tenant
association uses a domain-separated HMAC with the existing validated auth
secret; no tenant/user ID, name, category content, body, query or raw error is
logged by this instrumentation. Logging is unsampled and best effort; failures
to log do not change the operation's result.

The protected existing `Inspect production safely` workflow
(`.github/workflows/tail-app-logs.yml`) now has a reviewed-main
`support-ux-observation` view from released PR#530. Select the exact
authorized tenant slug and one completed Asia/Baku day (`support_day`). The
standalone trusted collector is streamed through the pinned production SSH
route; it reads literal root-owned app.env, resolves only that active tenant
in a bounded read-only transaction, and scans fixed root-owned PM2 output-log
paths. Credentials are neither evaluated as shell code nor placed in command
arguments/output. Input/output schemas, file/event/decompression limits,
timeouts, no-follow checks and whole-source metadata checks fail closed.
Copytruncate/rotation during collection invalidates the result. No DB/log
mutation, raw-log export, feature activation or automated observation admission.

Each output group keeps artifact SHA, operation and mode separate. Denominator
is logged handler attempts after successful base auth; failure numerator is
server errors plus thrown failures. Client rejections remain separate. Duration
is server-handler time, excluding proxy/base-auth/network/browser latency.
p50/p75 use nearest rank and retain their sample count; at least seven samples
only indicates a comparable sample count, not sufficient production acceptance.
Macro apply usage, proxy/auth failures and browser category edits are outside
this scope. Browser-mode mutation409 is a client rejection, not a server error.
Match a real approved baseline by operation, mode, source and metric definition;
do not compare these durations to page-load p75 or public ping RTT.

Every collector output deliberately retains `coverage.status: UNVERIFIED` and
`observationAdmitted: false`. A no-observed-traffic result cannot establish zero
actual traffic. Before admitting a day, verify effective INFO logging, retained
whole-day sources, restart/process continuity, no lost events, auth-key rotation
effects, deployment/flag chronology and the separate incident review. Missing
or unavailable telemetry, changed source files, limit failures and retention
gaps must be recorded. Unavailable events lack tenant/time and are reported
across retained sources rather than attributed to the selected day. Existing
14-file copytruncate configuration is source evidence; actual production
retention/log level and collector execution remain NOT RUN. If coverage cannot
be established, keep the day unverified and repair the collection path before
counting a new full day.

## PR #530 independent release verification — 2026-10-03 (Asia/Baku)

Owner confirmed the concrete new Calendar/telemetry release. Protected merge
`f62ab3a609a0461cbd14c264306df2d28325628f` completed at 08:45:22 UTC. New automatic
[deploy 37110761933](https://github.com/rashadoni/leaddrive-v2/actions/runs/37110761933)
SUCCESS; production job completed at 09:12:22 UTC. Build, quality/security, atomic
installation, scheduler/tenant-isolation checks, public ping, exact revision
and login/hashed-assets smoke all passed. Post-merge checks 37110761818,
runner 37110761810 and scan 37110761817 SUCCESS. Completed #501/#505 workflows
were not repeated; no manual deployment or tenant flag mutation occurred.

Independent TLS-verified GETs, without cookies or Authorization, then observed:

| Endpoint | Actual result | Observed Asia/Baku / request RTT |
| --- | --- | --- |
| `/api/v1/ping` | 200, `ok:true`, `Cache-Control:no-store` | 13:13:22.958988+04:00 / 0.373999 s |
| `/api/v1/public/build-info` | 200, exact full f62 SHA, no-store; `builtAt:2026-10-03T08:53:06Z` | 13:13:23.333122+04:00 / 0.092568 s |
| `/api/v1/calendar/agent`, `/api/v1/ticket-macros`, `/api/v1/support/ux-rollout` | Each 401 with `session_expired`, using `Sec-Fetch-Mode:cors` | 13:13:23.425974–23.570390+04:00 |

These are public DB/revision and unauthenticated-access receipts. Request RTT
includes the bounded body read; it is not server-handler or page latency.
Authenticated feature behavior, selected-tenant flag state and the observation
window remain NOT RUN. No seven-day coverage or production admission inferred.
Later main a27681fc is a direct successor from Workforce PR #540; all 14 recorded
Support page/data/telemetry/diagnostic blobs match approved b9→f62→a276. This
does not assert that successor's live deployment or repeat its release.

Safe receipts, verification script and extracted-file hash manifest are retained
at `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-release-37110761933`.
Protected metadata-only diagnostic 37110998886 also records the dated PM2
stdout path `/var/lib/leaddrive-v2-logs/out.log`, regular 0644 / 16687827 bytes
at 08:50:08 UTC. This fits the 64 MiB collector ceiling at that instant. Numeric
owner UID is masked; retention, effective INFO, actual traffic and whole-day
coverage remain UNVERIFIED. No log contents or DB query were collected there.

## Final flag-retirement release

Retiring the code-level gate is a later release; removing a tenant flag during
an incident is a rollback. They must not be confused. Before the later release:

1. Verify all seven complete daily receipts, representative activity, stable
   error/latency against the accepted baseline and zero unresolved P0/P1.
2. Recheck permission, feature/add-on, direct-route and tenant-isolation
   behavior on the exact proposed source; maintain persisted-state and
   rollback compatibility, including tenants still using browser categories.
3. Complete the literal acceptance measurements above and any required
   baseline review; keep unverifiable claims open.
4. Prepare the exact flag-retirement change, tests and compatibility/rollback
   explanation. Show the owner the concrete behavior that will reach users
   before merge, as required by `docs/DELIVERY-ARCHITECTURE.md` layer 4.
5. Pass all five protected PR contexts and the supported new main release.
   Verify public ping, exact build-info and feature-specific smoke. This is a
   new governed change, not a rerun of the original Support deployment.
6. Close `SUPUX-ROL-006`, synchronize the acceptance summary and append the
   final evidence/checkpoint to the active session journal. Claim 100% only
   when those remaining requirements are actually satisfied.

Current stopping point: all sixteen independent literal layout/source/browser
criteria are accepted; PR #530 delivered Calendar correction and minimal
telemetry/collector, and PR #544 delivered the atomic operator/trusted audit
boundary with protected release and independent public SHA/smoke. Fresh bounded
48-cell source baseline preparation/comparison is complete with unchanged
ceilings/October 8 limits. Representative tenant, authenticated flag state,
audited activation, real handler baseline/effective INFO/retention/continuity,
seven complete production days and later flag retirement remain pending.
Next action: obtain the exact authorized tenant slug and selected-tenant auth
context, verify flag/audit/collection admission, establish actual baseline and
coverage, then start the evidenced calendar window. No tenant action has run.


## 2026-10-03 — Admission preparation resumed after PR544

The owner requested continuation. Exact representative production organization
name/slug was requested once and remains pending; no tenant has been selected
or activated, and no daily collection or observation day is admitted.

Fresh protected metadata-only inventory
[37133442555](https://github.com/rashadoni/leaddrive-v2/actions/runs/37133442555)
completed successfully from reviewed current main
`cb6d01ce1c0a7af315c94fe43972b56f735c9700`. It waited in the existing production
concurrency group until another task's deploy completed. At15:33:49UTC it
reported PM2 stdout `/var/lib/leaddrive-v2-logs/out.log`, regular0644,16854344B,
and stderr `error.log`, regular0644,904211B. The directory is2750; masked
ownership remains masked. The stdout size is within the collector's67108864B
cap at this snapshot. This does not prove parseability, actual handler samples,
effective INFO, whole-day coverage, historical retention or incident absence.
No log body, application environment or customer payload was collected.

Independent no-auth/no-cookie, verified-TLS public reads at15:35:48UTC
(19:35:48Asia/Baku) returned ping200/oktrue and build-info200/exact fullcb6 SHA;
both no-store. BuiltAt15:12:19UTC. Eighteen named Support/operator/audit/rollout/
category/telemetry/collector/logrotate/PM2/RLS/auth blobs were independently
compared with329 and are identical; this is scoped source compatibility, not
whole-tree equality or selected-tenant admission. Completed source CI, merge,
deploy and browser matrices were not rerun by this phase.

Durable evidence: `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-readiness-37133442555`,
seven hashed receipts12289B plus manifest, including the source identity pairs,
diagnostic job/result and dated public runtime receipt. Next required input is
the exact authorized production organization; its normal approved auth context
is then needed for selected-tenant reads and audited activation. The partial
activation day will not count toward seven complete Asia/Baku days.


## 2026-10-03 — Independent readiness diagnostic preparation

The next bounded source step closes a verification-path gap: existing
inventory cannot report process identity or
whether the current process has emitted Support INFO telemetry. Preparation
of the protected `support-ux-readiness` view is complete with 16 targeted
behavioral tests passing. Protected PR/release and production execution remain
PENDING; no runtime result is claimed from the fixtures.

The proposed view requires no tenant input or database access. It reads fixed
app process metadata, the compiled revision through local public build-info,
a bounded current stdout sample and reviewed logrotate authorities. It reports
only allowlisted metadata and aggregate matching INFO evidence. It does not
invoke a PM2 command that can launch a daemon or open app.env. The bounded
process startup environment is consumed privately; credentials and environment
contents are never exported, and only allowlisted routing/LOG_LEVEL facts survive.
The workflow tests it before SSH and validates its output before publication.

A matching INFO event is evidence of an emission at that time; an empty sample
is not proof that INFO is disabled or traffic is absent. Startup LOG_LEVEL is
not the live Pino level. Stable process/files during one read do not prove
continuous seven-day operation, and matching rotation policy does not prove
historical retention. Observation admission stays false; the selected-tenant
flag/audit, matched baseline, coverage and incident requirements remain open.

The process start is a kernel-derived estimate. `infoNotBeforeUtc` excludes its
first estimated second to avoid admitting stale records around PID reuse. The
probe rejects changes in PID/start, startup environment, clock mapping, source
files or compiled revision between its reads. The 16 behavioral tests include
real temporary-file symlink/inode/write races and mocked fixed-localhost HTTP
limits/aborts; they do not access production. Local runner policy, workflow
guard wiring and production asset guards also pass.


## 2026-10-03 — Owner test tenant selected; flag remains off

This entry supersedes earlier pending-tenant-selection statements. The Mac
coordinator delivered the owner's selection of LeadDrive Inc., slug
`leaddrive`, for tests and tenant-specific Support canary after normal audit
and logging admission. Its normal authenticated organization/session reads
report a matching slug and superadmin role; no credential was transferred.
The remote session has no access to that authenticated browser. Tenant tests
do not authorize other organizations, external sends, irreversible deletion
or global settings/release changes. Existing PR553 predates this clarification.

Protected read-only [37143634459](https://github.com/rashadoni/leaddrive-v2/actions/runs/37143634459)
completed SUCCESS on current main022c4a453e80f58e13d71e5808354d12daeb65aa.
At18:17:48UTC/22:17:48Asia/Baku it reported this exact active tenant, flag off,
native feature array, four macros and zero stored categories. No activation
or audit write occurred. The result does not substitute for the selected
organization's normal authenticated rollout/audit reads.

Independent public ping/build-info at18:21:05UTC/22:21:05Asia/Baku both
returned200/no-store, ping oktrue and the exact full022c artifact SHA.
Its existing automatic deploy37141070643 was not repeated. An initial default
urllib request returned403; that failed attempt is retained separately from
the successful bounded request with the previously verified headers.

Receipts: `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-tenant-37143634459`.
Next: authenticated selected-tenant flag/audit, runtime logging readiness and
actual matched handler baseline; then an audited tenant action and a fresh
client-visible state read if admission succeeds. No observation day is counted.


Subsequent coordinator evidence on the same selected organization reports a
normal authenticated rollout GET HTTP200/enabled:false and Macros DOM browser
mode. The matching support_ux_canary audit read returned success/total0/logs[].
No action was performed; request UTC/cache metadata was not provided, so these
reported reads do not establish a future mutation bound. The sanitized report
is retained in the same archive, attributed to the Mac coordinator.

A confirmed browser-mode copy defect is being corrected before final admission:
category management must describe local empty-category storage while preserving
that categories assigned to macros are shared. Delete-copy must describe its
local-list and shared-macro effects accurately. This is a wording correction,
not a persistence or flag change, and is not yet released.
