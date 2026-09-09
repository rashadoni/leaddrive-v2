-- ISO/IEC 27001:2022, Приложение A, контроль 8.15 «Журналирование»:
-- журналы должны быть защищены от несанкционированного изменения и удаления.
-- Находка F-01 в docs/isms/ISMS-02-gap-analysis.md.
--
-- `audit_logs` фиксирует входы в систему, экспорт данных и изменения бизнес-
-- записей — ровно то, что исследуют после инцидента. В отличие от соседней
-- `compliance_audit_log` (миграция 20260521010000) таблица не была защищена:
-- строки можно было изменить или удалить обычным запросом, а единственный
-- носитель прав на БД — один человек, поэтому компенсирующего контроля нет.
--
-- UPDATE запрещается безусловно: в коде нет ни одного обновления журнала
-- (проверено поиском `auditLog.update` / `updateMany` — совпадений нет),
-- значит запрет ничего не ломает.
--
-- DELETE запрещается, КРОМЕ намеренного удаления арендатора. Каскад от
-- `organizations` — единственный легитимный путь удаления этих строк, и
-- полный запрет сломал бы `hardDeleteTenant`. Поэтому вместо безусловного
-- запрета введён явный признак сессии `app.audit_log_purge`: случайный или
-- рутинный DELETE невозможен, а удаление арендатора требует осознанного
-- действия в коде, которое видно при чтении диффа.
--
-- Признак намеренно НЕ распространён на `compliance_audit_log`: ослаблять
-- существующий контроль в рамках этой задачи неправильно. Следствие —
-- удаление арендатора, у которого есть строки в `compliance_audit_log`,
-- по-прежнему завершится ошибкой. Зафиксировано отдельной находкой.

CREATE OR REPLACE FUNCTION audit_logs_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only — UPDATE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;

  -- TG_OP = 'DELETE'
  IF COALESCE(current_setting('app.audit_log_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'audit_logs is append-only — DELETE rejected (id=%); set app.audit_log_purge for a deliberate tenant purge',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_append_only_trigger ON "audit_logs";
CREATE TRIGGER audit_logs_append_only_trigger
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_append_only_fn();
