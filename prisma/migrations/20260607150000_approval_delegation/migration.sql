-- Slice-3a: Approval Delegation (out-of-office routing)
-- Additive-only migration: new table + new nullable column.
-- No existing columns altered.

-- New table: user_approval_delegates
-- Records a date-window delegation from one user to another.
-- One hop only (no recursive delegation at the application layer).
CREATE TABLE "user_approval_delegates" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromUserId"     TEXT NOT NULL,
    "toUserId"       TEXT NOT NULL,
    "startDate"      TIMESTAMP(3) NOT NULL,
    "endDate"        TIMESTAMP(3) NOT NULL,
    "reason"         TEXT,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_approval_delegates_pkey" PRIMARY KEY ("id")
);

-- Indexes for fast delegation lookup by org+from+active and org+to
CREATE INDEX "user_approval_delegates_organizationId_fromUserId_isActive_idx"
    ON "user_approval_delegates"("organizationId", "fromUserId", "isActive");

CREATE INDEX "user_approval_delegates_organizationId_toUserId_idx"
    ON "user_approval_delegates"("organizationId", "toUserId");

-- Foreign keys
ALTER TABLE "user_approval_delegates"
    ADD CONSTRAINT "user_approval_delegates_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_approval_delegates"
    ADD CONSTRAINT "user_approval_delegates_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_approval_delegates"
    ADD CONSTRAINT "user_approval_delegates_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Additive column: audit who a stage was ORIGINALLY assigned to before
-- delegation resolved it to the delegate. NULL when no delegation occurred.
ALTER TABLE "contract_approval_stages"
    ADD COLUMN "originalAssigneeUserId" TEXT;
