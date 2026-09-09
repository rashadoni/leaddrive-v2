-- P0 #1 follow-up — extend tenant_master_keys immutability trigger
-- to cover createdAt + createdBy (architect 💡 from PR #89 review).
--
-- The slice-2 trigger pins organizationId / version / wrappedDek /
-- activatedAt and set-once supersededAt / supersededByVersion. It
-- did NOT pin createdAt / createdBy because the practical risk is
-- near zero (insert-only API path; nothing in the codebase mutates
-- these columns). But for parity with the "forensic evidence"
-- framing in the migration header, lock them down too — defense
-- in depth against future bugs / raw SQL drift.
--
-- Bonus: switch the partial unique index name from
-- tenant_master_keys_org_active_uniq to ..._org_active_idx so the
-- Prisma schema's @@index (NOT @@unique) ports cleanly (slice-2
-- had a partial UNIQUE that Prisma can't express; fixed to a regular
-- index at the typed-client layer in this PR).

CREATE OR REPLACE FUNCTION tenant_master_keys_immutability_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- Block DELETE entirely (key history is forensic evidence).
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tenant_master_keys rows are append-only — DELETE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- Allow UPDATE only on set-once supersededAt + supersededByVersion.
  IF OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'tenant_master_keys.organizationId is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."version" IS DISTINCT FROM NEW."version" THEN
    RAISE EXCEPTION 'tenant_master_keys.version is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."wrappedDek" IS DISTINCT FROM NEW."wrappedDek" THEN
    RAISE EXCEPTION 'tenant_master_keys.wrappedDek is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."activatedAt" IS DISTINCT FROM NEW."activatedAt" THEN
    RAISE EXCEPTION 'tenant_master_keys.activatedAt is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- NEW in this follow-up: lock createdAt + createdBy too.
  IF OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'tenant_master_keys.createdAt is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."createdBy" IS DISTINCT FROM NEW."createdBy" THEN
    RAISE EXCEPTION 'tenant_master_keys.createdBy is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- Set-once: supersededAt + supersededByVersion.
  IF OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" THEN
    RAISE EXCEPTION 'tenant_master_keys.supersededAt is immutable once set (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."supersededByVersion" IS NOT NULL AND NEW."supersededByVersion" IS DISTINCT FROM OLD."supersededByVersion" THEN
    RAISE EXCEPTION 'tenant_master_keys.supersededByVersion is immutable once set (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already attaches to this function (CREATE OR REPLACE
-- FUNCTION updates the body in-place). No re-attach needed.

-- Rename the partial unique index to *_idx for typed-client parity.
-- The constraint semantics are unchanged.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tenant_master_keys_org_active_uniq') THEN
    ALTER INDEX "tenant_master_keys_org_active_uniq"
      RENAME TO "tenant_master_keys_org_active_idx";
  END IF;
END $$;
