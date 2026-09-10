# CI cost policy

## Current state (2026-09-09)

The repository moved to the public GitHub account `rashadoni/leaddrive-v2`.
GitHub is now the single source of code, pull requests, CI and production
delivery. Everything below about the Contabo self-hosted pool and the Azure
DevOps pipelines is **retained as history, not as instructions** — that
capacity is retired.

Current routing, enforced by `scripts/ci/check-github-runner-policy.mjs`:

| Work | Runner |
|---|---|
| Every standard build, test and check | `ubuntu-24.04` (GitHub-hosted, free on a public repository) |
| PBX control-plane cutover only | `[self-hosted, fanum-pbx-vpn]` |
| Native macOS/iOS, **if one ever exists** | `[self-hosted, macOS, ARM64, leaddrive-mac-local]` on the owner's physical Mac |

`runs-on: macos-*` is prohibited outright, and `ubuntu-latest` is rejected in
favour of the pinned `ubuntu-24.04`. The repository has no Swift/Xcode target as
of this date, so no Mac runner is registered.

The billing history below is why the macOS ban is absolute: it is what the old
arrangement actually cost.

## Why this document exists

The authenticated account billing page was checked on 2026-09-08 for September
1–30. These are month-to-date account charges, not a forecast or a measurement
of this repository alone:

| Product | Quantity | Billed |
|---|---:|---:|
| Actions Linux | 11,389 min | $36.76 |
| Actions macOS 3-core | 1,560.1 min | $84.41 |
| Actions storage | 780.31 GB-hour | $0.00 |
| Git LFS storage | 104.04 GB-hour | $0.00 |

Total billed: **$121.17**. The Actions budget was $100 with **Stop usage = No**:
the warning did not stop jobs or prevent further charges. Gross usage before
included credits is different from the billed column. macOS accounted for
$84.41 of the billed total; no new macOS usage was shown for September 7–8.

## Where the macOS minutes come from

`.github/workflows/pr-checks.yml` previously ran `typecheck` on `macos-15-intel`
(confirmed in run 33996882712 on September 5). It now uses the dedicated
self-hosted Linux runner. The project type graph needs roughly
12 GiB; private-repository Ubuntu runners provide 8 GiB, and the job was
terminating there with exit 143 — which skipped the blocking gates and let a
broken tree look green. `CLAUDE.md` records what that costs: a crashed compiler
prints an empty log, `grep -c 'error TS'` reports zero, and zero is
indistinguishable from a clean run. PR #1056 published "tsc --noEmit: 0 errors"
and was contradicted by its own run the same day.

What was never deliberate is how *often* it ran. `pull_request` fires
`synchronize` on every push, so a branch with a dozen checkpoint commits paid for
a dozen macOS runs. With several agents pushing in parallel — 81 `pull_request`
events in 24 hours — the allowance was gone before noon.

## Where the storage goes

Minutes are a flow; storage is a stock. That difference is what made the alert
of 2026-09-10 confusing — GitHub reported 100% of the Actions storage allowance
consumed on an account that had not built anything for two days.

Every production release uploads `leaddrive-prod-<sha>.tar.gz`, roughly 400 MB,
and it stays for its `retention-days` whether or not anyone touches the
repository again. What was measured on 2026-09-10:

| Account | Live artifacts (all repos) | Period |
|---|---:|---|
| `rashadrahimov` (pre-migration) | 16.7 GB / 449 — of which `leaddrive-v2` 15.0 GB / 349 | Aug 11 – Sep 8 |
| `rashadoni` (post-migration) | 13.3 GB / 33, all `leaddrive-v2` releases | Sep 9 – Sep 10 |

The included allowance is 2 GB; the overage rate is $0.25 per GB-month. The old
account had simply stopped emptying. The new one was filling at ~7.6 GB/day —
nineteen releases a day, because several agent sessions merge in parallel — and
at thirty days' retention that converges on ~230 GB, or roughly $57/month to
retain build output nobody reads.

**A rollback horizon must be counted in releases, not in days.** Days looked
safe when a release was a daily event; it is not a bound at all when the release
rate is set by other people's merges. The `artifact_retention` job in
`deploy.yml` keeps the newest twenty and deletes the rest after every successful
deploy, so the shelf holds ~8 GB no matter how busy the day was. The horizon is
also not the only one: `scripts/server-deploy.sh` keeps `MAX_BACKUPS=5`
unpacked releases on production itself, and a rollback to those never reaches
GitHub.

One billing subtlety worth knowing before deleting anything in a panic: storage
is billed in GB-hours already accrued. Deleting frees the shelf going forward,
but does not remove what the current cycle has already counted.

## The rules

1. **Iterate in draft.** Both `static-checks` and `typecheck` skip draft pull requests. Mark the
   PR ready for review once the branch is finished; `ready_for_review` fires and
   the gate runs before the merge it exists to guard. Nothing is weakened — only
   the intermediate pushes stop being billed. Do not mark a PR ready to "trigger
   CI" and then keep pushing.
2. **Documentation is free.** `**/*.md`, `docs/**` and `.agents/**` no longer
   start `pr-checks.yml` at all. Do not add a code change to a docs PR to make
   CI run.
3. **No new macOS jobs, and pin the Linux image.** `runs-on: macos-*` is
   rejected by `scripts/ci/check-github-runner-policy.mjs`, and so is any
   GitHub-hosted Linux image other than the pinned `ubuntu-24.04`. If a job
   needs more than the standard runner, raise it with the owner.
4. **New `pull_request` workflows need two guards**: a `paths:` filter narrower
   than the whole repository, and a `concurrency:` group with
   `cancel-in-progress: true`. `social-monitoring-queue-e2e.yml` and
   `tenant-delete-cascade-recovery.yml` had the first but not the second, so
   superseded pushes kept paid runners busy until they finished on their own.
5. **Do not remove these guards** to make a check run sooner. If a gate is in the
   way, say so and ask.
6. **Bound artifact retention by count, not by calendar.** Anything that uploads
   a large artifact on every merge must have a keeper that trims it to the
   newest N; `retention-days` alone is a ceiling for an idle repository, not a
   bound for a busy one. Raising N is a one-digit change — silently widening it
   to "30 days" is not.

## What is deliberately not done

- **The typecheck was not moved back to Ubuntu.** It would resume dying at 8 GiB,
  and the empty-log failure mode above is worse than the bill.
- **No gate was relaxed.** `check-typecheck-gate.sh`,
  `check-typecheck-baseline.mjs`, `check-test-baseline.mjs` and
  `lint:pii-columns` block exactly as they did before.
- **The typecheck moved to a self-hosted runner, on a dedicated box.** It was
  first rejected because the obvious host, `remote-dev`, holds SSH keys reaching
  production and a GitHub token; executing pull-request code there would be a
  privilege escalation. The adopted design removes that objection instead of
  accepting it: a separate Contabo Cloud VPS 8 (`vmi3560127`, 8 vCPU, 24 GiB RAM,
  8 GiB swap, Ubuntu 24.04) that runs nothing else, with three runners under an
  unprivileged `ghrunner` account (no sudo; in the `docker` group only so
  `services:` blocks work). No production key, token or database lives on that
  host. Self-hosted minutes are not metered, so the job's cost is the VPS
  itself (~EUR 16.52/month) rather than ~$77 of macOS minutes.

## Self-hosted runners (historical — Contabo pool, retired 2026-09-09)

> Retired. The pool below was decommissioned when the repository returned to
> public GitHub; its labels are now rejected by the runner-policy check. Kept
> for the measurements and the reasoning, which still explain why jobs are
> shaped the way they are.


| Runner | Labels | Purpose |
|---|---|---|
| `leaddrive-ci-1` | `self-hosted, linux, x64, leaddrive-typecheck` | the only runner allowed to compile the type graph; nothing else |
| `leaddrive-ci-2` | `self-hosted, linux, x64, leaddrive-ci` | general Linux jobs |
| `leaddrive-ci-3` | `self-hosted, linux, x64, leaddrive-ci` | general Linux jobs |
| `leaddrive-ci-4` | `self-hosted, linux, x64, leaddrive-ci-light` | short agent reviews and secret scans only |

The fourth runner is deliberately **not** another full-test slot. On
2026-09-08 it was online with no workload label while the two general runners
and the typecheck runner were busy. Reuse it for `agent-review` and `scan`,
which need no dependency installation, Prisma generation or test workers.
This keeps the mandatory review available while tests queue. Their default
checkout cleanup also stays in runner 4's workspace instead of deleting the
general runners' saved dependencies. Other full-test workflows can still
invalidate a general runner's warm workspace; this split does not guarantee
cache hits for every job.

Provision `leaddrive-ci-light` on the existing runner 4 before deploying these
workflow routes. Never add `leaddrive-ci` or `leaddrive-typecheck` to that
runner to fill an idle slot. The pool remains two general test jobs, one
typecheck and one short job; no additional server or hosted minutes are added.

`leaddrive-typecheck` exists on exactly one runner on purpose: a 12 GiB compile
must never share the 24 GiB box with a second one. Do not add that label to
another runner, and do not point two jobs that need more than ~8 GiB at it.
`leaddrive-ci-1` deliberately does *not* carry `leaddrive-ci`, so a general job
can never occupy it while a typecheck waits. The current pool has two general
jobs and one short job alongside it. More registered runners do not create
more CPU or RAM; measure the simultaneous peak before changing this pool.

### CPU and I/O are not budgeted — and it shows

The paragraph above budgets memory. Nothing budgets the 8 vCPU or the VPS
disk, and on 2026-09-07 that produced two "flaky" failures in one afternoon on
two unrelated files, each reported as an opaque `Error: STACK_TRACE_ERROR` and
each "fixed" by re-running. Root cause, measured:

| test | idle | on the box, with a typecheck beside it | limit it hit |
|---|---|---|---|
| `no-session-object-in-effect-deps` (reads every file under `src/`) | 0.95 s | >5 s | default 5 s |
| `voice-realtime-section-eval` | 3.06 s | >15 s | its own 15 s |

That is at least a 5× slowdown when `typecheck` (one core at 100 % plus
12 GiB of heap churn) shares the host with `static-checks` (four vitest
workers, a Postgres service container and 1,455 test files) and, on a busy
afternoon, a second PR's `static-checks`. Disk contention compounds it: three
jobs restoring `node_modules` caches and one test walking the whole source
tree share one VPS volume.

Why it looked like a crash rather than a timeout: vitest's runner builds the
timeout error's *message* ("Test timed out in 5000ms") but replaces its
*stack* with a placeholder `STACK_TRACE_ERROR` captured at `it()` time, and the
JSON reporter emits `stack || message`. The message is lost before it reaches
the report. `scripts/check-test-baseline.mjs` now recognises that exact shape
and prints `⏱ TIMEOUT … ran Nms` instead of the raw placeholder, so the next
one is read as slowness, not as a framework bug.

What was changed and what was not:

- `vitest.config.ts` sets `testTimeout`/`hookTimeout` to 30 s. A hang is still
  caught; a 3 s test running 5× slower is not failed. Per-test limits on known
  slow tests are sized the same way (the voice eval: 45 s).
- `VITEST_MAX_WORKERS` stays at 4 and the runner layout stays as it is. Fewer
  workers trade flakes for a slower suite, which is the complaint that started
  this; a slower suite on a box that is still oversubscribed helps nobody.
- Not changed, but the honest lever: the typecheck should not share cores with
  the test jobs. Either a second small VPS for the general runners, or a
  larger one for this pool, or `needs: typecheck` on `static-checks` (serial,
  ~+15 min per PR). Each costs either money or latency; that choice belongs
  to the owner, and the numbers above are what it should be made from.

Reading a red `static-checks` on this box: if the failing test's report starts
with `Error: STACK_TRACE_ERROR` and the gate prints `⏱ TIMEOUT`, look at the
`ran Nms` figure and at what else was running on `vmi3560127` at that minute
before touching the test.

The runners are systemd services (`actions.runner.rashadrahimov-leaddrive-v2.*`)
installed from `/home/ghrunner/runner-{1,2,3,4}`; they survive reboots. The
pre-existing `devbox-leaddrive-builder` runner (label `leaddrive-builder`) is a
different host and is not part of this pool.

Rules for workflows:

- `typecheck` uses `runs-on: [self-hosted, linux, x64, leaddrive-typecheck]`.
  Do not move it back to `macos-*`; do not relabel it.
- Full-test `pull_request` Linux jobs run on `leaddrive-ci`:
  `static-checks`, `social-regressions`, `queue-e2e` and
  `postgres-integration`. The Pro plan's 3,000 included minutes were gone on
  the first day of September, after which every one of those runs was paid
  Linux time (9,549 minutes, $26 in five days). `agent-review` and `scan`
  (gitleaks) use `leaddrive-ci-light`; dependency installs, Prisma generation,
  tests and builds must not use that label. New full-test `pull_request` jobs
  use `runs-on: [self-hosted, linux, x64, leaddrive-ci]`, not `ubuntu-latest`.
- Jobs that need `services:` (Postgres etc.) may target `leaddrive-ci`; Docker
  is present. Jobs that need tools from the `ubuntu-latest` image that are not
  on the box must install them in a step — the box is deliberately minimal.
  Preinstalled on the host: git, curl, python3, psql 16, Docker, and the
  shared libraries Chromium needs (`playwright install-deps chromium`, run once
  as root). There is no system Node; use `actions/setup-node`.
- **The runners share one host, so nothing in a job may claim a fixed port or
  a fixed `/tmp` path.** Publish service ports as `- 5432` (no host side) and
  read the port back through `job.services.<id>.ports['5432']` in a step that
  writes it to `$GITHUB_ENV`; job-level `env` cannot see `job.services`. An app
  under test binds a free port (`python3 -c 'import socket; …'`), and scratch
  files go under `$RUNNER_TEMP`, which the runner clears per job. Two jobs
  both publishing `5432:5432` make the second fail to start; two `next dev`
  on port 3000 race each other. The three Postgres-backed workflows are the
  reference implementation.
- `--with-deps` (Playwright) and anything else that needs `sudo`/`apt` does not
  work: the runner user has no sudo. Ask for the dependency to be installed on
  the host instead.
- **The box's one advantage over a hosted runner is a disk that persists
  between jobs — use it, and do not put `actions/cache` on these jobs.**
  Measured 2026-09-08 on `leaddrive-ci-1`: restoring `node_modules` from the
  GitHub cache service took 106 s and `prisma generate` (545 models) 198 s of
  a 12.6-minute typecheck, every run, for an identical lockfile and schema;
  `tsc` itself ran 7–15 min cold because `actions/checkout` deleted the
  incremental build info with everything else. `static-checks` and
  `typecheck` now check out with `clean: false`, run
  `git clean -ffdx -e node_modules` (plus `-e tsconfig.tsbuildinfo` for the
  typecheck) themselves, and install through
  `scripts/ci/self-hosted-warm-install.sh`, which re-runs `npm ci` and
  `prisma generate` only when the lockfile, package manifest, npm config,
  runtime/platform/architecture, npm version, schema or Prisma version changed
  (input hashes in a marker inside the directory they describe). Failed
  commands invalidate the marker. `tsc` retains its incremental build info and
  relies on TypeScript's own source/options/version invalidation; this is not
  a fresh compiler run. A
  new self-hosted job follows the same pattern; a hosted job must not — those
  start empty by design, and the script refuses to run there.
- What stays on GitHub-hosted runners, on purpose: the label-gated
  `production-build` proof in `pr-checks.yml` and `deploy.yml` entirely. The
  contract test pins the build to a bounded GitHub-hosted image, and `deploy`
  holds the production SSH key, which must never reach this host.
- Never put a production credential on the runner host, in a runner
  environment file, or in a workflow that targets these labels.

`static-checks` has a 30-minute bound because run 34198177856 spent about 15
minutes on cold setup before beginning its tests, then hit the former 20-minute
limit. This allows one cold start; it is not a throughput guarantee or a reason
to retry a timeout repeatedly. Already queued runs retain their workflow
snapshot; a rerun does not automatically acquire the new main workflow.

Paid GitHub-hosted jobs still include `deploy.yml`, the label-gated production
proof and manual operational workflows. A dollar budget is only a hard stop
when its stop-usage setting is enabled. Do not change it as an incidental CI
fix: stopping hosted usage would also stop production delivery.
