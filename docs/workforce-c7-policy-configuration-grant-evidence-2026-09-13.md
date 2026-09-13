# Workforce C7 policy configuration grant evidence

Status: implemented and locally verified on 2026-09-13; tenant activation remains default-off.

Policy inventory, draft creation/update and future activation now share one
session-only authorization boundary. Before `workforce-granular-access-v1` is
enabled, the existing admin/superadmin behavior is preserved. After cutover,
the caller must hold an effective `HR_ADMIN` grant whose
`WORKFORCE_POLICY_DRAFT_WRITE` permission matches the organization resource.

The boundary deliberately rejects team/site-scoped policy authority for this
tenant-wide timeline, does not fall back to a broad CRM admin role, and returns
503 when entitlement or grant resolution is unavailable. API keys cannot enter
the session wrapper. No tenant feature flag or live grant is changed by this
slice.

Evidence:

- wrapper tests cover legacy allow/deny, effective organization grant and the
  post-cutover no-admin-fallback rule;
- route construction tests bind all four policy handlers to the dedicated
  wrapper alongside the independently fenced schedule handlers;
- the RLS route scanner recognizes the wrapper as a context-delivering
  session boundary.
