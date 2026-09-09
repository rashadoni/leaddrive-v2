# Security audit 12 — destructive/admin actions

Date: 2026-07-22

## Scope

Checked API routes that can delete, bulk-update, bulk-delete, export, archive, reset, or otherwise mutate many records at once.

Focused review:

- `src/app/api/v1/projects/[id]/route.ts`
- `src/app/api/v1/projects/bulk/route.ts`
- comparable bulk routes for contacts, companies, deals, tasks, and inbox conversations

## Finding

`POST /api/v1/projects/bulk` accepted bulk project deletion through the normal POST/write route. That meant a caller with write-level project access could submit:

```json
{ "action": "delete", "ids": ["..."] }
```

and delete multiple projects without a separate `projects:delete` authorization check.

The route also had no explicit cap on the `ids` array, unlike the better-hardened bulk routes for deals/contacts/companies.

## Fix shipped

- `projects/bulk` now uses an explicit `projects:write` route gate.
- `action: "delete"` now re-checks `projects:delete` before calling `deleteMany`.
- Bulk project operations now reject more than 100 ids per request.
- Bulk delete and bulk status changes now write audit-log entries.
- Single project `GET`, `PUT`, and `DELETE` routes now declare explicit `projects:read`, `projects:write`, and `projects:delete` gates rather than relying on route/path inference.

## Existing protections confirmed

- Project mutations are organization-scoped by `organizationId`.
- Comparable CRM bulk routes for deals, contacts, and companies already limit ids to 100 and re-check delete permissions for destructive bulk deletes.

## Residual risk / next hardening

- Some project child routes still rely on inferred path permissions. They should be reviewed in a follow-up pass if project-level RBAC becomes stricter.
- Consider soft-delete or archive-first semantics for projects if customers treat projects as recoverable business records.
- Consider UI-level confirmation text for bulk deletes, but backend authorization is now the first line of defense.
