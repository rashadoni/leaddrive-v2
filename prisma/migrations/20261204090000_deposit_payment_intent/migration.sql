-- A card payment that holds a meeting's deposit points at the meeting, the
-- way an invoice payment points at its invoice. Additive and nullable: every
-- payment that exists today keeps meaning exactly what it meant.
ALTER TABLE "payment_intents" ADD COLUMN "bookingId" TEXT;
CREATE INDEX "payment_intents_bookingId_idx" ON "payment_intents"("bookingId");
