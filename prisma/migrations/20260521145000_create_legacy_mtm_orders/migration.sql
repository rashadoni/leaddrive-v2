-- Transient fresh-install compatibility for two legacy LeadShelf migrations.
-- The table is intentionally minimal: soft-delete/promotions add the columns
-- they need, and 20260712060000_drop_leadshelf_orphan_tables removes it.
CREATE TABLE IF NOT EXISTS "mtm_orders" (
    "id" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "mtm_orders_pkey" PRIMARY KEY ("id")
);
