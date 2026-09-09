-- SWM-15A freeze guards. BUILDING rows may be assembled transactionally;
-- after the parent becomes FROZEN neither the snapshot envelope nor any
-- subject row can be changed, and no late row can be appended.

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION mtm_coverage_snapshot_terminal_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" IN ('FROZEN', 'FAILED') THEN
    RAISE EXCEPTION 'mtm_coverage_snapshots terminal snapshot % cannot be updated', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mtm_coverage_snapshot_terminal_immutable_trigger
  BEFORE UPDATE ON "mtm_coverage_snapshots"
  FOR EACH ROW
  EXECUTE FUNCTION mtm_coverage_snapshot_terminal_immutable_fn();

CREATE OR REPLACE FUNCTION mtm_coverage_snapshot_rows_building_only_fn()
RETURNS TRIGGER AS $$
DECLARE
  parent_status "MtmCoverageSnapshotStatus";
BEGIN
  SELECT "status" INTO parent_status
    FROM "mtm_coverage_snapshots"
    WHERE "id" = NEW."snapshotId" AND "organizationId" = NEW."organizationId";

  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'mtm_coverage_snapshot_rows parent snapshot % does not resolve in organization %',
      NEW."snapshotId", NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF parent_status <> 'BUILDING' THEN
    RAISE EXCEPTION 'mtm_coverage_snapshot_rows parent snapshot % is %, expected BUILDING',
      NEW."snapshotId", parent_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mtm_coverage_snapshot_rows_building_only_trigger
  BEFORE INSERT OR UPDATE ON "mtm_coverage_snapshot_rows"
  FOR EACH ROW
  EXECUTE FUNCTION mtm_coverage_snapshot_rows_building_only_fn();
