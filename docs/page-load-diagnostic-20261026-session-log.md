# Page loading and capacity investigation — 2026-10-26

## 1. Request and routing

- User reports very slow page loading and clarified that **all pages** are affected.
- User also asks what happens with 1,000 users. Distinguish registered accounts from simultaneous active users; no capacity guarantee without representative load evidence.
- Scope: diagnose source and live read-only behavior, document evidence and recommended next steps. No push, merge, deployment, load generation, or production mutation authorized in this task.
- Recorded starting checkout: `/home/codex-alt/projects/leaddrive-v2`, branch `fix/reply-matrix-ai-agent-label`, with existing unrelated modifications and merge conflicts. Preserved untouched.
- Isolated investigation worktree: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-page-load-diagnostic-20261026`, branch `codex/page-load-diagnostic-20261026`, based on freshly fetched `origin/main` `17dc0b81714fea99026eb69686e76abfd4d4cdf8`.
- Origin: `https://github.com/rashadoni/leaddrive-v2.git`. Current `origin/main` AGENTS, registry and deployment docs agree on production `13.140.132.245:/opt/leaddrive-v2`; releases use reviewed main and SHA-bound GitHub Actions artifacts. Older checkout's Hetzner statement is superseded.
- Public build-info reports deployed artifact `1b98cb8060dc88d8b47dc7ded65ddaca507b99fe`, built `2026-10-26T08:37:16Z`; source findings must be checked against that revision.
- First unauthenticated public `/api/v1/ping` sample: HTTP 200, total 0.220 s from development host. This is not a measurement of authenticated page loading.
- Development host preflight: ~12.5 GiB available RAM, 110 GiB disk free, memory pressure avg10=0.00. Heavy verification stays off this host.
- Applying optimize skill: measure first, separate evidence from hypotheses. A parallel read-only source review covers common loading and scalability.
- Next: bounded production resource/log inspection, several sequential public timing samples, then correlate with deployed source. Native authenticated browser capability has not yet been established.


## 2. Bounded live measurements and access limits

- Read-only SSH attempt through the verified `leaddrive-prod` alias failed: `Permission denied (publickey)`. No alternative target/key was used. Production CPU, memory, process count, DB pool/locks and query latency remain unmeasured.
- Sequential public samples from development Contabo, not a load test:
  - `/api/v1/ping`: initial 0.220 s; subsequent samples 2.813 / 0.644 / 1.186 s; later 0.670 s. HTTP 200. Contrary to the stale load-test README, the current handler calls `prisma.organization.count()`, so this is a DB-path readiness request.
  - `/api/auth/session` without cookies: 0.658 / 1.020 / 0.554 s, HTTP 200. These are NOT authenticated session timings.
  - `/login`: 1.166 / 1.227 / 1.749 s, HTTP 200; HTML compressed response ~7.2 KB, decoded ~24.7 KB. Responses pass through Cloudflare; origin-vs-edge latency is not isolated.
  - Anonymous `/dashboard`: HTTP 307 to login, 0.274–0.401 s; not a dashboard loading measurement.
- Production `/sw.js` lists 2,627 precache entries (2,613 JS and 5 CSS). This is a candidate first-install/update amplification factor, NOT proof those requests occurred during the observed warm-cache navigation. No cold-install test was run.

## 3. Native authenticated browser evidence (14:09 Baku)

- Initial uncertainty about native browser availability is superseded: discovered existing Chrome 151 on loopback CDP 9222. Its existing `/companies` page returned HTTP 200 with an actual authenticated session. No cookies, passwords, tokens, session payloads or business records were copied/exported.
- Existing tab was preserved. One temporary background tab in that same real browser/session opened `/companies`, was measured sequentially, and was closed afterwards. No form submission or intentional business-data change was performed. This is a single warm-cache sample in a hidden tab, not a broad benchmark or proof of every route's performance.
- Sanitized timing receipt: `docs/evidence/page-load-20261026-native.json`. It contains timing, generic route paths, response status and byte counts, no response bodies or credentials.
- Fresh navigation: first HTML byte at 2.293 s; HTML response finished at 3.467 s; DOMContentLoaded at 3.535 s; load event at 3.883 s.
- First `/api/auth/session`: started at 3.971 s, completed at 6.009 s (2.037 s duration).
- First companies request: started at 6.072 s, completed at 9.194 s (3.122 s duration). Thus the first data response arrived ~9.2 seconds after navigation. This is a response timing, not a directly observed paint/interactive timestamp.
- A second session request started at 6.079 s and completed at 9.148 s. A second companies request then started at 9.173 s and completed at 14.023 s (4.849 s duration). This matches the companies page's `useEffect(..., [session])` dependency (line 120), which repeats its fetch when the session object changes.
- Shared API requests for preferences, notifications, org settings, voice capabilities, webchat and calls took roughly 1.9–3.4 seconds in this sample; their responses were HTTP 200.
- Navigation decoded body was 2,414,185 bytes; decoded JS resources ~2,019,821 bytes, already cached. The service worker controlled this page, so Resource Timing transfer/encoded sizes must NOT be represented as reliable on-wire byte counts. Response headers show Brotli compression. No assertion that 2.4 MB crossed the wire uncompressed.
- `tableRows=0` is not a no-data claim: this route uses cards. `busyElements=0` is not a proven LCP/INP or complete UI rendering metric.

## 4. Source findings and 1,000-user model

Independent source review confirms these paths match deployed artifact `1b98cb8060dc88d8b47dc7ded65ddaca507b99fe`:

1. `src/components/providers.tsx:33` has no preloaded session; `src/app/(dashboard)/layout.tsx:147` gates child pages on client authentication, with a six-second watchdog. This creates a document/JS -> session -> page data sequence on first opening. Native timing confirms the sequence on companies. Client-side route transitions can behave differently and were not separately benchmarked.
2. Companies `src/app/(dashboard)/companies/page.tsx:105–120` fetches up to 500 records and depends on the whole session object; two actual requests were observed. A stable identity/scoped query dependency can prevent repeats without weakening authentication.
3. Persistent polling in each authenticated visible tab: calls 5 s (`voip-call-provider.tsx:38,75`); bell 10 s (`notification-bell.tsx:184–193`); inbox badge 20 s (`sidebar.tsx:194–201`). At 1,000 such tabs, arithmetic gives 200 + 100 + 50 = **350 requests/second**, before page actions. Tickets at 12 s and enabled webchat at 30 s can add ~83 + ~33 = **~467 requests/second** total. This assumes one visible active tab per user and applicable modules/roles; it is not measured server capacity. Browser throttling, multiple tabs and module mix change actual load.
4. Calls polling has no visibility/module/in-flight gate. Sidebar's inbox badge only consumes `unreadCount`, but its API loads notification records and two counts plus settings (`src/app/api/v1/notifications/route.ts:145–158`).
5. Auth reads fresh user/organization (`src/lib/auth.ts:436`) and identity authority (`:482`). Legacy eligibility uses a RepeatableRead snapshot plus three model reads (`src/lib/identity/legacy-crm-boundary.ts:16–20`); snapshot setup and guard queries are in `mobile-session-resolver.ts:19–29`. API auth repeats a fresh org lookup (`api-auth.ts:269/558`); Prisma RLS adds per-query context transactions (`prisma.ts:168`). These are code-confirmed work amplification; their share of live latency is NOT profiled. Preserve revocation, tenant isolation and policy freshness in any optimization.
6. Authenticated root layout passes all translation namespaces to the client (`src/app/layout.tsx:78,88,111`). Deployed compact UTF-8 catalog sizes: RU 2,262,421 bytes, AZ 1,629,992, EN 1,455,262. These logical sizes precede serialization/HTTP compression. HEAD catalogs are slightly larger; those later sizes are not production evidence.
7. `ecosystem.config.cjs:16–17` configures one PM2 fork. Actual runtime instance count and resources remain unverified because SSH failed.
8. Existing load scripts model 351 mobile users. No verified result demonstrating 1,000 simultaneous CRM users was found. 1,000 registered users by itself is not equivalent to 1,000 active users.

## 5. Recommended next slice and stopping point

- Diagnosis result: a representative authenticated page is slow; sequential session/data loading, repeat page fetches and shared background request fanout are directly evidenced. Runtime root cause behind multi-second server responses (CPU/event loop, DB latency/pool/locks, network/edge) remains unresolved.
- Priority: eliminate repeated data fetches on session refresh; reduce unnecessary/global polling with permissions and visibility preserved; profile and deduplicate auth reads within a single request without changing security semantics; reduce route-irrelevant translation data and cold precache footprint. Measure before/after using the same browser flow.
- Before claiming readiness for 1,000 simultaneous users, use representative isolated staging with real role/module mix, dataset and think times; ramp load and measure p95/p99, error rate, CPU/event-loop delay, DB pool/locks, query latency and background queues. Heavy checks belong on hosted CI/designated ephemeral worker, never this development host or unapproved production load.
- No application code changed; no push, merge, deploy, restart, DB mutation or load test performed.
- NOT RUN: 1,000-user load test (no authorized isolated target, prohibited heavy work on this host); full build/typecheck/full E2E (diagnostics/docs only, host limits); production CPU/DB profiling (SSH public-key refusal); cold-browser/service-worker installation benchmark (would introduce much larger request load).
- Current stopping point: bounded live/browser/source diagnosis completed; task-owned journal and sanitized evidence prepared for checkpoint. Next action: targeted performance implementation plus renewed runtime profiling access, followed by before/after and staged capacity testing.


## 6. Evidence review and checkpoint

- Independent review found one wording error in section 3: **"already cached" and "warm-cache sample" are superseded** by "existing browser profile; actual per-resource cache provenance unverified." Zero JS transfer bytes under a service worker do not prove a cache hit. The receipt preserves its initial label as metadata and carries the corrected kind/caveat. No cold profile was created.
- Earlier "no DB mutation" means no intentional database command, business form submission or settings edit. Ordinary application/session/background behavior during a normal page opening was not suppressed or audited for every server-side effect.
- Source equality for companies, root layout, identity boundary/snapshot, auth, API auth and Prisma was rechecked against the deployed SHA: no diff.
- Checks PASS: staged `git diff --cached --check`; sanitized evidence JSON parse; native temporary tab closed and original `/companies` tab retained. Only the journal and sanitized timing JSON are staged.
- Final state: diagnosis completed, application source unchanged, checkpoint prepared on `codex/page-load-diagnostic-20261026`; no push/deployment. Next action is the targeted performance slice described above, with before/after measurements and a separately provisioned capacity gate.


## 7. Implementation authorized; diagnosis-first correction (2026-10-26)

- User challenged whether the proposed changes are the right solution. Clarified that repeated fetching does not by itself explain the first 9.2 seconds; background request arithmetic is not a capacity test. Revised order: localize server latency first, fix the evidenced bottleneck, repeat matching browser measurements, then isolated capacity verification.
- User then instructed: «займись». Continuing investigation and targeted implementation in the original worktree/branch. Prior diagnosis-only scope is superseded for source fixes; no new push/merge/deployment authorization has been inferred.
- Resumed from checkpoint `ebf0be1d9`; refreshed current origin/main and incorporated it without rewriting prior history. Production public artifact changed independently to `67a7920b482d3b9d180cb9c9d00b959436eb2ff5`, built 2026-10-26T10:04:45Z. Remeasure before comparing any change.
- `leaddrive-prod` again rejected its configured dedicated key. Exploring documented existing inspection routes without copying credentials or changing authentication. App has no general admin resource-metrics endpoint in inspected source.
- Parallel read-only review is tracing duplicate auth work across proxy and API handlers, with immediate revocation/tenant/RLS semantics preserved. No auth removal or cross-request caching is approved as an optimization shortcut.
- Preflight: ~12.6 GiB available RAM, 110 GiB disk free, memory pressure avg10=0.00. Checks remain sequential and bounded.


## 8. Access checks and invalidated measurement (14:41 Baku)

- Verified configured dedicated production key is offered to the registered host but rejected. Local administrative root has no separate `leaddrive-prod` SSH configuration; did not try default root keys or another production destination.
- User asked «как восстановить». Supplied additive authorized_keys command for the exact configured public key, to execute in the registered production host console/existing authorized SSH. Private key was never read into output, copied or requested. Awaiting user's completion.
- Paired lightweight browser probes were run sequentially against health/ping/session with credentials included vs omitted. However **all session responses reported authenticated=false**, so the old Chrome session is no longer valid. The attempted auth comparison is INVALID and cannot attribute latency to auth or claim an improvement. Sanitized samples and explicit caveat saved in `docs/evidence/page-load-20261026-anonymous-pairs.json`. Current anonymous responses were 34–159 ms; different time/build/session conditions from earlier timings prevent before/after claims.
- Source confirms proxy and route each resolve full DB-backed auth. This remains a candidate amplified cost, not a measured dominant bottleneck. No permission/auth freshness shortcut will be introduced.
- While waiting for metrics access, preparing the separately evidenced duplicate companies-fetch correction only. It does not claim to fix the unexplained server delay. Parallel agent owns that narrow source edit; root owns diagnostics and journal.


## 9. Narrow fix prepared; user requests Claude access-restoration prompt

- User said they cannot operate the server console and requested that Codex either restore access itself or provide a ready prompt for Claude. No working alternate production administrator connection is available here; preparing an inline prompt for Claude to restore ONLY the configured public key on registered production, verify from the Codex host, and report read-only runtime metrics. No claim that a message was sent to Claude.
- Prepared source fix in `src/app/(dashboard)/companies/page.tsx`: fetch callback depends on stable organization; effect depends on callback, user ID and role instead of the entire rotating session object. Effect-owned fetch is aborted on identity change/unmount and late aborted responses are ignored. Explicit refresh after successful edits remains intact. Auth, proxy, RLS, schema, polling and deployment are unchanged.
- Updated the existing session-dependency regression ratchet by removing only companies from grandfathered exceptions. This fixes an observed duplicate-fetch mechanism, NOT the as-yet unexplained server latency.
- Host preflight before verification: ~12.6 GiB available RAM, no memory pressure. Shared dependency tree package-lock SHA256 exactly matches this worktree; a temporary task-owned node_modules symlink was used, without install or dependency edits.
- PASS: targeted `no-session-object-in-effect-deps.test.ts`, 3 tests, one worker, 2.05 seconds. This is a source regression guard; it is not a browser timing proof.
- NOT RUN: full build/typecheck/full browser E2E (host workload rules; hosted gate needed before release); authenticated before/after browser comparison (native session is now unauthenticated and fix is not deployed); production metrics (key rejected); capacity test (no isolated authorized target).
- Stopping point: checkpoint the narrow fix and diagnostic evidence, give user the requested Claude prompt for restoring the existing production SSH access. Next: verify restored access, measure CPU/event loop/database/pool and current authenticated request timings before selecting any deeper optimization. No push/merge/deployment performed.

- Targeted ESLint returned FAILED: 4 pre-existing no-explicit-any errors and 8 existing unused-variable warnings. Running ESLint on the unchanged HEAD version reproduced the same 4 errors/8 warnings; the fix adds no new lint findings. Unrelated cleanup was not included. `git diff --check` PASS.
- Temporary task-owned node_modules symlink removed after sequential verification; shared dependency directory preserved.

- Correction after inspecting the complete baseline lint output: unchanged HEAD has **4 errors / 9 warnings**, current fix has **4 errors / 8 warnings**. The previous "same 4 errors/8 warnings" statement is superseded: the effect-dependency warning is removed; the existing any errors remain.
- Narrow fix and anonymous diagnostic evidence checkpoint: `2332fb947`. Application build/typecheck and authenticated before/after remain NOT RUN for the reasons above. Working branch retained; nothing published or deployed.


## 10. Production access restored; runtime diagnosis resumed (14:57 Baku)

- User supplied screenshot of Claude reporting that the configured key was added and a new connection from Codex succeeded. Independently verified with ControlMaster=no / ControlPath=none: registered `leaddrive-prod` host responds as `vmi3554743`. Earlier SSH blocker is resolved.
- Resumed existing worktree/branch and saved checkpoint; production is still only `13.140.132.245:/opt/leaddrive-v2`, release only through reviewed main/GitHub Actions. Current public artifact changed independently to `17dc0b81714fea99026eb69686e76abfd4d4cdf8`, built 2026-10-26T10:28:43Z.
- Initial current production snapshot: ~9.7 GiB available out of ~12 GiB RAM, no swap, 163 GiB disk free, load ~0.94, memory pressure zero. `ps` shows Next server lifetime average ~47% of one CPU; this is not a current CPU sample. No inference that an idle whole host proves an idle Node event loop.
- Continuing read-only PM2/event-loop, process CPU and PostgreSQL aggregate checks. No database logging/extension/settings changes, no restarts and no deployment authorized or performed as part of this diagnosis.


## 11. Bounded production CPU profile and pre-query Prisma cost

- SSH access independently verified with a fresh non-multiplexed connection. Production stays at registered `13.140.132.245:/opt/leaddrive-v2`; branch/worktree unchanged. This supersedes the access blocker in sections 5–9.
- PM2: one Next fork (PID 140149, no restarts in this snapshot); heap ~453/545 MiB, event-loop p95 ~70.75 ms, HTTP p95 ~1,977 ms. Five-second pidstat averaged ~150% of one CPU (V8 threads included); this is a brief burst, not proof of sustained whole-host saturation.
- PostgreSQL: ~28 app connections, including 5 idle-in-transaction; no blocked sessions or deadlocks in the snapshot. No pg_stat_statements preload/extension or slow-query logging. These facts do NOT rule out intermittent DB/pool latency. No DB settings were changed. Nginx last-five-minute sample: 267 requests (~0.89/s), mostly background calls/notifications/ticket/webchat polling; not an active-page benchmark.
- Existing error-log sample includes Prisma P2028 interactive-transaction expiration at 5–6.8 seconds, with MTM agent/location model names. Cannot attribute these entries to the observed companies-page load or auth just from adjacent bundled stack frames.
- Collected a 10-second auto-stopping CPU profile using PM2's existing inspector action, without restart or code/config/DB mutation. Root-only server artifact `/tmp/leaddrive-page-load-20261026.cpuprofile`; no heap dump or secret values collected. 6,171 samples over ~10.702 s: idle ~63.1%, GC ~6.1%; initial profiler dispatch ~0.70 s is measurement overhead. The hottest application self frame repeatedly lands in Prisma 6.19.2 `applyFluent` metadata reduction (~1.18 s across its stacks), including identity/org permission paths.
- Runtime `applyFluent` constructs a model field map on each fluent method access with `fields.reduce((map, field) => ({ ...map, [field.name]: field }), {})`. Re-copying all preceding fields is quadratic. Official matching source: https://raw.githubusercontent.com/prisma/prisma/6.19.2/packages/client/src/runtime/core/model/applyFluent.ts .
- Bounded isolated production Node benchmark (dummy datasource, no DB connections/queries, three getter accesses/model): Organization has 536 runtime fields; `organization.findFirst` costs 55.073 ms first / 26.919 / 25.382 ms warm. User 143 fields ~0.8 ms warm; Company 47 ~0.06–0.20 ms; IdentityAccount 17 ~0.01 ms. This proves avoidable synchronous pre-query CPU work. It does NOT alone explain a 9.2-second page or certify capacity.
- Next implementation plan (safety lane): reproduce on isolated copies; replace only quadratic field-map construction with a semantically equivalent linear construction, guarded against unexpected Prisma versions/source; preserve auth, tenant/RLS, transaction and query semantics; test actual runtime/fluent relation behavior and fail-closed patching. Independent agent reviewing the approach. No direct production patching or shared dependency mutation.
- Additional regression coverage for companies page now prepared: actual React component test covers stable session refresh, user/org/role switch abort/late-response handling, and manual refresh after save. Sequential Vitest run PASS: 2 files / 8 tests (~4 s). Full build/typecheck and authenticated live before/after remain NOT RUN, respectively host limits and no deployed fix/current browser session expired.
- Shared generated Prisma client is not a reliable schema fixture: its index currently says 6.19.3/from another worktree, while installed runtime/package lock is 6.19.2. No shared files modified; runtime remediation tests must construct/copy their own isolated fixture.


## 12. Prisma remediation prepared on the feature branch

- Official 6.19.3 source still uses the same quadratic field-map construction; a 6.x patch upgrade alone does not remove this measured cost. Source: https://raw.githubusercontent.com/prisma/prisma/6.19.3/packages/client/src/runtime/core/model/applyFluent.ts . No dependency upgrade or schema migration included.
- Added `scripts/ci/patch-prisma-fluent-field-map.mjs`: exact Prisma 6.19.2/source guard; linear `Object.fromEntries` map preserving field references/own properties; CommonJS + ESM library runtime coverage; all validation before writes; isolated-install/CI guard; read-only `--check` for assembled artifacts. No app auth, query, transaction or policy code changed.
- CI PR production build and deployment build now apply the patch after install/generate and before compilation. Deployment checks both runtime files after artifact assembly. Historical recovery source commits without this script keep their original runtime behavior; the patch is not borrowed from a newer workflow commit.
- Bounded benchmark on development host, isolated copies of the actual runtime, synthetic 536-field Organization, 3 warmups and 25 getter samples each: original median 17.562522 ms, patched median 0.208366 ms (~84x for this method-construction operation). No query called and zero DB connections. Shared runtime hashes unchanged. Receipt: `docs/evidence/page-load-20261026-prisma-getter-benchmark.json`. This is NOT a page-level speedup or a 1,000-user capacity result.
- PASS: runner policy (87 workflows), event-platform asset/build contract checks (27 domains, 86 topics, 5 schemas); companies runtime regression test ESLint; scoped diff whitespace check. New Prisma behavior/safeguard tests being finalized on copies only. Full build/typecheck remain NOT RUN on this development host by workload rules.
- Companies runtime test and diagnostic checkpoint: `aeb89762e`; earlier implementation checkpoint remains `2332fb947`.
- Public artifact independently advanced to `c7d39d2b32b64ec09d30b6b4f8e6811f2fdf173d`, built 2026-10-26T10:46:07Z. None of this task's fixes is deployed. A new native-browser session probe returned authenticated=false (HTTP200, ~41 ms); do not use it as authenticated before/after evidence.
- Next: complete bounded behavioral/parity tests and source review, checkpoint the Prisma patch, then obtain the active-task publication/release authorization required by the user's host contract before PR/CI/release. Authenticated page comparison additionally needs a renewed real native-browser session.


## 13. Verification and release boundary

- PASS: isolated Prisma patch suite, 1 file / 20 tests / 3.33 s, one worker. Both original and patched CommonJS/ESM runtimes satisfy the same lazy-query, nested-relation, query/result-extension, batch/interactive-transaction, rollback/error and field-map property contracts. Network is explicitly forbidden and DB/transaction transport mocked; this is runtime/serialization compatibility evidence, not a live-DB integration test.
- PASS: strict version/source safeguards; validate both files before any write; local/CI guard; escaping symlink and multiply-linked inode refusal; idempotence; read-only artifact check; current workflow ordering. Shared installed runtime hashes preserved.
- PASS: scoped ESLint for the new patch and both new test files; Node syntax check; git diff whitespace check. Earlier existing companies-page lint errors remain baseline-only (4 any errors, 8 warnings after the fix).
- Total targeted Vitest coverage for this slice: 28 passing tests across 3 files (companies runtime/source guards + Prisma patch runtime/safeguards), run sequentially in bounded invocations. No full suite/build/typecheck run on Contabo.
- NOT RUN: full TypeScript check and production build (must use hosted CI/ephemeral worker); live DB integration with patched client (no production patch/deploy); authenticated page before/after (fix not deployed and actual browser session expired); 1,000-user load (no isolated authorized target). The PR will require the `production-build` label as well as normal required checks.
- Current result: two source fixes prepared—avoid repeated companies loads on stable session refresh, and remove the CPU-profiled quadratic Prisma field-map work. These are not yet production improvements. No push, PR, merge, deploy, restart, DB configuration change or production load test performed.
- Precise stopping boundary: checkpoint and final review of the prepared feature branch; publication/release needs active-task authorization under the user's host contract ("Push, merge and production deploy require authorization for the active task"). Next: authorized PR + hosted CI/build, release through reviewed main, then actual production measurements with a renewed authenticated browser session.


## 14. Final artifact-packaging review correction

- Prisma optimization checkpoint: `4432a4e1f`. Independent final review found existing `cp -r source destination` behavior nests another `@prisma` / `.prisma` directory if Next already traced those destinations. Current production read-only existence check confirms both direct and nested copies exist; direct library.mjs also exists today, so this was not observed as today's missing-file failure.
- Correcting the two assembly commands to copy directory contents (`source/.` into explicitly created destination directories). This ensures patched runtime and generated-client files occupy the actual import paths regardless of tracing coverage. New artifact verification remains fail-closed. No production file changed.
- Adding an executable packaging regression using the actual workflow commands with pre-existing traced destination directories, then rerunning only affected focused checks before the final checkpoint.

- Final packaging regression PASS with original/patched runtime suite: 21 tests / 3.20 s, one worker. Together with the 8 companies tests, current targeted coverage is **29 passing tests**; the earlier 28-test count is superseded by the added packaging case. Rechecked affected-file ESLint, runner policy, event-platform assets and parsed both workflow YAMLs: PASS.
- Independent final review found no remaining correctness blocker. Known maintenance limit: the private runtime patch is exactly version/source-bound; minified runtime source maps are not rewritten, so mapped columns after the changed expression can be imprecise. No schema/data/auth behavior is intentionally altered.
- Task-owned temporary node_modules symlink will be removed after verification; the shared installation and all unrelated worktrees stay untouched. Fixes remain unpublished, pending active-task authorization for GitHub/CI/release.


## 15. Checkpoint and explicit publication question

- Final implementation checkpoint `a75f64409` includes the verified direct-path Prisma assembly fix; Prisma optimization checkpoint `4432a4e1f`; companies fix `2332fb947` and lifecycle coverage `aeb89762e`. Working tree clean after committing task-owned paths. Temporary task-owned node_modules symlink removed, shared dependencies preserved.
- Asked user through the in-chat question whether to publish the prepared branch, run complete hosted CI and release through normal GitHub Actions only after successful checks, or allow GitHub/CI without release. Explained the exact user-provided active-task authorization rule. Awaiting answer; elapsed time is not authorization.
- Status: prepared and locally verified targeted fixes, not deployed. Last completed action: checkpoint/cleanup after 29 passing targeted tests and narrow build-contract checks. Stopping point: before push/PR/hosted CI/release. Next action: follow user's publication scope; for release, require green normal gates plus production-build, then remeasure the live application. Actual authenticated page timing still requires renewed native-browser login. Read-only production SSH access is restored; no further access-restoration prompt is needed.
