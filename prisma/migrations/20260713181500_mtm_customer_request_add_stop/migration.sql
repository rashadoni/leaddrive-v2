ALTER TYPE "MtmRouteChangeType" ADD VALUE IF NOT EXISTS 'ADD_STOP';

ALTER TABLE "mtm_customer_create_requests"
  ADD COLUMN "routeOfferAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "routeChangeRequestId" TEXT;

CREATE INDEX "mtm_customer_create_requests_routeChangeRequestId_idx"
  ON "mtm_customer_create_requests"("routeChangeRequestId");
