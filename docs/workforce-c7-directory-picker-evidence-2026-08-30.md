# Workforce C7 directory-picker evidence

**Status:** WF-C7-003 complete
**Date:** 2026-08-30

The Workforce configuration screen now uses named, tenant-scoped records
instead of asking an HR administrator to type a team, employee or site ID.

- Policy and shift drafts use an organization-or-named-team scope picker. Team
  code and active/inactive status are visible before the future-only write.
- Individual shift assignment uses the active employee roster with the
  employee's current named team and status in the option label.
- Workforce site eligibility uses named active employee and active site
  pickers. It supports primary, secondary and temporary assignments; temporary
  assignments require an end date. The existing server-side future-date,
  tenant-scope and overlap controls remain the write authority.
- The configuration directory shows a bounded (250 employee) named
  employee/team/site view with status. It preserves historical assignment
  windows by their effective dates and names without reading Route tables or
  exposing coordinates, QR material, device data or raw location evidence.

The directory intentionally labels the employee's current directory team as
current context only. It does not claim historical employment/team resolution;
transfer, termination and rehire history remain WF-C7-004 work.

## Verification

    PASS  25 targeted Vitest tests, one sequential worker:
          api-workforce-configuration, api-workforce-sites,
          workforce-configuration-assignment-ui-contract and
          rls-route-context-coverage
    PASS  targeted ESLint for configuration route, configuration UI and tests
    PASS  npm run i18n:check (en/ru/az translation parity)
    PASS  git diff --check
    NOT RUN  browser interaction/accessibility evidence, full TypeScript/build,
             database apply, Android/mobile client and production-like
             configuration concurrency; these require CI or an approved
             external worker.
