# Workforce C7 site-assignment grant evidence

Status: implemented and locally verified on 2026-09-13; tenant activation remains default-off.

The tenant-wide site-eligibility timeline and its bulk preview now require an
effective organization-scoped `SCHEDULER` grant with `SCHEDULE_READ` after
granular cutover. Scheduling or bulk-publishing a future eligibility window
requires the exact `SITE_ASSIGNMENT_WRITE` permission. Before cutover, the
existing accountable session-admin behavior remains unchanged.

These routes intentionally do not infer authority from an employee's current
team or site: that would disclose a whole-tenant historical timeline through a
mutable directory relationship. Broad CRM roles do not become a fallback after
cutover, API keys cannot enter the session wrapper, and no Route assignment or
customer location is read or changed.

Evidence:

- route-construction tests bind two read/preview and two write/publish handlers
  to their exact permissions while leaving the five site-definition handlers
  on their separately reviewed boundary;
- targeted site API tests preserve future-date, tenant and Route isolation;
- no tenant feature, assignment or grant is activated by this slice.
