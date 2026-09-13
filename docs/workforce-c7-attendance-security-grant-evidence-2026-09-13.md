# Workforce C7 attendance-security grant evidence

Status: implemented and locally verified on 2026-09-13; granular tenant activation remains default-off.

After granular cutover, tenant-wide QR-station and trusted-device administration
require an effective organization-scoped `DEVICE_SECURITY_ADMIN` grant. The
resolver checks `QR_STATION_MANAGE` and `DEVICE_LIFECYCLE_MANAGE` independently,
rejects API-key principals, and does not inflate a site-scoped grant into access
to every station or device in the tenant.

Before cutover, the existing session admin/superadmin behavior is preserved.
The route-level capability and mandatory MFA checks remain intact; errors fail
closed with no-store security headers and bounded sensitive-operation logging.

Evidence:

- targeted tests cover an organization grant, broad CRM-admin denial and
  site-scope non-escalation;
- the existing attendance API suite continues to cover MFA, QR lifecycle,
  device lifecycle and tenant predicates;
- no station, device, grant or feature flag is changed by this authorization
  slice; physical QR/controller and trusted-device tests remain NOT RUN.
