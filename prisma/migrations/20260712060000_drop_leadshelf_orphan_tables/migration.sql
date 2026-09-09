-- Drop the 22 orphaned LeadShelf-domain tables (orders/SKU/planograms/shelf/
-- equipment/promotions/ERP-sync) left behind by PR #288, which removed all
-- application code for these domains. Owner decision 2026-07-12: drop WITHOUT
-- data export — LeadShelf starts from a clean slate.
--
-- DDL only: no snapshot/disable/restore dance (that pattern is for RLS-hidden
-- row backfills). CASCADE detaches the inter-table FKs regardless of order and
-- removes the tenant_isolation policies together with their tables. All FKs
-- between dropped and live tables live on the dropped side, so live tables
-- need no ALTER. Every statement is idempotent (IF EXISTS) — Prisma Migrate
-- does not guarantee a per-file transaction on Postgres, so a mid-file retry
-- must be safe. Several of these objects were baselined via db push and have
-- no CREATE migration; IF EXISTS also covers environments where they never
-- existed.
--
-- RUNBOOK if this migration fails on deploy (e.g. lock_timeout while another
-- session holds a lock on one of these tables): the failed row wedges every
-- subsequent `prisma migrate deploy` with P3009. Because the whole file is
-- idempotent, the fix is:
--   npx prisma migrate resolve --rolled-back 20260712060000_drop_leadshelf_orphan_tables
-- then redeploy. The 22-table DROP is a single statement, so a lock timeout
-- rolls it back atomically — no partial table state from that statement.

SET lock_timeout = '3s';

DROP TABLE IF EXISTS
  "mtm_promotion_skus",
  "mtm_planogram_checks",
  "mtm_sku_stocks",
  "mtm_photo_prices",
  "mtm_shelf_annotations",
  "mtm_planogram_slots",
  "mtm_equipment_history",
  "mtm_equipment_inspections",
  "mtm_repair_requests",
  "mtm_model_training_runs",
  "mtm_orders",
  "mtm_external_id_maps",
  "mtm_erp_sync_logs",
  "mtm_credit_limits",
  "mtm_shelf_analyses",
  "mtm_equipment",
  "mtm_skus",
  "mtm_warehouses",
  "mtm_planograms",
  "mtm_equipment_types",
  "mtm_sku_categories",
  "mtm_promotions"
CASCADE;

-- Enums used exclusively by the dropped models. MtmCustomerCategory is NOT
-- dropped — it is shared with the live MtmCustomer.category column.
DROP TYPE IF EXISTS "MtmOrderStatus";
DROP TYPE IF EXISTS "MtmPromotionType";
DROP TYPE IF EXISTS "MtmShelfAnalysisStatus";
DROP TYPE IF EXISTS "MtmAnnotationSource";
DROP TYPE IF EXISTS "MtmTrainingRunStatus";
DROP TYPE IF EXISTS "MtmPlanogramCheckStatus";
DROP TYPE IF EXISTS "MtmEquipmentStatus";
DROP TYPE IF EXISTS "MtmEquipmentCondition";
DROP TYPE IF EXISTS "MtmEquipmentEvent";
DROP TYPE IF EXISTS "MtmRepairPriority";
DROP TYPE IF EXISTS "MtmRepairStatus";

-- SET lock_timeout is session-scoped and `migrate deploy` reuses one
-- connection across pending migrations — don't leak the 3s budget into a
-- later migration in the same run.
RESET lock_timeout;
