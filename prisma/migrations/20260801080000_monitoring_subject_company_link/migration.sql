-- Связь объекта мониторинга с клиентом CRM.
--
-- Одного и того же клиента приходилось заводить дважды: компанию в CRM и
-- отдельный объект мониторинга. Связь nullable и НЕ уникальная — у одной
-- компании может быть несколько наблюдаемых брендов, персон и продуктов.
--
-- ON DELETE SET NULL, а не CASCADE: удаление компании из CRM не имеет права
-- уносить архив упоминаний. Объект мониторинга переживает уход клиента и
-- просто теряет привязку.
--
-- Только DDL, без бэкфилла, поэтому RLS-пляска snapshot/disable/restore не
-- нужна. Обе таблицы живые на проде — ограничиваем ожидание блокировки.
SET lock_timeout = '3s';

ALTER TABLE "monitoring_subjects" ADD COLUMN "companyId" TEXT;

ALTER TABLE "monitoring_subjects"
  ADD CONSTRAINT "monitoring_subjects_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "monitoring_subjects_org_company_idx"
  ON "monitoring_subjects" ("organizationId", "companyId");
