-- Соцмониторинг отделён от Omni-Channel в собственный группу-модуль `social`.
--
-- До этого сайдбар-группа «Social Monitoring» гейтилась тем же `omnichannel`,
-- что и «Communication»: в админке тенанта обе карточки рисовали ОДИН тумблер
-- (по moduleId), поэтому выключение одного уносило второй. Код теперь гейтит
-- соцмониторинг на `social` — этот бэкфилл выдаёт новый модуль всем, у кого
-- сейчас есть `omnichannel`, чтобы после деплоя никто не потерял доступ.
--
-- Покрываем ВСЕ три пути, которыми hasModule (src/lib/modules.ts) выдаёт
-- omnichannel сегодня:
--   1. `features` — массив-строк (авторитетный источник admin-редактора);
--      у части тенантов колонка хранит JSON-СТРОКУ (сид-скрипты пишут
--      JSON.stringify — scripts/seeds/*.mjs), рантайм понимает оба вида
--      (featureFlagsToArray), поэтому чиним оба, сохраняя исходную форму;
--   2. `modules` — JSON-колонка (гранты capability-подписок + результат
--      reconcileModulesWithFeatures);
--   3. `addons` — text[]: hasModule шаг 3 выдаёт модуль как по прямому id
--      `omnichannel`, так и по бандлу `channels` (ADDON_MODULES).
--
-- Порядок деплоя (scripts/server-deploy.sh): migrate deploy идёт ДО swap'а
-- сборки, так что фича попадает в БД раньше, чем новый код начнёт её читать;
-- JWT перематериализует token.modules из Organization.features на ближайшей
-- ротации (src/lib/auth.ts).
--
-- `organizations` НЕ под RLS (это сама таблица тенантов, без organizationId),
-- поэтому обычные UPDATE здесь корректны — DO-блок snapshot/disable/restore
-- не нужен. Идемпотентно: повторный прогон не меняет ни одной строки.
DO $$
DECLARE
  org RECORD;
  feats jsonb;
  string_encoded boolean;
  has_omnichannel boolean;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  FOR org IN SELECT "id", "features", "modules", "addons" FROM "organizations" LOOP
    -- Нормализуем features к массиву, запоминая исходную форму.
    string_encoded := jsonb_typeof(org."features") = 'string';
    IF string_encoded THEN
      BEGIN
        feats := (org."features" #>> '{}')::jsonb;
      EXCEPTION WHEN others THEN
        feats := NULL;   -- не JSON внутри строки → не трогаем
      END;
    ELSE
      feats := org."features";
    END IF;
    IF feats IS NULL OR jsonb_typeof(feats) <> 'array' THEN
      feats := NULL;     -- нераспознанная форма → грант пойдёт через modules
    END IF;

    -- ВНИМАНИЕ на трёхзначную логику: `modules ->> 'omnichannel'` для записи без
    -- этого ключа даёт NULL, а `false OR NULL` = NULL, и тогда `IF NOT ...`
    -- не срабатывает → грант ушёл бы тенанту БЕЗ omnichannel. Поэтому каждый
    -- операнд обёрнут в COALESCE, а проверка — строгая `IS NOT TRUE`.
    has_omnichannel :=
         COALESCE(feats @> '["omnichannel"]'::jsonb, false)
      OR COALESCE(org."modules" ->> 'omnichannel' = 'true', false)
      OR COALESCE('omnichannel' = ANY(org."addons"), false)
      OR COALESCE('channels' = ANY(org."addons"), false);

    IF has_omnichannel IS NOT TRUE THEN
      CONTINUE;
    END IF;

    -- 1) features — основной путь.
    IF feats IS NOT NULL AND NOT (feats @> '["social"]'::jsonb) THEN
      feats := feats || '["social"]'::jsonb;
      IF string_encoded THEN
        UPDATE "organizations" SET "features" = to_jsonb(feats::text) WHERE "id" = org."id";
      ELSE
        UPDATE "organizations" SET "features" = feats WHERE "id" = org."id";
      END IF;
    END IF;

    -- 2) modules — колонка перекрывает features при мердже
    --    (moduleRecordFromOrgFields), поэтому зеркалим грант и туда: обязательно
    --    для capability-грантов и для записей с нечитаемым features. Явно
    --    выставленный ключ `social` (ручное решение админа) не трогаем.
    IF jsonb_typeof(org."modules") = 'object' AND NOT (org."modules" ? 'social') THEN
      IF COALESCE(org."modules" ->> 'omnichannel' = 'true', false) OR feats IS NULL THEN
        UPDATE "organizations"
        SET "modules" = jsonb_set("modules", '{social}', 'true'::jsonb)
        WHERE "id" = org."id";
      END IF;
    END IF;
  END LOOP;
END $$;

-- Шаблоны планов (plan_templates) — источник дефолтов при провижининге нового
-- тенанта (src/lib/plan-templates.ts: активная строка БД выигрывает у констант
-- в коде). Зеркалим правку TENANT_PLANS/seed-plan-templates.mjs, иначе новые
-- enterprise-тенанты создавались бы без соцмониторинга.
UPDATE "plan_templates"
SET "features" = array_append("features", 'social')
WHERE "key" = 'enterprise'
  AND NOT ('social' = ANY("features"));
