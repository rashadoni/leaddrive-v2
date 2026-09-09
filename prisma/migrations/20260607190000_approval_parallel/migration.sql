-- Migration: 20260607190000_approval_parallel
-- Slice 3e-1: parallel approval levels (all/any/quorum per level).
--
-- A "level" = all ContractApprovalStage rows sharing the same `order`.
-- Previously each (contractId, order) pair was unique (one stage per level).
-- Now multiple stages may share an order — the unique constraint is replaced
-- by a non-unique index so the chain view query still works.
--
-- The unique-drop is safe: existing rows have unique (contractId, order)
-- combinations; dropping the constraint only permits MORE rows at the same
-- order going forward.
--
-- Additive columns default to backward-compatible values:
--   parallelMode    TEXT NOT NULL DEFAULT 'all'
--     → single-stage "all" level == legacy sequential behavior.
--   quorumThreshold INTEGER NULL
--     → NULL for all existing rows (quorum not in use).

-- 1. Drop the existing unique index.
--    Real index name confirmed from migration 20260517280000_clm.
DROP INDEX IF EXISTS "contract_approval_stages_contract_order_uniq";

-- 2. Create a non-unique index on (contractId, order) for level lookups.
--    Named _idx suffix to distinguish from the dropped _uniq.
CREATE INDEX "contract_approval_stages_contract_order_idx"
  ON "contract_approval_stages"("contractId", "order");

-- 3. Add parallelMode column (all existing rows get "all" — sequential-compat).
ALTER TABLE "contract_approval_stages"
  ADD COLUMN IF NOT EXISTS "parallelMode" TEXT NOT NULL DEFAULT 'all';

-- 4. Add quorumThreshold column (NULL for all existing rows).
ALTER TABLE "contract_approval_stages"
  ADD COLUMN IF NOT EXISTS "quorumThreshold" INTEGER;

-- 5. Add a CHECK constraint on parallelMode to guard against invalid values.
--    Applied as NOT VALID so it doesn't scan existing rows (they're all "all").
ALTER TABLE "contract_approval_stages"
  ADD CONSTRAINT "contract_approval_stages_parallelMode_check"
  CHECK ("parallelMode" IN ('all', 'any', 'quorum')) NOT VALID;
