# Read-only inventory when live trails main

This is an observability admission change, not deployment, replay, activation,
restore or rollback authority. The inspection script and SQL are unchanged.
No arbitrary old source is fetched or executed.

The manually dispatched readiness workflow still requires the protected
`main` ref, an actual checkout of the independently current main SHA, and the
existing pinned production route. Both admission modes retain these checks.

| Mode | Inputs | Expected live marker |
| --- | --- | --- |
| `current-main` (default) | No release or run fields; stray fields fail | Current main checkout SHA, as before |
| `deployed-release` | Exact lowercase 40-character `deployed_sha` and canonical positive `deploy_run_id` | Only the SHA authenticated by the normal successful deployment receipt |

The optional mode independently reads GitHub evidence before SSH material is
installed. It requires the registered repository/head-repository IDs and slug,
the active `deploy.yml` workflow identity/path, a completed successful push/main
run for the exact SHA, and a complete latest-attempt job list (maximum 100).
Exactly one each of the quality, artifact-build and actual deploy/post-deploy
smoke jobs must be completed successfully on that same run/head/attempt.
Manual, build-only, skipped, failed, foreign, duplicate and partial receipts
fail closed. The latest run attempt is read again before admission completes.

A separate named `Validate inputs` step executes the same pure input validator
before even the protected-route API lookup. It has no GitHub token or production
secret, emits no values, and rejects mixed, missing or malformed fields with a
fixed error. Full receipt/main/blob admission remains mandatory afterward;
the early shape check is not a replacement for evidence or route protection.

GitHub compare must identify the release as current main's ancestor or the
identical commit, with matching base/merge-base and zero commits behind. No
local history fetch is needed. Fixed, nonrecursive Git tree walks must find
the same regular inspector blob, Git mode and bounded size at both SHAs.
Its actual current-checkout bytes must match the tracked Git blob, be regular
and nonsymlink, and pass bounded `O_NOFOLLOW` acquisition. Only the current
checkout script is sent to the server. Different inspector versions are not
eligible; this mode never substitutes the older script.

The helper validates inputs before any Git/file/API acquisition, uses only
fixed repository GET endpoints with bounded response sizes/deadlines, and
prints only the verified SHA or a fixed sanitized failure code. Default mode
does not request deployment receipts or compare evidence. Main moving during
admission or a changed latest attempt causes refusal, not a source fallback.

The inventory job retains the shared `production-deploy` lock through its SSH
and read-only operation. Job-level `queue: max`, `cancel-in-progress: false`
allows inspection to queue without replacing a foreign pending deployment.
General deployment concurrency and other workflows are unchanged.

Finally, the unchanged server script must independently match its root-owned
live artifact marker to `EXPECTED_DEPLOY_SHA` and force SQL READ ONLY. If live
has moved, authentication fails, or any evidence is unavailable, stop and
obtain a fresh approved observation; do not modify keys, weaken checks or
invent another production route. This preparation authorizes no dispatch.
