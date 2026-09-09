-- A browser answering an inbound Asterisk call needs both an immutable claim
-- incarnation and a renewable lease. CallLog.claimedAt/userId remain the audit
-- attribution; these fields are the compare-and-set guard that prevents a
-- stale tab from releasing, renewing, or receiving a newer claim.
ALTER TABLE "call_logs"
  ADD COLUMN "browserAnswerClaimToken" TEXT,
  ADD COLUMN "browserAnswerClaimExpiresAt" TIMESTAMP(3);
