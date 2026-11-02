-- The product's name exactly as Zeytun's 1C has it (Наименование), for the
-- order document the pharmacy gets (owner, 2026-10-29: «название как в 1С,
-- если там на русском — на русском»). productName stays what the card shows.
ALTER TABLE "pharmacy_phone_order_lines" ADD COLUMN "sourceName" TEXT;
