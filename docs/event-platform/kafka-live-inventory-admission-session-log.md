# Live inventory admission session journal

## 2026-10-19 — Fresh observed blocker and bounded preparation

- Parent observed completed normal deployment `39173487040` for `4212600260f5ed28b9c2b73e28c363a0fc7d39f3`, followed by parallel main deliveries while actual live stayed behind current main. Existing inventory requires current main to equal the live marker and therefore cannot audit that state. Direct read-only SSH alias authentication was refused; no key workaround is authorized.
- New dedicated worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-kafka-live-inventory-admission-20261019`, branch `codex/kafka-live-inventory-admission-20261019`, exact freshly fetched origin/main base `9cd84838dc83a5349f06d3bb86fa480b459029fe`. Preserve all earlier worktrees and the original A3/A5 threads.
- Context/AGENTS/deployment documentation checked: origin `https://github.com/rashadoni/leaddrive-v2.git`, registered production `13.140.132.245:/opt/leaddrive-v2`, reviewed main through GitHub Actions only. This subtask authorizes source preparation only: no push/PR/CI/SSH/server/merge/deploy action or paid resources.
- Read existing readiness workflow and inspector/test fully. Do not change the inspector, inspection SQL, SSH action or general deploy policy. Default current-main mode and protected-route guard remain; new optional deployed-release mode must still execute independently current main, not old source.
- Read-only API shape evidence: repository ID `1362346481`; deploy workflow ID `353805356`, exact path `.github/workflows/deploy.yml`; completed push/main receipts `39173487040` → `4212600260f5ed28b9c2b73e28c363a0fc7d39f3` and `39174243373` → `99ce1ae3c7b91d3bf9e0742fc3622ac59a9a2859`. Latest-attempt jobs expose run ID/attempt/head SHA/status/conclusion; require exactly one successful quality, artifact-build and actual deploy/smoke job each. Compare API exposes base/merge-base/status/ahead/behind; root/child Git trees expose path/type/mode/blob SHA/size and truncation.
- Plan: pure fail-closed receipt/tree validators plus bounded CLI; validate mode/inputs before any gh spawn; current main and actual checkout SHA pinned in both modes; ancestor verified through GitHub compare (no history fetch); fixed nonrecursive tree walks verify unchanged bounded regular inspector blob/mode against actual nonsymlink checkout bytes. Only the verified SHA reaches EXPECTED_DEPLOY_SHA. Move the same production lock to job-level `cancel-in-progress:false`, `queue:max`, preserving serialization without replacing an already pending deploy.
- Verification placement: resource preflight then small sequential Node/syntax/runner-policy/diff checks only. Real workflow/production inventory, full build/typecheck, Docker/Java/PostgreSQL/Prisma are NOT RUN in this preparation.

## 2026-10-19 — Implementation and targeted verification

- Implemented pure receipt/ancestor/tree validators and bounded CLI. Both modes validate exact main ref, actual checked-out HEAD and independently current main before/after admission. Optional mode checks repository and head-repository IDs/slugs, workflow identity/path, successful normal push/main run, complete unique latest-attempt jobs and exactly one successful quality/build/deploy-smoke job each; rerun state is checked again. All fetch paths are constructed from fixed repo identities and canonical bounded IDs/SHAs.
- Fixed three-component nonrecursive tree walks require directory modes/types and equal inspector leaf blob/mode/size in current/live trees; actual current file is bounded, nonsymlink, read with O_NOFOLLOW and verified against tracked HEAD Git blob bytes/mode. No older script is acquired. Git mode means the tracked regular/executable class; no chmod or inspector source change was made to compensate for this host's normal group-writable checkout umask.
- Readiness inputs default to unchanged current-main semantics; mixed/partial receipt inputs fail before acquisitions. Canonical run IDs reject leading zeros, unsafe integers, terminal LF/CRLF and whitespace via exact numeric round-trip. CLI/provider failures emit fixed codes without raw response/errors/credentials.
- Workflow uses only the verified helper output for EXPECTED_DEPLOY_SHA before existing SSH setup. Moved only its production lock to job-level `queue:max`, `cancel-in-progress:false`; no workflow-level lock remains and general deployment policy is unchanged. Current marker/READ ONLY server checks, protected route and pinned SSH action are untouched.
- Resource preflight: approximately 14.7 GiB available RAM, 195 GiB free disk, memory-pressure averages zero. Small sequential Node tests at 128 MiB: initial run exposed an over-restrictive new POSIX group-write check against the normal 0664 checkout; corrected it to validate the requested tracked Git mode/bytes plus stable regular nonsymlink identity, without editing/chmod of the inspector.
- After correction, 107 targeted admission/policy/unchanged-inspector tests PASS, CLI/helper syntax and unchanged inspector bash syntax PASS, runner policy PASS for 72 workflows, diff whitespace PASS. Added one final pure transport-error sanitization case; final rerun recorded in the next entry.
- Real dispatch, deployed-runtime/SSH inventory, full app build/typecheck, Docker/Java/PG/Prisma: NOT RUN (explicit source-preparation restriction). No push/PR/CI/server/key/production action, original branch/worktree alteration or paid resources.

## 2026-10-19 — Final narrow verification and checkpoint boundary

- Final combined sequential targeted suite: **108 tests, 108 PASS, 0 failed/skipped**, 2.85 seconds; admission + policy + unchanged inspector tests, 128 MiB Node heap. The previous 107-test count is superseded by the added pure transport-error case.
- Helper/CLI syntax PASS; unchanged inspector bash syntax PASS; runner policy PASS for 72 workflow files; `git diff --check` PASS. Existing event-platform-tools PR suite will also discover the new `.test.mjs` files; that broader gate was NOT RUN here.
- Exact resource snapshot before the targeted checks: MemAvailable 14,753 MiB; filesystem available 195 GiB; memory pressure avg10/60/300 all 0.00; existing host swap used 3,561 MiB. No installs, heavy checks or services were launched.
- Inspector remains unchanged at tracked blob `931e21e3795979fdea7785f22e16e46f94cf5b8b`, mode `100644`, 10,037 bytes; the inspected current/live GitHub tree entries matched that identity. Production SQL, server inspector, SSH action, deploy workflow and other branches remain untouched.
- Result: optional verified-deployed-release read-only admission and non-displacing inventory queue prepared; default current-main behavior retained. Last completed action: 108 targeted tests plus syntax/runner-policy/diff checks. Precise stopping point: seven explicitly owned paths checkpointed on this isolated feature branch, before push/PR/CI or diagnostic dispatch. Next action: root reviews the checkpoint/threat model, carries normal required PR gates, and only after approved main delivery considers a fresh main-only inventory dispatch. No operational readiness/activation/replay/rollback authority is implied.

## 2026-10-19 — Root review and normal PR admission

- Root independently read all seven owned paths and current repository operating,
  delivery, deployment and registry contracts. Resolved this isolated root/branch,
  rashadoni origin, registered13.140.132.245:/opt/leaddrive-v2 and GitHub-only
  protected-main route before Git work. This root phase resumes the owner's
  existing autonomous verified delivery and read-only diagnosis authorization;
  source-preparation-only restriction above applied to the internal preparer.
- Actual main remains9cd84838dc83a5349f06d3bb86fa480b459029fe. Five Actions-bound
  required contexts/enforce_admins remain intact. No user-facing UI feature or
  runtime activation is included, and no other session's PR is being merged.
- Independent sequential rerun on checkpoint20864806062e1de11615050c041941a6ddef7723:
 108/108 tests PASS,0failed/skipped;72-workflow runner policy and whitespace PASS.
  Preflight MemAvailable14785MiB,disk195GiB,pressure0.00;existingSwapUsed3560MiB.
  Full build/TS/PG/Java/Docker NOT RUN locally; required broader checks belong
  to GitHub. actionlint is unavailable, not represented as run or passing.
- Exact base-to-source comparison confirms unchanged server inspector, SQL,
  pinned SSH action and deploy.yml. Root reviewed canonical newline/run-ID
  refusal, full latest normal-release proof, ancestry/blob checks, sanitized
  bounded GET acquisition, protected current-main guard and shared job queue.
- Next: publish a draft PR, freeze this reviewed source, mark ready and require
  all five real protected SUCCESS checks plus tooling before normal merge.
  New live diagnosis and this source's app deployment remain NOT RUN/pending.
