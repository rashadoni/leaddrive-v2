-- Browser lead calls are a shared work queue, not a client-side filter.  The
-- token is a compare-and-set guard: an old tab cannot release a lease that a
-- later caller acquired after expiry.
ALTER TABLE "leads"
  ADD COLUMN "browserCallClaimToken" TEXT,
  ADD COLUMN "browserCallClaimedByUserId" TEXT,
  ADD COLUMN "browserCallClaimedAt" TIMESTAMP(3),
  ADD COLUMN "browserCallClaimExpiresAt" TIMESTAMP(3);

ALTER TABLE "call_logs"
  ADD COLUMN "leadCallClaimToken" TEXT;
