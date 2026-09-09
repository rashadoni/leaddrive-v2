-- VoIP post-call analytics is now a standalone sidebar group-module instead of
-- a Support child. Preserve access for every tenant that is already entitled
-- through features, modules or the paid `voip` add-on before the new code swaps
-- in. `features` exists in both JSON-array and JSON-string form in production.
DO $$
DECLARE
  org RECORD;
  feats jsonb;
  string_encoded boolean;
  has_voip boolean;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  FOR org IN SELECT "id", "features", "modules", "addons" FROM "organizations" LOOP
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

    -- An existing explicit deny remains authoritative over a paid add-on.
    has_voip :=
      COALESCE(org."modules" ->> 'voip' <> 'false', true)
      AND (
           COALESCE(feats @> '["voip"]'::jsonb, false)
        OR COALESCE(org."modules" ->> 'voip' = 'true', false)
        OR COALESCE('voip' = ANY(org."addons"), false)
      );

    IF has_voip IS NOT TRUE THEN
      CONTINUE;
    END IF;

    IF feats IS NOT NULL AND NOT (feats @> '["voip"]'::jsonb) THEN
      feats := feats || '["voip"]'::jsonb;
      IF string_encoded THEN
        UPDATE "organizations" SET "features" = to_jsonb(feats::text) WHERE "id" = org."id";
      ELSE
        UPDATE "organizations" SET "features" = feats WHERE "id" = org."id";
      END IF;
    END IF;

    IF jsonb_typeof(org."modules") = 'object' AND NOT (org."modules" ? 'voip') THEN
      UPDATE "organizations"
      SET "modules" = jsonb_set("modules", '{voip}', 'true'::jsonb)
      WHERE "id" = org."id";
    END IF;
  END LOOP;
END $$;

UPDATE "plan_templates"
SET "features" = array_append("features", 'voip')
WHERE "key" = 'enterprise'
  AND NOT ('voip' = ANY("features"));
