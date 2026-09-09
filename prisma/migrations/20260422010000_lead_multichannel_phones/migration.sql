-- Add per-channel contact fields to Lead so the Da Vinci Text feature can
-- send through the right destination. `phone` stays as the primary SMS /
-- voice number; `phoneWhatsApp` and `telegramHandle` are optional overrides.
-- All nullable, so the migration is safe on existing data.

ALTER TABLE "leads"
  ADD COLUMN "phoneWhatsApp"  TEXT,
  ADD COLUMN "telegramHandle" TEXT;
