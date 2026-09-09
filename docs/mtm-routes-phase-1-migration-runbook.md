# MTM Routes Phase 1 Migration Runbook

## Scope

Migrations:

- `20260713160000_mtm_routes_phase1_foundation`
- `20260713170000_mtm_route_change_requests`
- `20260713180000_mtm_visit_next_action`
- `20260713190000_mtm_excel_exchange`

The migration is additive. Legacy `mtm_routes.agentId` and
`mtm_visits.agentId` remain the compatibility owner fields. New assignment and
participant rows are backfilled from those values.

## Preflight

1. Run `npx prisma validate` and `npx prisma generate` with the deployment
   schema and migration connection strings.
2. Restore the latest production backup into an isolated PostgreSQL database.
3. Record counts for active/deleted routes and visits by organization.
4. Run `npx prisma migrate deploy` against the restored copy.
5. Confirm every route has exactly one active `PRIMARY` assignment matching
   `mtm_routes.agentId` and every visit has one active `PRIMARY` participant
   matching `mtm_visits.agentId`.
6. Confirm `mtm_sales_plan_lines` constraints and indexes exist, and that the
   new external-code/ID columns preserve leading-zero text values.
7. With a non-bypass application role, set `app.org_id` and prove that each new
   table returns only that organization. Without `app.org_id`, reads must return
   no rows.
8. Verify the `mtm-import` worker and Redis connection before enabling imports
   larger than 5,000 rows; the API intentionally rejects queueing when they are
   unavailable.

## Production Apply

Use the standard migration role from `/etc/leaddrive/migration.env`. The
application role must remain `NOBYPASSRLS`. Apply only through the normal GitHub
Actions deployment after preflight evidence is attached to the release.

## Rollback

The schema cannot be rolled back safely after new APIs have written assignments,
requests, imports, or visit results. The supported rollback is application-first:

1. Disable `routeAssignmentsEnabled`, `visitPoliciesEnabled`, and
   `excelImportsEnabled` in MTM settings. This returns route writes to the
   legacy single-owner behavior and blocks new policy/import writes.
2. Keep all new tables and columns in place; do not drop audit or request data.
3. Redeploy the previous application revision.
4. If the migration itself fails before application rollout, restore the
   pre-migration database backup rather than attempting a destructive down SQL.

## Retention

- MTM audit events and applied import summaries are retained indefinitely in
  Phase 1.
- The Phase 1 API does not persist uploaded source workbooks. It persists the
  checksum, validated snapshot, preview, exact row errors, and apply summary.
- Generated error workbooks are downloaded on demand from retained row errors;
  no workbook object-storage retention is required in Phase 1.
- Rejected or unapplied uploads are retained for 30 days.
- A future object-storage adapter may retain source files for 90 days, but must
  not be treated as active until storage and cleanup jobs are verified.
- Cleanup must not delete import job summaries, row counts, decisions, or audit
  events.
