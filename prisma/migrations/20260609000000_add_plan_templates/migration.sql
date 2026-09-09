-- CreateTable
CREATE TABLE "plan_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "features" TEXT[] NOT NULL DEFAULT '{}',
    "addons" TEXT[] NOT NULL DEFAULT '{}',
    "maxUsers" INTEGER NOT NULL DEFAULT 3,
    "maxContacts" INTEGER NOT NULL DEFAULT 500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_templates_key_key" ON "plan_templates"("key");

-- CreateIndex
CREATE INDEX "plan_templates_isActive_sortOrder_idx" ON "plan_templates"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "organizations_plan_idx" ON "organizations"("plan");
