# Workforce C7 pilot-fence grant evidence

Status: implemented and locally verified on 2026-09-13; no tenant or device cohort is activated.

The mobile write-fence posture and cohort inventory are now protected by a
session-only pilot-control boundary. Before granular cutover, the existing
admin/superadmin behavior is preserved. After cutover, the caller must hold an
effective organization-scoped `PILOT_ROLLBACK_OPERATOR` grant with
`PILOT_FENCE_MANAGE`; a broad CRM role is not a fallback.

The wrapper is authorization only. Existing write routes still require the
separate Workforce attendance-security MFA check, tenant advisory locking,
validated transitions and immutable audit. The read route remains non-mutating,
and API keys cannot enter the session boundary.

Evidence:

- wrapper tests cover legacy allow/deny, effective pilot grant and post-cutover
  no-admin-fallback behavior;
- route tests prove all four control-plane handlers use the pilot wrapper and
  preserve MFA on every mutation;
- the RLS route scanner recognizes the wrapper as context-delivering;
- physical device enrollment and pilot execution remain NOT RUN and separate.
