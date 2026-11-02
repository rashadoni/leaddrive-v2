-- Two-step approval of attendance requests: the employee's manager approves
-- first, HR (an administrator) decides. The manager's approval is recorded on
-- the request, which stays PENDING until the final decision. Nullable columns
-- only: existing rows and one-step organizations are unchanged.
ALTER TABLE "mtm_hrm_requests"
  ADD COLUMN "managerApprovedByUserId" TEXT,
  ADD COLUMN "managerApprovedAt" TIMESTAMP(3),
  ADD COLUMN "managerApprovalNote" TEXT;

ALTER TABLE "mtm_hrm_requests" ADD CONSTRAINT "mtm_hrm_requests_manager_approval_complete"
  CHECK (("managerApprovedAt" IS NULL) = ("managerApprovedByUserId" IS NULL));
