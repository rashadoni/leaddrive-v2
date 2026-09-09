-- A pipeline may name the board its automated tasks land on. Nullable on
-- purpose: null means "use the organization-wide board setting", which is what
-- every existing tenant keeps doing without any backfill.
--
-- No RLS work is needed: the column is added to an existing tenant-scoped table
-- whose policy is unchanged, and nothing is written here, so the migration runs
-- fine without app.org_id.
ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "taskBoardId" TEXT;
