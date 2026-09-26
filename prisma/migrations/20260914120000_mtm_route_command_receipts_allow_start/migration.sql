-- START (begin a planned route from the field app) joined the route-command
-- grammar in src/lib/mtm/mobile-route-command-receipt.ts, but this check was
-- never widened. Every START failed with 23514 inside the command transaction,
-- so the endpoint answered 500 and the app parked the command, telling the
-- agent there was no connection (seen on production 2026-09-14 12:44 and
-- 12:45 CEST from a tablet that was online).
--
-- Existing rows hold only the three old commands, so the new check validates
-- immediately. Rollback: re-add the three-value check after deleting any
-- START receipts, which expire on their own within the retention window.

SET lock_timeout = '3s';

ALTER TABLE "mtm_mobile_route_command_receipts"
  DROP CONSTRAINT "mtm_mobile_route_command_receipts_command",
  ADD CONSTRAINT "mtm_mobile_route_command_receipts_command"
    CHECK ("command" IN ('CREATE_DRAFT', 'UPDATE_DRAFT', 'PUBLISH', 'START'));
