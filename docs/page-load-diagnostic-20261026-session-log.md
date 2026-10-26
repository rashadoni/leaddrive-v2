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
