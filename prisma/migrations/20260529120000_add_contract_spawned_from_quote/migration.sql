-- S6 CPQ slice-3 piece-4: Quote → Contract auto-spawn provenance.
--
-- When a Quote transitions to `accepted`, the route layer creates a
-- Contract inside the same transaction and stamps this column. The
-- `@unique` constraint guarantees one-to-one — a given Quote can spawn
-- at most one Contract. Under concurrent PATCH-to-accepted calls, the
-- second insert violates the unique constraint and the surrounding
-- transaction rolls back; in piece-4 the violation surfaces as a
-- generic 500 (caught by the route's outer try/catch). Piece-4.5 will
-- translate the Prisma P2002 error code into a clean 409 response.
--
-- Nullable so existing contracts (created manually pre-piece-4) don't
-- need a backfill — they keep NULL forever.

ALTER TABLE "contracts"
  ADD COLUMN "spawnedFromQuoteId" TEXT;

CREATE UNIQUE INDEX "contracts_spawned_from_quote_uniq"
  ON "contracts"("spawnedFromQuoteId");
