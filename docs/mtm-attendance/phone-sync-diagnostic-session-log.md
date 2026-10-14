# Phone sync diagnostic session journal

## 2026-10-14 — read-only diagnosis prepared

- Parent verified the fictional S23 FIELD START remains queued with no HR fact.
  Separate fictional-admin HTTP diagnostics proved canonical attendanceMark
  NO_CONSENT fails with an internal per-operation error, while legacy mark-free
  START and FINISH commit. Those HTTP diagnostics are not physical acceptance.
- New worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-phone-sync-diagnostic`,
  branch `codex/mtm-phone-sync-diagnostic`, base `ebd7dc90af73cca4b6d5d901bf1a170355d3e86b`.
  Verified origin rashadoni/leaddrive-v2; production 13.140.132.245 at
  /opt/leaddrive-v2, operational access only via reviewed current-main workflow.
- Source review alone does not prove the production SQL cause. No speculative
  application or schema fix is made. Existing isolated PG mark tests pass.
- Prepared dispatch-only production-lock diagnostic: exact reviewed main,
  deployed ancestor and local/public deployed SHA; reuse readPhone for exact
  fixture ownership/privacy checks. Read only fixed error.log tail (4 MiB,
  O_NOFOLLOW, regular file), two fixed fictional operation IDs, four latest
  bounded error blocks per ID. No arbitrary selectors, shell, SQL or paths.
- Output reconstructs finite allowed SQL/Prisma/MTM signatures and known
  columns/constraints only, never raw logs/query/stack/row data. Optional catalog
  inspection begins READ ONLY, returns only fixed presence flags, trigger hash
  and privilege flags. Catalog refusal becomes null; it does not expand access.
  Controller/receiver reject unsupported modes and additional fields.
- No production execution, push, merge or settings change has been performed.
  Next: focused checks, parent independent review, normal required CI, then
  parent dispatch on reviewed main and diagnosis from sanitized evidence.

## Local bounded verification checkpoint

- PASS: nine focused tests (fixed IDs, no raw secrets/SQL/stack, bounded tail,
  no-follow file safety, finite receiver validation, READ ONLY catalog ordering,
  bundling and refusal of mutation modes). Tests run once initially, then again
  after adding the two filesystem boundary tests; final duration 2.55 seconds.
- PASS: runner policy for all 64 workflows and diff whitespace. RAM/disk/pressure
  inspected before the sequential local checks. Existing dependency directory
  is linked read-only by convention; no install or full build was run here.
- Full typecheck/static integration/production execution are NOT_RUN locally:
  required GitHub gates and parent-reviewed dispatch remain next. The optional
  catalog reports null if the restricted runtime role denies a catalog query;
  log evidence is still strictly filtered and independently useful.
