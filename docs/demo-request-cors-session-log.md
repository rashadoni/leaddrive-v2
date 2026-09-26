# Demo request CORS — session log

Append-only continuity journal for the marketing-site demo-request CORS repair.

## 2026-09-26 — task start and ordered plan

- User-visible defect confirmed by a safe preflight probe: the static marketing
  site submits JSON from `https://leaddrivecrm.org` to
  `https://app.leaddrivecrm.org/api/v1/public/demo-requests`, but the API did
  not return CORS headers. No real demo request was sent during diagnosis.
- Repository routing resolved from current `origin/main` and repository docs:
  root `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-demo-request-cors`,
  branch `codex/demo-request-cors`, origin
  `https://github.com/rashadoni/leaddrive-v2.git`, production
  `13.140.132.245:/opt/leaddrive-v2`, release path reviewed PR -> protected
  `main` -> `.github/workflows/deploy.yml`.
- Scope is safety-lane because this is a public write endpoint. No schema,
  migration, production mutation, merge, or deploy is part of this subtask.

Ordered implementation sequence:

1. Define one exact allowlist for the canonical marketing origin
   `https://leaddrivecrm.org` and the temporary aliases
   `https://www.leaddrivecrm.org` and `https://new.leaddrivecrm.org`.
2. Add an explicit `OPTIONS` response with `POST, OPTIONS`, `Content-Type`,
   `Vary: Origin`, and a bounded preflight cache lifetime.
3. Apply the allowed origin header to every `POST` response path: malformed
   JSON, validation rejection, honeypot success, persistence failure, and
   persisted success. Never reflect an unlisted origin.
4. Apply the same policy to the middleware's early `429` response for the
   exact public demo-request path, before the route handler can run.
5. Add focused behavior tests for allowed and disallowed preflights, the POST
   outcome matrix, and the middleware `429` boundary.
6. Run only targeted checks on Contabo after checking host pressure; leave full
   build/typecheck to GitHub CI per the host contract.
7. Inspect the exact diff, append evidence here, commit only task-owned paths,
   push the feature branch, and open a draft PR. Do not merge or deploy.

## 2026-09-26 — implementation and local verification

- Added one shared exact-origin policy. Allowed origins are only
  `https://leaddrivecrm.org`, `https://www.leaddrivecrm.org`, and
  `https://new.leaddrivecrm.org`; there is no wildcard or substring matching.
- Added explicit `OPTIONS` handling with status 204,
  `Access-Control-Allow-Methods: POST, OPTIONS`,
  `Access-Control-Allow-Headers: Content-Type`, `Vary: Origin`, and
  `Access-Control-Max-Age: 86400`.
- Every demo-request `POST` response now goes through the same policy, including
  malformed JSON, validation rejection, honeypot success, persistence failure,
  and success. Requests with no Origin or an unlisted Origin receive no
  `Access-Control-Allow-Origin` header and still receive `Vary: Origin`.
- The exact demo-request paths receive the same origin decision on the
  middleware's early rate-limit `429`, before the route handler runs.
- The legacy `/api/v1/demo-request` alias now re-exports `OPTIONS` as well as
  `POST`, preserving equivalent behavior for old clients.

Host preflight before checks:

- 23 GiB RAM total, 15 GiB available; memory PSI `avg10=0.00`.
- Worktree filesystem had 331 GiB available (43% used).
- Reused an ignored `node_modules` symlink from a worktree whose
  `package-lock.json` SHA-256 exactly matched this worktree; no install was run.

Checks run in this worktree:

- PASS — `vitest run src/__tests__/api-demo-requests-cors.test.ts --maxWorkers=1`:
  11/11 tests.
- PASS — `vitest run src/__tests__/lib-middleware.test.ts --maxWorkers=1`:
  109/109 tests.
- PASS — `vitest run src/__tests__/api-misc-entities.test.ts --maxWorkers=1 -t 'Demo Request'`:
  2/2 selected tests; 29 intentionally skipped by the name filter.
- PASS — scoped ESLint for the new helper, public route, legacy alias, and new
  focused test.
- `git diff --check`: PASS.
- Full typecheck/build: NOT RUN locally because the repository documents a
  roughly 12 GiB type graph and the Contabo host contract sends heavy gates to
  GitHub CI.
- A diagnostic lint invocation that included the entire pre-existing
  `src/proxy.ts` and `src/__tests__/lib-middleware.test.ts` reported 13 existing
  `no-explicit-any` / `no-unsafe-function-type` findings, all outside this
  diff. The newly added lines and the scoped files are clean.

Stopping point after this phase: implementation and focused local checks are
complete. Next action is an exact-path checkpoint commit, feature-branch push,
and draft pull request; merge and deployment remain explicitly out of scope.

## 2026-09-26 — checkpoint and pull request

- Implementation checkpoint: `398e5fece` (`fix: allow marketing demo request CORS`).
- Feature branch `codex/demo-request-cors` was pushed to the active GitHub
  repository.
- Draft pull request opened: https://github.com/rashadoni/leaddrive-v2/pull/448
- No merge and no production deployment were performed.

Current stopping point: the requested independent CORS repair is implemented,
locally verified, pushed, and awaiting GitHub PR checks/review in draft PR #448.
The next action belongs to the coordinating task: decide when to mark the PR
ready and continue its own release sequence. This subtask must not merge or
deploy it.
