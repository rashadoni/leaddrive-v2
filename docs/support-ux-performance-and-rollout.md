# Support UX performance and rollout contract

Status: **IMPLEMENTATION, EVIDENCE AND PRODUCTION RELEASE RECEIPT COMPLETE;
REPRESENTATIVE OBSERVATION AND FLAG RETIREMENT PENDING** (reconciled 2026-10-03).
This contract is the release authority for the Support UX branch. PR #501 and
the approved Calendar/telemetry PR #530 production releases are complete. The
atomic canary operator/trusted audit boundary also shipped through PR #544;
its separate dated production receipt is recorded below.
Recorded source comparison and pre-release
canary gates remain accepted at their exact historical dimensions; the later
tenant observation/flag-retirement gate is still open. The tracked checklist
is 190/191, not 100%. Remaining representative production admission is listed
in section 25 of the implementation plan.

## Performance measurement

The SHA-bound GitHub Actions browser evidence runner is the canonical harness.
Contabo is limited to small sequential source checks; production builds and
browser matrices run in the isolated GitHub fixture environment.

Every evidence result records the exact commit, application mode, tenant canary
state, data profile, scenario, role, locale, theme and viewport together with:

- one sample for bounded coverage, or three/seven load samples with their
  recorded p50/p75; single-sample coverage does not establish p75;
- filter feedback p50/p75, Event Timing p75 and cumulative layout shift;
- primary-work top, immediately visible actions, rendered rows/cards, top-level
  and bordered-container counts, document size and horizontal overflow;
- runtime/HTTP failures, keyboard stops, touch capability, actual locale/theme/
  reduced-motion state and WCAG 2/2.1 A/AA Axe results;
- a dimension-sensitive pixel comparison when an exact compatible baseline is
  supplied.

Seven samples after the runner warm-up are mandatory for a comparable p75. A
comparison is invalid unless commit-independent dimensions match: production
application mode, fixture profile/revision, canary state, scenario, role,
locale, theme, viewport and sample count.

### Relative release gates

- Load p75 may not regress by more than 10% or 100 ms, whichever allowance is
  larger.
- Filter p50 and interaction p75 may not regress by more than 10% or 50 ms,
  whichever allowance is larger.
- CLS may not regress by more than 10% or 0.001, whichever allowance is larger.
- Primary work may not move below its accepted baseline.
- Horizontal overflow remains zero at 375 px.
- Rendered rows/containers may not grow for an identical fixture unless an
  approved data-contract exception records the additional useful content.
- Runtime, accessibility, environment and missing-baseline failure counts remain
  zero. Capture mode is never called a comparison pass.

### Measured Service Desk repeatability budgets

Runs `34241690941` and `34247698584` measured the same production build at SHA
`52045c9e793744d7f89c883487b8616d8d71bd55` with seven samples across 96
AZ/RU/EN, light/dark and four-viewport cells. Identical visual/structural output
still produced timing spread, so a result fails only when it exceeds both the
relative allowance and the measured ceiling below.

| Scenario | Load p75 ceiling | Filter p50 ceiling | Interaction p75 ceiling |
| --- | ---: | ---: | ---: |
| Service Desk list | 650 ms | 200 ms | 250 ms |
| Service Desk Kanban | 600 ms | n/a | n/a |
| Service Desk reports | 700 ms | 200 ms | 150 ms |
| Ticket Detail | 600 ms | n/a | n/a |

Evidence owner: repository owner `rashadoni`. Review/expiry: 2026-10-08 or any
earlier fixture, builder-topology or application data-contract change. A slower
feature build must never redefine its own ceiling.

A data-contract exception requires exact before/after metrics, additional
records/controls, user benefit, accountable owner, approval and expiry date.

## Profile coverage

The final branch must exercise `0`, `5`, `50`, `500` and section-specific
`high` fixtures. Full cross-product visual coverage is required for `high`;
smaller profile runs may be section-scoped but must retain exact role, viewport,
locale, theme and commit metadata. Pagination or virtualization is introduced
only when measured DOM/rendering behavior requires it.

The final measured profile set uses Service Desk and VoIP for agent, manager
and administrator at desktop/mobile, EN/light, canary enabled and seven samples
per cell. Every run passes 12/12 production cells.

| Profile | Run / artifact | Service Desk load p75 max | VoIP load p75 max | Rendered Service Desk | Rendered VoIP | Disposition |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 0 | `36554107100` / `11027089469` | 401 ms | 462 ms | 1 empty row | 0 | Accepted |
| 5 | `36555323681` / `11029402390` | 314 ms | 375 ms | 4–5 | 5 | Accepted |
| 50 | `36557478393` / `11030325874` | 480 ms | 547 ms | 20 | 25 | Accepted |
| 500 | `36559389503` / `11030487883` | 332 ms | 341 ms | 20 | 25 | Accepted; VoIP `500 total / 20 pages / 25 rendered` matched in all six cells |

Worst filter p75 is 42 ms for Service Desk and 400 ms for the intentionally
debounced VoIP filter. Worst interaction p75 is 40 ms; maximum CLS is
`0.011741124511635809`; maximum primary-work top is 615 px for Service Desk and
704 px for VoIP. All profile runs have zero failed result, runtime, Axe, custom
accessibility, touch, overflow, environment or primary-work gate. The
500-record fixture stays bounded by existing server/client pagination, so the
measurement does not support adding virtualization. Empty, small, medium and
large desktop/mobile captures were manually accepted.

## Independent rollback boundaries

The implementation history is intentionally checkpointed by slice. Recovery is
a new reviewed branch that reverts only the affected checkpoints; never reset
`main`, delete persisted tenant state, copy a worktree to production, or deploy
outside GitHub Actions.

| Boundary | Representative implementation checkpoints | Recovery property |
| --- | --- | --- |
| Shared shell/foundation | `b8a9f0c08` through `7a70f8ddf` | Presentation-only commits are independently revertible |
| Service Desk / Ticket Detail | `4da1a5fc4`, `4b61b375d`, `4cc705d9a`, `a959654ef` | Additive API fields may remain during UI rollback |
| Complaints / customer portal | `645919ac2`, `6f80377ac`, `737dc6427`, `bcc5ea52c` | Drafts remain namespaced; security projections are never widened |
| Agent Desktop / VoIP | `fa85acf70`, `889143660`, `fe44dee68` | Same-scope aggregates remain compatible |
| Knowledge / routing / policy pages | `a0a68b220`, `3946aa28b`, `61d4087eb`, `27c571df4`, `d002818b8`, `b0fbbac1f`, `4e0600bf7`, `8f8ca41d8` | Each surface can be reverted without schema deletion |
| Macros presentation/API | `f53e88a8b`, `13eaf2bb1` | Existing macro records remain readable |
| Macros category state migration | `38890a3b7` | Tenant flag selects DB or browser-storage contract without deleting either |
| Portal users / Support AI / navigation | `7d80d25e4`, `b280e6c83`, `5f46b72d5` | Access gates remain strict in every state |
| Evidence/performance harness | `1624cd66f` through `38890a3b7` | Harness may be repaired without changing product thresholds |

## Tenant canary boundary

Flag: `support_ux_v2_canary` in the authenticated organization's existing
feature array. The flag is intentionally not exposed through the ordinary
tenant AI-feature toggle allowlist.

Current-main reconciliation established:

- Work/Team/Rules Support navigation already exists on `main`; this release
  does not pretend to canary a previously shipped information architecture.
- Shared-shell/density work is presentation-only and independently revertible.
- Entitlement, API and access changes are additive compatibility or
  authorization hardening. Tenant/RBAC/direct-route/security checks remain
  enforced and cannot be disabled by a rollout switch.
- The actual persisted-state migration is Macros custom categories: the prior
  UI stored them per organization in browser storage; v2 stores them in tenant
  organization settings and atomically updates matching macros.

### Flag off / unreadable / malformed

- `/api/v1/support/ux-rollout` returns `enabled: false`, or the client treats a
  failed response as false.
- Macros reads remain available under the same role and tenant permissions.
- Category add/rename/delete uses structurally validated
  `macro-categories-{organizationId}` browser storage and authorized legacy
  macro updates.
- Direct requests to the shared category mutation API fail closed with
  `SUPPORT_UX_CANARY_DISABLED`; no organization settings are written.
- Tenant DB categories are retained for a future re-enable and never copied to
  another tenant.

### Flag on

- The no-store rollout endpoint must explicitly return `enabled: true`.
- Category mutations re-read the authenticated tenant's feature state inside
  their serializable transaction.
- Shared custom categories live in organization settings; rename/delete update
  only matching macros in the same tenant.
- Removing the flag during a session rejects the next v2 write; a reload or the
  rejection recovery path returns the client to browser mode.

The isolated fixture and artifact both record `enabled` or `disabled`.
Visual/performance comparison rejects a baseline from the other state.

### Admitted source proof

Both modes are proven on the same source SHA
`0498d3a857e2230be2db20e85525a728587d5032`:

- flag off: run `36551225927`, artifact `11025885144`, one production static
  cell and 6/6 Macros flows green; the category journey records browser mode,
  browser rollback surface, rename, undo and completed delete;
- flag on: run `36552953697`, artifact `11027281153`, one production static
  cell and 6/6 Macros flows green; the same journey records tenant mode,
  organization category surface, retained input/retry, rename, undo, completed
  delete and restored keyboard focus.

Both modes have zero runtime, Axe, custom accessibility, touch, overflow,
environment and primary-work failures. The rollback captures were manually
reviewed. This admits the source boundary for release; it does not enable a
production tenant or start the observation window.

## Canary admission order

1. Scoped lint, tests, runner syntax, translation parity and anti-pattern scan.
2. CI strict TypeScript graphs, isolated fixtures and production build.
3. Role, permission, add-on, direct-route and tenant-isolation regressions.
4. Flag-on and flag-off Macros mutation evidence, including add, rename,
   delayed-delete undo and completed delete.
5. Complete high-volume responsive/theme/locale coverage.
6. Seven-sample compatible capture and compare with no unresolved regression.
7. Merge only after all protected PR checks are green.
8. Deploy only from reviewed `main` through `.github/workflows/deploy.yml`.
9. Verify `/api/v1/ping`, exact build-info artifact SHA and read-only Support
   routes before any production tenant flag is enabled.

## Observation and flag removal

Shipping code with every production tenant flag off is reversible deployment,
not completed canary observation. Enabling a representative tenant is a
separate audited configuration action. Flag removal is a later release and is
intentionally deferred until all conditions hold:

- at least seven complete calendar days on a representative authorized tenant;
- zero unresolved P0/P1 Support regression;
- stable error and latency evidence against the admitted baseline;
- repeat permission/isolation checks;
- approved release-ledger entry and separately green PR/deploy.

## Release ledger

Initial reconciliation on 2026-10-02 used immutable existing GitHub records, fresh public
endpoint observations and a protected bounded runtime diagnostic. This updates
pre-release placeholders; it does not rerun completed checks, merge or deploy.
The earlier per-slice release receipts remain in the canonical plan (Service
Desk/Ticket Detail #82 with subsequent RLS recovery #100; Complaint Registry
#141; Agent Desktop #175). Final integrated release #501 carries the remaining
Support slices and preserves those earlier delivered surfaces.

| Field | Value |
| --- | --- |
| Slice / PR / merge SHA | [PR #501](https://github.com/rashadoni/leaddrive-v2/pull/501), head `8ef809a7b9c2e4cd3401b280092391be10cf3916`, merged `2026-09-29T16:49:44Z` as `bd83c5d41182fca0003282e2241e5ad9ae35c04b` |
| Protected PR admission | Existing `pr-scope`, `static-checks`, `typecheck` [36598285873](https://github.com/rashadoni/leaddrive-v2/actions/runs/36598285873); `runner-policy` [36598285850](https://github.com/rashadoni/leaddrive-v2/actions/runs/36598285850); `scan` [36598285885](https://github.com/rashadoni/leaddrive-v2/actions/runs/36598285885): all green on that exact head |
| Original production artifact / deploy | `bd83c5d41182fca0003282e2241e5ad9ae35c04b`, existing successful [36600569942](https://github.com/rashadoni/leaddrive-v2/actions/runs/36600569942), completed `2026-09-29T17:18:59Z`; original main checks [36600569920](https://github.com/rashadoni/leaddrive-v2/actions/runs/36600569920) green |
| Earlier verified main / live snapshot | `88cd6fcc41b748f9a22720bdab6b1c60fa73b1bf`; existing successful deploy [37045608290](https://github.com/rashadoni/leaddrive-v2/actions/runs/37045608290), main checks [37045608605](https://github.com/rashadoni/leaddrive-v2/actions/runs/37045608605) and scan [37045608454](https://github.com/rashadoni/leaddrive-v2/actions/runs/37045608454); live full-SHA equality observed `2026-10-02T22:54:27+04:00`. Superseded as latest snapshot by the separately dated PR #530 receipt below |
| Canary tenant and flag | Current production flag state UNVERIFIED; representative tenant selection/activation evidence requested. The prior pre-release ledger recorded none enabled and the source defaults off; that historical entry is not a current DB read |
| Evidence artifacts | Full 1296/1296 run `36542434997`, artifact `11024298303`; canary off `36551225927`/`11025885144`; canary on `36552953697`/`11027281153`; profiles 0/5/50/500 runs `36554107100`, `36555323681`, `36557478393`, `36559389503` |
| Roles / profiles | Agent, manager, admin, customer; high and measured 0/5/50/500 accepted |
| Baseline / compare | Accepted aggregate: `36575013443`/`11038557440`, `36580638589`/`11041830573`, `36585806513`/`11041654133`, `36588009933`/`11043736737` |
| Production smoke | Original deploy and later deploy job metadata report successful public ping, exact revision, login/hashed-assets smoke and tenant-isolation coverage. Independent public GETs at the dated snapshot are recorded below; no fresh authenticated Support UI observation is claimed |
| Observed production health metrics | At `2026-10-02T22:54:26+04:00`, ping HTTP 200 and `ok:true`, endpoint RTT 0.097967 s; build-info HTTP 200, full SHA above, RTT 0.107489 s. Curl 0, TLS verification 0 and JSON for both. These are endpoint request timings, not Support page latency |
| Observed runtime snapshot | Protected read-only diagnostic [37050620842](https://github.com/rashadoni/leaddrive-v2/actions/runs/37050620842) on then-main `88cd6fcc41b748f9a22720bdab6b1c60fa73b1bf`: `leaddrive-v2` online, 0 cumulative restarts for that process, uptime since `2026-10-02T18:37:33.302Z`; requested 200-line error tail has 0 Macros-category and 0 Support-rollout error-tag occurrences. No complete time/tenant/incident coverage is inferred |
| Admitted source metrics | Synthetic 0/5/50/500 profile p75 and CLS measurements above, and matched seven-sample 56-cell comparison receipt below; source/fixture evidence, not representative production telemetry |
| Observation | Start and seven-full-calendar-day coverage UNVERIFIED; pending `SUPUX-ROL-006`. See [production observation protocol](support-ux-production-observation.md) |
| P0/P1 incidents | None recorded in pre-release evidence. Current incident classification/history UNVERIFIED; zero tag hits in a short log tail cannot establish zero production incidents |
| Owner | Repository/release owner `@rashadoni` |
| Rollback decision | Retain the existing flag boundary; no rollback triggered by available release/public-health evidence. On confirmed regression, disable the selected tenant flag first and return to browser category mode while preserving DB state; revert affected source through a new reviewed main release if needed. Retiring the code-level flag is a later governed release |

`SUPUX-ROL-005` is closed by the release identities, smoke receipts, explicitly
bounded observed production snapshots, admitted source metrics and owner/
rollback decision above. It does not certify longitudinal tenant-level
stability. `SUPUX-ROL-006` stays open until all observation conditions in this
contract pass and the later flag-retirement release is separately verified.

The current protected diagnostic path works through GitHub Actions. Direct
inspection via `leaddrive-prod` was rejected with `Permission denied (publickey)`;
no alternate target/key was used. That access failure does not justify
substituting a retired production host or a direct server deployment.

### Calendar correction and observation preparation — PR #530

| Field | Actual result, 2026-10-03 |
| --- | --- |
| Owner admission / PR / merge | Owner “подтерждаю”; [PR #530](https://github.com/rashadoni/leaddrive-v2/pull/530), approved head `b9de0dad8c8db1cc6b84a8bd6a9eca682bfdae5b`, merged at 08:45:22 UTC as `f62ab3a609a0461cbd14c264306df2d28325628f`, no admin bypass |
| Protected admission | All five required contexts and standalone build SUCCESS on exact b9: PR checks 37078743036, runner 37078588718, scan 37078588733; existing baseline diagnostics retain their qualification, not a zero-error full compiler/all-unit-test claim |
| New automatic release | [37110761933](https://github.com/rashadoni/leaddrive-v2/actions/runs/37110761933) SUCCESS; production job finished at 09:12:22 UTC. Hosted build/quality/security, SHA-bound artifact verification, atomic install, schedulers/tenant isolation, public DB ping, revision and login/hashed assets PASS |
| Immutable artifact | `11269788634`, `leaddrive-prod-f62ab3a609a0461cbd14c264306df2d28325628f`, 443892431 bytes; GitHub API digest `sha256:e8ceb671c61001b0c5ed9ee02269e9b1bb24d25a24ad4e0df0e748dbb0563db7` (archive not independently downloaded/rehashed) |
| New post-merge checks | PR checks 37110761818, runner 37110761810 and scan 37110761817 SUCCESS on exact f62 |
| Independent public snapshot | TLS-verified cookie-free GETs at 13:13:22–23 Asia/Baku: ping 200/ok:true/no-store, request RTT 0.373999 s; build-info 200/no-store/exact full f62, RTT 0.092568 s, builtAt 08:53:06 UTC. RTT includes bounded body read, not handler/page latency |
| Protected API smoke | Calendar, Macros and rollout GETs each 401/`session_expired` with `Sec-Fetch-Mode:cors`. This proves unauthenticated rejection; authenticated feature behavior/tenant flag remains NOT RUN |
| Source and subsequent main | Calendar source matches corrected 43440 receipt; all 14 recorded Support/release diagnostic blobs match b9→f62→later main a27681fc, which directly includes f62. Later Workforce release/live state is outside this dated receipt |
| Durable receipts | `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-release-37110761933`: metadata, independent safe JSON/script, source identities and per-file SHA256 manifest. No credentials/raw production logs |
| Remaining admission | Representative tenant/activation, actual baseline/telemetry completeness, seven complete Asia/Baku days, incident review and later governed flag retirement remain open; 190/191, 16/17. No flag mutation or observation-day claim |

Original #501/#505 CI, merge and deploy were not repeated. This is the separately
approved new Calendar/telemetry release. It establishes delivered code and dated
public health; collector delivery does not establish collector execution or
longitudinal stability. Full local build/compiler/browser checks are NOT RUN
under the Contabo workload contract; the new required build/checks ran in CI.

### Final visual/performance comparison receipt

- Baseline `36575013443` / artifact `11038557440` passes 56/56 cells on exact
  integrated SHA `6fe471d03d1ccb924556c4aa36ea46e1af75ca5b`.
- Full compare `36580638589` / artifact `11041830573` matches 56/56 visuals and
  54/56 performance cells. The maximum changed-pixel ratio is
  `0.003023148148148148` against the unchanged `0.005` limit.
- Targeted compare `36585806513` / artifact `11041654133` passes the only two
  failed load cells without changing their limits. It also surfaced and failed
  an additional Escalation Rules mobile CLS sample rather than masking it.
- Exact-cell compare `36588009933` / artifact `11043736737` closes that final
  signal: 1/1 green, byte-identical screenshot, 399 ms load p75 and CLS p75
  `0.011741124511635809` against limit `0.012915`.

The immutable aggregate is the admitted seven-sample comparison for all 56
representative cells. Recovery was cell-scoped; no threshold, sample count,
dimension, accessibility check or structural assertion changed.

This ledger is updated with immutable run, PR, merge, deploy and smoke IDs as
each gate actually completes. Pending entries are never interpreted as passes.


### Bounded current-source baseline review — 2026-10-03

Fresh capture [37119565433](https://github.com/rashadoni/leaddrive-v2/actions/runs/37119565433)
uses source `4b4fe6d595ba2e6f5eea99932abb26d044a3be7a` and artifact
`11273491239`. Matched comparison
[37122190158](https://github.com/rashadoni/leaddrive-v2/actions/runs/37122190158)
uses source `fdb2b314a98c958d8de94ac80d18f5e161d5de04` and artifact
`11274546547`. Both reports contain the exact same 48 unique Service Desk,
Kanban, reports and Ticket Detail cells: agent/manager/admin, EN, light/dark,
1440 × 900 desktop and 375 × 812 touch mobile, typical fixture, enabled canary,
standard vision and production application mode in an isolated CI tenant.
Every cell has seven load and CLS samples after warm-up; all 24 applicable
filter cells have seven filter samples.

The actual comparison passes 48/48 visual and 48/48 performance cells. Every
current/baseline sample percentile, all 96 PNG file hashes and dimensions, and
all reported relative/absolute metric rules were independently checked. Raw
pixel counting was not repeated; the declared ratio/threshold arithmetic was
checked against the matching PNG hashes. Maximum changed-pixel ratio is
`0.00038117283950617285`, below unchanged `0.005`; 16 PNG pairs are byte
identical and the other 32 match within the unchanged tolerance. Primary work,
rendered rows and bordered-container counts do not increase. Runtime, Axe,
custom accessibility, environment, touch and overflow failures remain zero.

| Scenario | Capture load p75 max | Compare load p75 max | Unchanged ceiling | Compare filter p50 max |
| --- | ---: | ---: | ---: | ---: |
| Service Desk | 520 ms | 483 ms | 650 ms | 27 ms |
| Kanban | 538 ms | 528 ms | 600 ms | Not applicable |
| Reports | 496 ms | 509 ms | 700 ms | 97 ms |
| Ticket Detail | 394 ms | 394 ms | 600 ms | Not applicable |

Maximum compare CLS p75 is `0.011798959774159366`. Event Timing covers the last
navigation rather than the seven-load population: Service Desk has 10 measured
current cells but only nine paired baseline/current values (max 40 ms); reports
have 12 pairs (max 120 ms). The remaining null/nonpaired interaction values
are unmeasured, not zero or an independent timing pass. Service workers are
disabled and same-origin CSP-report POSTs are fulfilled with 204 by the
synthetic harness; this evidence does not prove production SW/CSP behavior.

Twelve recorded builder/controller/fixture/config/UI blobs match capture →
compare → final CI-resource candidate `abbaf6106d33aa612a603afdd88d8422fc95f16d`.
The comparison retains its own real fdb source identity. This review admits
only these fresh 48 dimensions; it does not replace the original 96-cell
repeatability record, raise any ceiling, extend the 2026-10-08 review boundary,
or establish representative production activity or observation days. Archives:
`/mnt/HC_Volume_106454338/codex-alt-data/support-ux-baseline-37119565433` and
`/mnt/HC_Volume_106454338/codex-alt-data/support-ux-comparison-37122190158`.


### Atomic canary operator and trusted audit boundary — PR #544

| Field | Actual result, 2026-10-03 |
| --- | --- |
| Source / protected merge | [PR #544](https://github.com/rashadoni/leaddrive-v2/pull/544), final head `abbaf6106d33aa612a603afdd88d8422fc95f16d`, merged normally at 13:02:01 UTC as `3294093a4364be8be35d8a03c1b9fde57c3dd3b9`; exact head matched, no admin bypass |
| Delivered behavior | Fixed-flag superadmin action binds tenant ID/slug, expected state and compiled SHA, preserves unrelated feature representation, and commits its actor audit in the same locked Serializable transaction. Generic audit POST reserves the canary entity; no UI or automatic tenant activation |
| Exact-head admission | All five required GitHub Actions contexts plus standalone build SUCCESS: [37123926459](https://github.com/rashadoni/leaddrive-v2/actions/runs/37123926459), runner37123926443, scan37123926439. Full compiler completed exit2 with both unchanged blockers and bounded swap cleanup SUCCESS; historical baseline diagnostics remain qualified |
| Targeted and actual DB proof | 52 scoped unit cases and scoped lint passed; the final audit file23/23 includes six forged receipt denials. Final real PostgreSQL gate10/10 PASS/zero skips in static111205359599, exercising actual route/RLS proxy, FORCE RLS, rollback and concurrency. Heavy checks ran in hosted CI |
| New automatic release | [37124821392](https://github.com/rashadoni/leaddrive-v2/actions/runs/37124821392) SUCCESS; production job111210440207 completed13:25:52 UTC. Build/quality/security, immutable artifact admission, atomic install, scheduler/isolation and the three named public ping/revision/login-assets smoke steps PASS. Job metadata contains24SUCCESS/3normalSKIP steps, not24 separate smoke tests |
| Immutable artifact | `11274851828`, `leaddrive-prod-3294093a4364be8be35d8a03c1b9fde57c3dd3b9`,443931998B; API ZIP digest `sha256:426bb20671b0d5f0b9f21bbac30adb41cdad89883a987a6966b2cb1910b0e84a`. Original ZIP was not independently downloaded/rehashed |
| New post-merge checks | PR checks37124821333, runner37124821308 and scan37124821287 SUCCESS on exact329; normal push-only duplicate static/build jobs SKIPPED. Actual full compiler13:08:08–13:13:20 UTC, exit2, both unchanged blockers/always-cleanup SUCCESS |
| Independent public snapshot | TLS-verified cookie-free requests17:27:00–01 Asia/Baku: ping200/ok:true/no-store; build-info200/no-store/exact full329, builtAt13:08:36 UTC. Client RTT0.431637/0.196531s includes bounded body read, not handler latency |
| Unauthenticated API guards | Calendar, Macros and rollout GET plus the empty-body unselected sentinel operator POST each401/`session_expired`. Guard responses had no Cache-Control header; no blanket no-store claim. Authenticated tenant behavior NOT RUN |
| Source identity | Fifteen reviewed operator/audit/auth/RLS/API/UI/build/gate blobs match approved head→merge. PR synthetic checkoute2b39811 and realmerge329 share complete committed tree `fe3cf1be7583369d1bb8d13e133b2b2633ccc422`; distinct checkout/head/merge and compiled artifact identities retained |
| Durable receipt | `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-release-37124821392`:12hashed files/63160B plus manifest, source/PR/DB/compiler/release metadata and independent safe public JSON/script. API digest is metadata; per-file stored hashes are independently verified |
| Remaining admission | Exact representative tenant/authenticated state/audited activation, actual handler baseline/effective INFO/retention/continuity, seven full Asia/Baku days/incident review and later protected flag-retirement release remain open. No production flag mutation or observation-day claim;190/191 remains an unweighted checklist |

The earlier completed #501/#505/#530 workflows were not rerun. This is the new
operator source's single normal protected release, including its new required
main/deploy checks. Two earlier candidate heap failures remain archived; the
final bounded hosted typecheck requires18GiB measured RAM+swap for a14GiB heap,
retains the full compiler/both blockers/60-minute timeout and always-cleans its
capped swap. No baseline, threshold, reviewer policy or branch protection was
weakened. Local full build/compiler/browser/PG gates are NOT RUN under the
persistent Contabo workload contract; the required hosted gates completed.
