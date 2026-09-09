-- Бэкфилл языка для веб-находок (Google Alerts RSS / поиск по новостям).
--
-- AI-триаж структурно не запускается для платформы web (allowlist в
-- ai-triage.ts), поэтому уже собранные web-статьи лежат без
-- sourceMetadata.socialTriage.language, и строгий языковой фильтр ленты
-- (дефолт «Azərbaycan dili») прятал их все. Рантайм-фикс проставляет язык
-- при инжесте (article-language.ts); эта миграция чинит существующие строки
-- той же эвристикой на SQL: кириллица → ru; «ə» / частотные азербайджанские
-- слова / диакритики ğışĞİŞ → az; частотные английские слова → en; иначе
-- язык не трогаем (честное «неизвестно»).
--
-- social_mentions под FORCE RLS: обычный UPDATE из миграции (без app.org_id)
-- молча обновил бы 0 строк — используем snapshot/disable/restore, как в
-- 20260705152500_monitoring_external_sources_rls_backfill.
DO $$
DECLARE
  had_rls boolean;
  had_force_rls boolean;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls, had_force_rls
  FROM pg_class
  WHERE oid = 'social_mentions'::regclass;

  ALTER TABLE "social_mentions" DISABLE ROW LEVEL SECURITY;

  UPDATE "social_mentions" AS sm
  SET "sourceMetadata" = jsonb_set(
    -- Не-объектный корень (legacy-скаляр/массив/JSON null) уронил бы jsonb_set
    -- и весь deploy; такие строки дополнительно исключены и в WHERE.
    CASE
      WHEN jsonb_typeof(sm."sourceMetadata") = 'object' THEN sm."sourceMetadata"
      ELSE '{}'::jsonb
    END,
    '{socialTriage}',
    COALESCE(
      CASE
        WHEN jsonb_typeof(sm."sourceMetadata"->'socialTriage') = 'object'
          THEN sm."sourceMetadata"->'socialTriage'
        ELSE NULL
      END,
      '{}'::jsonb
    ) || jsonb_build_object(
      'language',
      CASE
        WHEN sm."text" ~ '[а-яА-ЯёЁ]' THEN 'ru'
        WHEN sm."text" ~ '[əƏ]' THEN 'az'
        WHEN sm."text" ~* '(^|[^a-zçəğışöü])(və|üçün|ilə|olan|edir|edib|bildirib|deyib|azərbaycan)($|[^a-zçəğışöü])' THEN 'az'
        WHEN sm."text" ~ '[ğışĞİŞ]' THEN 'az'
        WHEN sm."text" ~* '\m(the|and|for|with|from|has|was|will)\M' THEN 'en'
      END
    ),
    true
  )
  WHERE sm."platform" = 'web'
    AND sm."purgedAt" IS NULL
    AND jsonb_typeof(sm."sourceMetadata") = 'object'
    AND (sm."sourceMetadata" #>> '{socialTriage,language}') IS NULL
    AND (
      sm."text" ~ '[а-яА-ЯёЁ]'
      OR sm."text" ~ '[əƏ]'
      OR sm."text" ~* '(^|[^a-zçəğışöü])(və|üçün|ilə|olan|edir|edib|bildirib|deyib|azərbaycan)($|[^a-zçəğışöü])'
      OR sm."text" ~ '[ğışĞİŞ]'
      OR sm."text" ~* '\m(the|and|for|with|from|has|was|will)\M'
    );

  IF had_rls THEN
    ALTER TABLE "social_mentions" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "social_mentions" DISABLE ROW LEVEL SECURITY;
  END IF;

  IF had_force_rls THEN
    ALTER TABLE "social_mentions" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "social_mentions" NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
