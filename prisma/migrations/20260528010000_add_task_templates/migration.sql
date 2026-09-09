-- Roadmap #21 — user-defined task templates.
--
-- Captures the "new task form" pre-fill state so common recurring task
-- patterns can be one-clicked instead of retyped. Personal by default;
-- isShared=true makes the template visible org-wide. Variable
-- substitution ({{date}}, {{user}}, {{month}}, {{week}}) happens
-- client-side at instantiation time.
--
-- Migration is purely additive (new table + FKs) — safe on a live DB.

CREATE TABLE "task_templates" (
  "id"                TEXT NOT NULL PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "taskTitle"         TEXT NOT NULL,
  "taskDescription"   TEXT,
  "priority"          TEXT NOT NULL DEFAULT 'medium',
  "dueDateOffsetDays" INTEGER,
  "assignedTo"        TEXT,
  "relatedType"       TEXT,
  "customFields"      JSONB NOT NULL DEFAULT '{}'::jsonb,
  "checklist"         JSONB NOT NULL DEFAULT '[]'::jsonb,
  "isShared"          BOOLEAN NOT NULL DEFAULT false,
  "usageCount"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "task_templates_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT "task_templates_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Per-user lookup: "show me my templates"
CREATE INDEX "task_templates_organizationId_userId_idx"
  ON "task_templates"("organizationId", "userId");

-- Shared-templates lookup: "show me org-wide templates"
CREATE INDEX "task_templates_organizationId_isShared_idx"
  ON "task_templates"("organizationId", "isShared");
