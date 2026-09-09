ALTER TYPE "MtmContactDictionaryKind" ADD VALUE IF NOT EXISTS 'TASK_GROUP';

ALTER TABLE "mtm_tasks"
  ADD COLUMN "taskGroupDictionaryId" TEXT,
  ADD COLUMN "taskGroupCode" TEXT;

CREATE INDEX "mtm_tasks_organizationId_taskGroupDictionaryId_taskGroupCode_idx"
  ON "mtm_tasks"("organizationId", "taskGroupDictionaryId", "taskGroupCode");

ALTER TABLE "mtm_tasks"
  ADD CONSTRAINT "mtm_tasks_task_group_dictionary_fkey"
  FOREIGN KEY ("organizationId", "taskGroupDictionaryId")
  REFERENCES "mtm_contact_dictionaries"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_tasks"
  ADD CONSTRAINT "mtm_tasks_task_group_pair_check"
  CHECK (
    ("taskGroupDictionaryId" IS NULL AND "taskGroupCode" IS NULL)
    OR ("taskGroupDictionaryId" IS NOT NULL AND "taskGroupCode" IS NOT NULL)
  );
