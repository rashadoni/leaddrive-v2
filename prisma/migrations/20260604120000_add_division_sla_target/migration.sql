-- Board Reports Tier-3 #14 (SLA achievement): per-board SLA cycle-time target in
-- calendar days. Nullable + no backfill — boards without a value fall back to the
-- global default (DEFAULT_SLA_TARGET_DAYS = 5) in application code. Additive
-- nullable column ⇒ window-free.
ALTER TABLE "divisions" ADD COLUMN "slaTargetDays" INTEGER;
