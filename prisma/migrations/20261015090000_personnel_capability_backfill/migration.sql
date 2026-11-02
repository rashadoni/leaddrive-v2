-- «Персонал» (учёт рабочего дня для HR) — отдельная возможность тенанта
-- `personnel`, продаётся без «Маршрутов и поля» (владелец, 2026-10-14).
--
-- До этого учёт требовал `route-field`. Чтобы после деплоя никто его не потерял,
-- выдаём `personnel` каждому тенанту, у которого `route-field` выдан явным
-- ключом. Тенанты на историческом гранте `mtm` получают `personnel` без записи:
-- его каталог читает тот же legacy-грант (legacyModuleIds: ["mtm"]).
--
-- Пишем в оба источника, как 20260801090000_social_module_split:
--   1. `features` — массив строк, у части тенантов JSON-строка; форму сохраняем;
--   2. `modules` — объект; явно выставленный ключ `personnel` не трогаем.
-- Явный запрет `route-field: false` не превращаем в доступ к «Персоналу».
-- `organizations` не под RLS. Идемпотентно: повторный прогон ничего не меняет.
DO $$
DECLARE
  org RECORD;
  feats jsonb;
  string_encoded boolean;
  route_field_off boolean;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  FOR org IN SELECT "id", "features", "modules" FROM "organizations" LOOP
    string_encoded := jsonb_typeof(org."features") = 'string';
    IF string_encoded THEN
      BEGIN
        feats := (org."features" #>> '{}')::jsonb;
      EXCEPTION WHEN others THEN
        feats := NULL;
      END;
    ELSE
      feats := org."features";
    END IF;
    IF feats IS NULL OR jsonb_typeof(feats) <> 'array' THEN
      feats := NULL;
    END IF;

    route_field_off := jsonb_typeof(org."modules") = 'object'
      AND COALESCE(org."modules" ->> 'route-field' = 'false', false);
    IF route_field_off THEN
      CONTINUE;
    END IF;

    IF feats IS NOT NULL AND feats @> '["route-field"]'::jsonb AND NOT (feats @> '["personnel"]'::jsonb) THEN
      feats := feats || '["personnel"]'::jsonb;
      IF string_encoded THEN
        UPDATE "organizations" SET "features" = to_jsonb(feats::text) WHERE "id" = org."id";
      ELSE
        UPDATE "organizations" SET "features" = feats WHERE "id" = org."id";
      END IF;
    END IF;

    IF jsonb_typeof(org."modules") = 'object'
      AND COALESCE(org."modules" ->> 'route-field' = 'true', false)
      AND NOT (org."modules" ? 'personnel') THEN
      UPDATE "organizations" SET "modules" = jsonb_set("modules", '{personnel}', 'true'::jsonb) WHERE "id" = org."id";
    END IF;
  END LOOP;
END $$;
