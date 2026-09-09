-- S6 CPQ slice-3 piece-3: email-open tracking.
--
-- Per-quote opaque token embedded in the customer email's 1×1 pixel
-- URL. Server route looks up the quote by token + atomically transitions
-- `sent → viewed`. Token is nullable so existing draft/sent quotes (which
-- already shipped without a pixel) don't need a backfill. New quotes get
-- a `crypto.randomUUID()` token at POST time in the route layer.
--
-- Partial unique index — Postgres treats multiple NULLs as distinct
-- under a UNIQUE constraint, so a regular unique on a nullable column
-- works fine here; the index name is fixed to match the Prisma `@unique`
-- map so future `prisma migrate diff` doesn't re-rename it.

ALTER TABLE "quotes"
  ADD COLUMN "trackingToken" TEXT;

CREATE UNIQUE INDEX "quotes_tracking_token_uniq"
  ON "quotes"("trackingToken");
