# Support UX production observation and final admission

Status: **PREPARING; REPRESENTATIVE TENANT AND ACTIVATION UNVERIFIED**.
Owner: `@rashadoni`. Reviewed: 2026-10-02, Asia/Baku.

This is the execution record for `SUPUX-ROL-006` and the outstanding literal
acceptance measurements in the [implementation plan](support-module-ux-redesign-implementation-plan.md#25-acceptance-matrix).
The [release ledger](support-ux-performance-and-rollout.md#release-ledger)
closes `SUPUX-ROL-005`. Completed releases and matrices are reused as recorded
evidence; this protocol does not require repeating them.

## Admission before starting the clock

| Required fact | Current evidence / action |
| --- | --- |
| Representative authorized production tenant | Exact slug requested from owner; PENDING. Do not select an arbitrary paying tenant or count an isolated CI fixture |
| Current production route | `rashadoni/leaddrive-v2`, protected `main`, GitHub Actions, `13.140.132.245:/opt/leaddrive-v2`; public app `https://app.leaddrivecrm.org` |
| Current release identity | Live `88cd6fcc41b748f9a22720bdab6b1c60fa73b1bf` matched current main and successful existing deploy `37045608290` at `2026-10-02T22:54:27+04:00` |
| Authenticated flag state | UNVERIFIED. Read the selected tenant's authenticated no-store `/api/v1/support/ux-rollout`; only explicit `enabled: true` proves client admission. Public ping/build-info cannot prove this |
| Audited activation | UNVERIFIED. Require tenant slug, owner/actor, exact source/artifact SHA, before/after state and activation UTC/Asia-Baku timestamp; use an already approved record if it exists |
| Safe operator path | Registered local SSH alias currently rejects its key. Existing protected logs-only diagnostic works but cannot query/change the tenant flag. A bounded read-only `support-ux-rollout` view is prepared for the existing protected diagnostic workflow; it requires reviewed main admission before dispatch. It reports anonymous aggregate counts or one exact selected tenant's flag/count metadata and cannot activate a flag |
| Permissions and rollback | Verify selected administrator/manager permissions and tenant fences. Preserve all unrelated features and existing macro/category data. Removing the tenant flag restores browser mode while retaining DB categories |
| Error and latency baseline | Actual selected-tenant Support/Macros baseline and collection source PENDING. Generic Sentry configuration, endpoint RTT and a short PM2 tail are insufficient |
| Baseline validity | Existing Service Desk source ceilings require review by 2026-10-08 or earlier source/fixture/topology changes. Record the review before relying on them for final admission; do not increase a ceiling to fit a slow candidate |

The relevant persisted-state boundary is Macros custom-category storage. The
redesign's presentation and previously shipped navigation do not become a new
tenant canary merely because this flag is present.

Activation changes only the selected tenant's `support_ux_v2_canary` admission
flag through an audited transaction. It must preserve the existing feature
representation and unrelated flags. Record an idempotent already-enabled
result without inventing an earlier activation timestamp. Re-read authenticated
state after activation. No other tenant, category, macro, permission, billing
setting or customer message changes as an incidental action.

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

## Literal acceptance measurements still to capture

| Claim | Existing evidence | Remaining bounded work |
| --- | --- | --- |
| First viewport at exactly 1366 x 768 | DONE: additive `37055428421`, artifact `11249886749`, 66/66 pass at measured 1366 x 768 with zero touch, plus eight actual representative screenshot reviews | Exact-source admission completed below; preserve the canonical matrix and all thresholds |
| Color-blind inspection | Semantic labels/icons, paired themes and Axe receipts | Opt-in protanopia/deuteranopia/tritanopia simulation, identified in report/screenshot/baseline dimensions; manually inspect labels and status distinctions. Simulation is not a human-user study or a new WCAG certification |
| Old/new block and vertical-distance comparison | Current structural metrics and same-source stability comparison | Establish legitimate pre-redesign source/fixture baselines and matched current captures for Service Desk, Agent Desktop, Entitlements and Calendar; record before/after numbers, formula and source identities |
| At least 35% distance reduction | Target only; no matched quantitative proof recorded | Calculate only from the matched captures above. If the actual improvement is smaller, correct the layout and recapture the affected scenario; do not lower the requirement or invent a percentage |

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
| Color-blind inspection | All scenarios; `admin,customer`; EN; light/dark; desktop/mobile; typical fixture; protanopia/deuteranopia/tritanopia; canary enabled | 336 permitted cells, one sample each; inspect actual screenshots and status labels after capture. [37055624370](https://github.com/rashadoni/leaddrive-v2/actions/runs/37055624370) capturing on the same exact source; result and actual inspection PENDING |
| Historical quantitative comparison | Four daily-work surfaces; matched fixture/role/locale/theme/viewport/data and old/current source identities | New isolated run `37061944771` on `43440b2dda9c8f5bc403750296553399b111e0f4` admits public original `76994875a251e0956b56f8d300625b97eb098661`, whose four page blobs match the originals. Actual runtime/35% results PENDING; same-source comparison cannot substitute for this baseline |
| Corrected Calendar semantic receipt | `agent-calendar`; admin/EN; both themes; desktop-1366; typical fixture; standard vision; three samples | New bounded run `37061949081` on the same corrected source queued behind vision capture. Two permitted cells; no full matrix replay. Count/date semantics require actual artifact and screenshot inspection |

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
criterion is DONE; separate color-blind and quantitative before/after criteria
remain open.

### Calendar semantic correction discovered during screenshot audit

The dimensions receipt does not prove every business count. The Calendar
header counted 50 tickets while the selected week contained 13: the API admitted
all open tickets when today was in the requested range, even if an individual
SLA date was outside it. Conversely it hid SLA-dated work in a future week when
today was outside that week. The correction filters by the actual emitted date
(`slaDueAt`, or today for undated open tickets), preserving organization fences
and resolved/closed-date behavior. Four route regression cases pass locally;
two failed against the preceding implementation. The no-misleading-metrics
criterion is reopened until corrected source passes CI/browser admission.
The original viewport evidence remains valid for its recorded source; no
production deployment of this correction has occurred.

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

Current stopping point: verified release ledger and bounded runtime snapshot;
representative tenant, audited activation and telemetry collection remain
pending. Next action: supply the exact authorized tenant/activation record,
complete the operator/measurement path, and start the evidenced calendar
window while closing the additional acceptance measurements.
