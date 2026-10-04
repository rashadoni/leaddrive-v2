-- Consumed restore operation identity survives an unavailable audit receipt.
-- Legacy rows remain unanchored; no data backfill or lifecycle change.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "workforce_policies"
  ADD COLUMN "restoreOperationId" TEXT,
  ADD COLUMN "restoreRequestHash" VARCHAR(64),
  ADD CONSTRAINT "workforce_policies_restore_anchor_check" CHECK (
    ("restoreOperationId" IS NULL AND "restoreRequestHash" IS NULL)
    OR ("restoreOperationId" IS NOT NULL AND "restoreRequestHash" IS NOT NULL
      AND "restoreOperationId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$'
      AND "restoreRequestHash" ~ '^[a-f0-9]{64}$')
  );
CREATE UNIQUE INDEX "workforce_policies_organizationId_restoreOperationId_key"
  ON "workforce_policies" ("organizationId", "restoreOperationId");

CREATE FUNCTION workforce_guard_policy_restore_anchor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."restoreOperationId" IS NOT NULL AND (
      NEW."status" <> 'DRAFT' OR NEW."provenance" <> 'TENANT_ADMIN'
      OR NEW."systemProfileVersion" IS NOT NULL OR NEW."createdByUserId" IS NULL
      OR NEW."activatedByUserId" IS NOT NULL OR NEW."activatedAt" IS NOT NULL OR NEW."retiredAt" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'A restore anchor requires a new tenant administrator draft' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."restoreOperationId" IS NOT NULL THEN
      RAISE EXCEPTION 'A consumed Workforce restore operation cannot be deleted' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."restoreOperationId" IS DISTINCT FROM OLD."restoreOperationId"
     OR NEW."restoreRequestHash" IS DISTINCT FROM OLD."restoreRequestHash" THEN
    RAISE EXCEPTION 'Workforce restore anchors are immutable and insert-only' USING ERRCODE = '55000';
  END IF;
  IF OLD."restoreOperationId" IS NOT NULL AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."teamId" IS DISTINCT FROM OLD."teamId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Workforce restore creation identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_policies_restore_anchor_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "workforce_policies"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_policy_restore_anchor();
COMMIT;
