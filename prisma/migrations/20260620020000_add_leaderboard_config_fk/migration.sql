-- KPI Arena Phase C slice-1 (follow-up): add the FK that 20260620010000 shipped
-- without (the schema model originally lacked the `organization` relation field,
-- so Prisma generated no FK). CASCADE-on-org-delete = parity with
-- account_grade_config; prevents orphan config rows on tenant deletion.
-- Additive + safe on the existing (empty/sparse) table.
ALTER TABLE "leaderboard_config" ADD CONSTRAINT "leaderboard_config_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
