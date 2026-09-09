-- Разовая чистка: гасим источники, осиротевшие при удалениях клиентов ДО
-- 20260801 (PR #609).
--
-- Контекст. Удаление клиента стирает связи `monitoring_subject_sources`, но
-- раньше не трогало сам источник — он оставался активным и продолжал платно
-- опрашивать провайдера по клиенту, которого больше нет. С #609 удаление само
-- гасит осиротевшие источники и инвалидирует их платные маршруты, но
-- накопившиеся до этого остались активными.
--
-- Что считаем сиротой — только источники с ДОКАЗАННЫМ клиентским
-- происхождением и без единой связи:
--   * `settings.managedBy = 'monitoring_scenario'` — создан сценарием клиента
--     (SOCIAL_SCENARIO_SOURCE_MANAGER, monitoring-scenarios.ts), либо
--   * непустой `settings.scenarioLinks` — легаси-метка того же происхождения.
-- Источники, добавленные ВРУЧНУЮ в реестре «Источники», такими метками не
-- обладают (POST /monitoring-sources их не пишет) и НЕ трогаются: у них связей
-- с клиентом не бывает по определению — см. lib/social/automatic-collection-policy.
--
-- Обратимость. Каждой затронутой строке проставляем
-- `settings.disabledReason = 'orphaned_subject_cleanup_20260801'`, поэтому
-- откат точечный и не заденет источники, выключенные руками:
--   UPDATE "monitoring_sources"
--   SET "status" = 'active',
--       "settings" = "settings" - 'disabledReason'
--   WHERE "settings"->>'disabledReason' = 'orphaned_subject_cleanup_20260801';
--
-- monitoring_sources и source_route_plans под FORCE RLS: миграция идёт без
-- app.org_id, поэтому обычный UPDATE тихо обновил бы 0 строк — используем
-- snapshot/disable/restore, как в 20260705152500.
DO $$
DECLARE
  src_rls boolean;
  src_force_rls boolean;
  plan_rls boolean;
  plan_force_rls boolean;
  link_rls boolean;
  link_force_rls boolean;
  affected integer;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  SELECT relrowsecurity, relforcerowsecurity INTO src_rls, src_force_rls
  FROM pg_class WHERE oid = 'monitoring_sources'::regclass;
  SELECT relrowsecurity, relforcerowsecurity INTO plan_rls, plan_force_rls
  FROM pg_class WHERE oid = 'source_route_plans'::regclass;
  SELECT relrowsecurity, relforcerowsecurity INTO link_rls, link_force_rls
  FROM pg_class WHERE oid = 'monitoring_subject_sources'::regclass;

  ALTER TABLE "monitoring_sources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "source_route_plans" DISABLE ROW LEVEL SECURITY;
  -- Связи читаются в NOT EXISTS: под RLS они не видны, и КАЖДЫЙ источник
  -- выглядел бы осиротевшим. Отключаем и восстанавливаем вместе с остальными.
  ALTER TABLE "monitoring_subject_sources" DISABLE ROW LEVEL SECURITY;

  CREATE TEMP TABLE orphaned_sources ON COMMIT DROP AS
  SELECT ms."id", ms."organizationId"
  FROM "monitoring_sources" AS ms
  WHERE ms."status" IN ('active', 'limited', 'needs_setup')
    AND NOT EXISTS (
      SELECT 1 FROM "monitoring_subject_sources" AS link
      WHERE link."organizationId" = ms."organizationId"
        AND link."sourceId" = ms."id"
    )
    AND (
      ms."settings" ->> 'managedBy' = 'monitoring_scenario'
      OR (
        jsonb_typeof(ms."settings" -> 'scenarioLinks') = 'array'
        AND jsonb_array_length(ms."settings" -> 'scenarioLinks') > 0
      )
    );

  SELECT count(*) INTO affected FROM orphaned_sources;

  UPDATE "monitoring_sources" AS ms
  SET "status" = 'disabled',
      "settings" = jsonb_set(
        COALESCE(ms."settings", '{}'::jsonb),
        '{disabledReason}',
        '"orphaned_subject_cleanup_20260801"'::jsonb,
        true
      )
  FROM orphaned_sources AS o
  WHERE ms."id" = o."id" AND ms."organizationId" = o."organizationId";

  -- Платные маршруты мёртвого источника обязаны уйти вместе с ним, иначе они
  -- всплывут при ручном запуске из реестра (тот же приём, что в #609).
  UPDATE "source_route_plans" AS rp
  SET "status" = 'INVALIDATED'
  FROM orphaned_sources AS o
  WHERE rp."sourceId" = o."id"
    AND rp."organizationId" = o."organizationId"
    AND rp."status" <> 'INVALIDATED';

  RAISE NOTICE 'orphaned scenario sources disabled: %', affected;

  IF src_rls THEN ALTER TABLE "monitoring_sources" ENABLE ROW LEVEL SECURITY;
  ELSE ALTER TABLE "monitoring_sources" DISABLE ROW LEVEL SECURITY; END IF;
  IF src_force_rls THEN ALTER TABLE "monitoring_sources" FORCE ROW LEVEL SECURITY;
  ELSE ALTER TABLE "monitoring_sources" NO FORCE ROW LEVEL SECURITY; END IF;

  IF plan_rls THEN ALTER TABLE "source_route_plans" ENABLE ROW LEVEL SECURITY;
  ELSE ALTER TABLE "source_route_plans" DISABLE ROW LEVEL SECURITY; END IF;
  IF plan_force_rls THEN ALTER TABLE "source_route_plans" FORCE ROW LEVEL SECURITY;
  ELSE ALTER TABLE "source_route_plans" NO FORCE ROW LEVEL SECURITY; END IF;

  IF link_rls THEN ALTER TABLE "monitoring_subject_sources" ENABLE ROW LEVEL SECURITY;
  ELSE ALTER TABLE "monitoring_subject_sources" DISABLE ROW LEVEL SECURITY; END IF;
  IF link_force_rls THEN ALTER TABLE "monitoring_subject_sources" FORCE ROW LEVEL SECURITY;
  ELSE ALTER TABLE "monitoring_subject_sources" NO FORCE ROW LEVEL SECURITY; END IF;
END $$;
