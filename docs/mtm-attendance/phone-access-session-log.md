# Physical-phone fixture access — session log

## 2026-10-13 — reason, boundary and implementation

- The user authorized autonomous MTM fixes and real-device testing. The S23 Ultra
  is connected, but no separate company existed. Reviewed PR #752 and workflow
  `38480267477` created the marker-owned `mtm-attendance-phone` company, three
  fictional users and three automatic attendance cards. Creation succeeded on
  deployed main `2fc52646f2e9d31ce50320dc872654c55f51c41c`.
- Direct SSH from the task host to the registered LeadDrive production target
  rejected its configured key. No SSH key or production permissions are being
  changed. An optional question about existing Mac access remains separate.
- This bounded alternative uses the existing protected GitHub production route
  and pinned SSH action to deliver only the owned fixture's credential encrypted
  to the test operator's RSA-4096 public key. The private key stays outside Git
  and outside GitHub. Plaintext is never printed or stored in an artifact.
- The controller verifies deployed SHA and public build-info, then uses the
  existing READ ONLY fixture reader to verify exact marker, IDs, users, roles,
  activity and disabled geo/mail schedules. It checks root file ownership/modes,
  matches the saved password against all three fixture users, and encrypts an
  envelope bound to the fixture marker, deployed SHA and recipient fingerprint.
  It cannot select another file/user, create a tenant, reset a password or log in.
- The workflow requires exact current reviewed main, verifies that the serving
  revision is a main ancestor, and rechecks both after acquiring the shared
  production lock. It does not deploy application code. The result artifact
  contains only the allowlisted RSA-OAEP-SHA256 envelope, retained for one day.
- Worktree:
  `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-phone-fixture-access`;
  branch `codex/mtm-phone-fixture-access`; origin
  `https://github.com/rashadoni/leaddrive-v2.git`; production
  `13.140.132.245:/opt/leaddrive-v2`; publication through reviewed main and Actions.

## 2026-10-13 — bounded verification

- PASS: ten tests across the access controller and existing fixture reader,
  including recipient-only decryption, revision/tenant binding, randomized
  encryption, wrong/weak/private/non-RSA keys, extra/private output rejection and
  standalone bundling. The bundle also rejects the inherited preparation mode.
- PASS: scoped ESLint, runner policy, build-script syntax and diff whitespace.
- NOT RUN locally: full TypeScript/project checks and full browser/native builds,
  following the Contabo workload rule. Those belong to GitHub; this change has no
  schema, application UI or Android sources.
- Current status: implementation under review; no encrypted access workflow has
  run yet, no credential was obtained, and physical fictional workday tests still
  await login. Next: review/checkpoint, required PR checks, normal merge, then
  dispatch with a task-local recipient key and exact current/serving revisions.

## 2026-10-13T23:10:34.536157+00:00 — independent review

- Independent review found no actionable defect in the fixed fixture reader, encryption boundary or protected workflow. Added an extra workflow equality check against the expected serving SHA before uploading the envelope.
- YAML and all seven shell fragments pass syntax checks; scoped ESLint and bundle syntax pass. The first runner-policy retry used the wrong script path and did not execute; the corrected scripts/ci/check-github-runner-policy.mjs passes.
- No credential has yet been retrieved. Next: required PR checks and normal merge before any workflow dispatch.
