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
