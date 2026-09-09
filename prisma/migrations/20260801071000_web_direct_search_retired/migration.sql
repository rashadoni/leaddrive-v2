-- Вывод из эксплуатации «резервного прямого поиска» по веб-изданиям.
--
-- Решение владельца 2026-08-01: WEB покрывается ТОЛЬКО лентами Google Alerts.
-- Сценарий больше не создаёт канонический keyword-источник, но уже созданные
-- строки на проде живут дальше: крон /api/cron/social-monitoring-sources
-- отбирает источники по СТАТУСУ, ничего не зная о плане сценария, а
-- синхронизацию сценариев по расписанию никто не вызывает (крон
-- social-web-news в прод-кронтабе отсутствует). Без этой миграции обход
-- report.az/baku.ws и фиксированного списка фидов продолжался бы бесконечно.
--
-- Рантайм уже фейлится закрыто (source-route-plan: web/DISCOVER_POSTS без
-- ленты → BLOCKED; findDueMonitoringSources больше не планирует "direct"),
-- миграция приводит данные в соответствие: строки гаснут, их планы
-- инвалидируются, и покрытие клиента перестаёт врать про живой веб-источник.
--
-- monitoring_sources и source_route_plans под FORCE RLS: UPDATE из миграции
-- (без app.org_id) молча обновил бы 0 строк — snapshot/disable/restore, как в
-- 20260705152500_monitoring_external_sources_rls_backfill.
DO $$
DECLARE
  had_rls_sources boolean;
  had_force_rls_sources boolean;
  had_rls_plans boolean;
  had_force_rls_plans boolean;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls_sources, had_force_rls_sources
  FROM pg_class
  WHERE oid = 'monitoring_sources'::regclass;

  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls_plans, had_force_rls_plans
  FROM pg_class
  WHERE oid = 'source_route_plans'::regclass;

  ALTER TABLE "monitoring_sources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "source_route_plans" DISABLE ROW LEVEL SECURITY;

  -- Планы гасим ДО источников: после смены статуса выборка по нему уже не
  -- нашла бы нужные строки.
  UPDATE "source_route_plans" AS p
  SET "status" = 'INVALIDATED',
      "updatedAt" = NOW()
  WHERE p."status" <> 'INVALIDATED'
    AND EXISTS (
      SELECT 1
      FROM "monitoring_sources" AS s
      WHERE s."organizationId" = p."organizationId"
        AND s."id" = p."sourceId"
        AND s."platform" = 'web'
        AND s."sourceType" = 'keyword'
        AND s."collectionMode" = 'search_index'
        AND s."status" IN ('active', 'limited', 'needs_setup')
    );

  UPDATE "monitoring_sources" AS s
  SET "status" = 'disabled',
      "updatedAt" = NOW()
  WHERE s."platform" = 'web'
    AND s."sourceType" = 'keyword'
    AND s."collectionMode" = 'search_index'
    AND s."status" IN ('active', 'limited', 'needs_setup');

  IF had_rls_plans THEN
    ALTER TABLE "source_route_plans" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "source_route_plans" DISABLE ROW LEVEL SECURITY;
  END IF;
  IF had_force_rls_plans THEN
    ALTER TABLE "source_route_plans" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "source_route_plans" NO FORCE ROW LEVEL SECURITY;
  END IF;

  IF had_rls_sources THEN
    ALTER TABLE "monitoring_sources" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "monitoring_sources" DISABLE ROW LEVEL SECURITY;
  END IF;
  IF had_force_rls_sources THEN
    ALTER TABLE "monitoring_sources" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "monitoring_sources" NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
