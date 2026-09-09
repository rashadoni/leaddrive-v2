-- Deterministic source for the single next-action task produced by a visit.
-- NULL keeps existing/manual tasks unrestricted; the partial index prevents
-- retrying result save or offline replay from creating a duplicate.
ALTER TABLE "mtm_tasks" ADD COLUMN "sourceKey" TEXT;

CREATE UNIQUE INDEX "mtm_tasks_org_source_key_unique"
  ON "mtm_tasks" ("organizationId", "sourceKey")
  WHERE "sourceKey" IS NOT NULL;
