# Portal Users audit persistence repair — 2026-10-04

## Problem and narrow repair

The authorized real-backend run37201163080 on test head3e59046dabab2ab6d1313af83c12d802081358cb completed9/10 scenarios. Only portal-user-persisted-audit failed with PORTAL_USER_AUDIT_NOT_RECORDED. Cleanup and container removal passed, outbound attempts0. Artifact11303081882 SHA256e9982bc507adea8f08da2e7669ae6d61ac3deccad5a66137ce884fd41b4393d2; receipt SHA256f93df49acc0a2d4f8e7d1feab05630f62cf6f76c7ede259caad31da82fda6730. This historical FAIL remains unchanged.

writePortalAudit passed a nonexistent AuditLog.details field to Prisma; its catch correctly returned auditRecorded=false. The repair writes the authenticated administrator to the existing userId column and existing minimal event metadata to newValue. A Prisma.AuditLogUncheckedCreateInput boundary prevents unknown fields from being hidden by the application's loosely typed Prisma wrapper.

No schema/migration, permissions, tenant selection, credential changes or logging changes are included. The existing direct awaited create is retained: the generic logAudit helper swallows errors and cannot preserve the required auditRecorded=false contract. The current route's session/RLS wrapper and failure reporting are unchanged.

## Local evidence

- Fresh main base81cb5b5e85b456167a0e552a96a243829157c582, private branch codex/support-portal-audit-fix, dedicated Contabo worktree.
- Schema-aware regression uses the actual generated Prisma AuditLog model to reject unknown fields. Against unchanged product:25 tests,11PASS/14FAIL. Saved /tmp/support-portal-audit-regression-before.json.
- After repair:25/25PASS. Nine successful event kinds verify canonical actor/tenant/target and exact metadata; password/hash/token/email/phone values are excluded. Denied roles and a tenant-scoped missing contact produce no audit.
- Neighboring Portal API/password-link suite:81/81PASS in3files, /tmp/support-portal-audit-focused-after.json. Final stricter exact-metadata assertions rerun25/25PASS, /tmp/support-portal-audit-final-25.json.
- Scoped ESLint and git diff --check PASS.
- A separate in-memory audit-helper type probe against the generated Prisma types exceeded its512MiB heap cap. NOT PASS; no increased-memory retry. Full repository compiler/build/full suite and post-fix real PostgreSQL acceptance NOT RUN locally: hosted CI only, after publication authorization.
- No raw CI log retrieval: previous automatic approval rejection remains respected. Historical receipt was verified through the allowed sanitized artifact only.

## Source review and release boundary

Self-review: only the audit data mapping changes; all existing write authorization, organization filters and await/catch behavior remain intact. Actor comes from trusted session auth, metadata comes from existing bounded event descriptors, and credentials are not added to any audit/log. Schema is unchanged. This is not an independent-agent review.

Product publication and release are pending explicit authorization. No push, product PR, merge or deploy has occurred. Before release require current mandatory CI, unchanged real-backend audit assertions with a disposable database, and the normal protected-main deployment path. A local mock-backed PASS does not replace real PostgreSQL evidence.

## Publication authorization and exact-head test preparation

At 2026-10-04 12:42:07 UTC the owner explicitly approved publication and installation of this audit fix after successful checks. This supersedes the earlier publication hold; it does not authorize unrelated product changes.

The eight existing workflow/harness/document files from test head 3e59046dabab2ab6d1313af83c12d802081358cb are reused so the real-backend run can check this exact product candidate. The workflow admits only the established test branch and the dedicated codex/support-portal-audit-fix branch in the canonical repository. It retains hosted-only, exact-SHA, clean-checkout, disposable-loopback-DB, restricted-role/RLS, network and cleanup guards. Expected status/audit assertions are unchanged. Only the audit route is product code.

Historical failures remain immutable. Post-fix hosted acceptance and release are still pending at this checkpoint.

## Fresh main integration after first complete acceptance

Candidate 3b013f57f51c078676fe561f83641de434b2b08c passed all five required checks and real-backend run37203198019:10/10PASS, cleanupPASS, outbound0. Artifact11304220328 SHA25697765c4b273528e45d996561cdc9c12c692b2ff663059838abc5e31a2170701e; receipt SHA256b2582452a89267ea33b1925b5320152e969e8ad080d2bbab9588dc3534df68c0. This evidence remains historical and unchanged.

The final premerge guard stopped before merge when main advanced to abda8aa024f6e8fd52527cdbc9e85b42192fdc15 through the original HRM PR571 at13:01:26UTC. Normal integration produced8ee0a73a29d666604e8898cc7e12b73e9be4b706 without conflicts. Audit product/test logic and backend harness assertions remain byte-identical. The dedicated audit evidence document is added to this branch-fenced push workflow's paths so evidence/integration checkpoints receive a fresh exact-head run. No security or branch guard is removed.

Fresh hosted acceptance and mandatory checks will run on the integrated candidate before merge. HRM changes belong to upstream main and are not additional product changes in this PR.
