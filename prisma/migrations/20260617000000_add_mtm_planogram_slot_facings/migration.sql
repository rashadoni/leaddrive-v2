-- Shelf-AI: persist the per-slot FACING count (how many identical product
-- fronts the slot's box covers). Claude-Vision already returns `facings` in its
-- detection — until now we dropped it before saving the golden slots, so the
-- count never reached the DB or the UI ("количество не пишется"). Additive
-- nullable column: existing rows stay valid (NULL = count not recorded), no
-- data rewrite, no default backfill.
ALTER TABLE "mtm_planogram_slots" ADD COLUMN "facings" INTEGER;
