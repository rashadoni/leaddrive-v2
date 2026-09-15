-- UPDATE_PUBLISHED (change a PLANNED or IN_PROGRESS route from Route Field)
-- joins the route-command grammar in src/lib/mtm/mobile-route-command-receipt.ts.
-- The receipt CHECK must allow it in the same release: on 2026-09-14 START
-- was added to the grammar without widening this check, every START failed
-- with 23514 inside the command transaction and the endpoint answered 500.
--
-- The table has no RLS backfill here: this is a constraint change only and
-- needs no app.org_id. Existing rows hold only the four old commands, so the
-- new check validates immediately. Rollback: delete UPDATE_PUBLISHED
-- receipts (they expire within the retention window anyway) and re-add the
-- four-value check.

SET lock_timeout = '3s';

ALTER TABLE "mtm_mobile_route_command_receipts"
  DROP CONSTRAINT "mtm_mobile_route_command_receipts_command",
  ADD CONSTRAINT "mtm_mobile_route_command_receipts_command"
    CHECK ("command" IN ('CREATE_DRAFT', 'UPDATE_DRAFT', 'PUBLISH', 'START', 'UPDATE_PUBLISHED'));
