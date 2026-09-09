-- Social Monitoring V2 / PR3: tenant-bound subjects, aliases, source and reply
-- identity mappings, plus durable mention-to-subject match provenance.

SELECT set_config('app.rls_bypass', 'on', false);

ALTER TABLE "ingest_envelopes"
  ADD COLUMN "subjectDecision" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "social_mentions"
  ADD COLUMN "acquisitionMode" TEXT,
  ADD COLUMN "policySnapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "retentionClass" TEXT NOT NULL DEFAULT 'OPERATIONAL_180D',
  ADD COLUMN "purgeAt" TIMESTAMP(3),
  ADD COLUMN "purgedAt" TIMESTAMP(3);

ALTER TABLE "mention_evidence" ADD COLUMN "purgedAt" TIMESTAMP(3);

UPDATE "social_mentions"
SET "purgeAt" = COALESCE("publishedAt", "createdAt") + INTERVAL '180 days'
WHERE "purgeAt" IS NULL;

CREATE INDEX "social_mentions_org_purge_idx" ON "social_mentions"("organizationId", "purgeAt", "purgedAt");
CREATE INDEX "mention_evidence_retention_idx" ON "mention_evidence"("organizationId", "capturedAt", "purgedAt");

CREATE TABLE "monitoring_subjects" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "geographies" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "requiredContext" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sensitiveCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "assignedAgentId" TEXT,
  "replyPolicy" JSONB NOT NULL DEFAULT '{}',
  "legalPolicy" JSONB NOT NULL DEFAULT '{}',
  "legacyScenarioId" TEXT,
  "aliasesVersion" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "monitoring_subjects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitoring_subjects_type_check" CHECK ("type" IN ('COMPANY','PERSON','BRAND','PRODUCT','ORGANIZATION','TOPIC','EVENT')),
  CONSTRAINT "monitoring_subjects_status_check" CHECK ("status" IN ('active','paused','archived'))
);

CREATE TABLE "monitoring_subject_aliases" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "language" TEXT,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "isNegative" BOOLEAN NOT NULL DEFAULT false,
  "isAmbiguous" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "monitoring_subject_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitoring_subject_aliases_kind_check" CHECK ("kind" IN ('NAME','TRANSLITERATION','INFLECTION','HANDLE','HASHTAG','DOMAIN','TYPO','CONTEXT','NEGATIVE')),
  CONSTRAINT "monitoring_subject_aliases_weight_check" CHECK ("weight" >= 0 AND "weight" <= 1)
);

CREATE TABLE "monitoring_subject_relations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "relatedSubjectId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monitoring_subject_relations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitoring_subject_relations_distinct_check" CHECK ("subjectId" <> "relatedSubjectId"),
  CONSTRAINT "monitoring_subject_relations_type_check" CHECK ("relationType" IN ('BRAND_OF', 'PRODUCT_OF', 'REPRESENTATIVE_OF', 'COMPETITOR_OF', 'RELATED_TO')),
  CONSTRAINT "monitoring_subject_relations_weight_check" CHECK ("weight" >= 0 AND "weight" <= 1)
);

CREATE TABLE "monitoring_subject_sources" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "scenarioId" TEXT,
  "relationType" TEXT NOT NULL DEFAULT 'MONITORS',
  "trustWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monitoring_subject_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitoring_subject_sources_weight_check" CHECK ("trustWeight" >= 0 AND "trustWeight" <= 1)
);

CREATE TABLE "social_reply_identities" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "socialAccountId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "signature" TEXT,
  "allowOwnedReply" BOOLEAN NOT NULL DEFAULT true,
  "allowExternalReply" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_reply_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_reply_identities_status_check" CHECK ("status" IN ('active','paused','revoked'))
);

CREATE TABLE "social_mention_subject_matches" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'MATCHED',
  "reason" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "matchedAliasIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "contextSignals" JSONB NOT NULL DEFAULT '{}',
  "matcherVersion" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_mention_subject_matches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_mention_subject_matches_status_check" CHECK ("status" IN ('MATCHED','REVIEW','REJECTED')),
  CONSTRAINT "social_mention_subject_matches_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE INDEX "monitoring_subjects_org_status_type_idx" ON "monitoring_subjects"("organizationId", "status", "type");
CREATE INDEX "monitoring_subjects_org_name_idx" ON "monitoring_subjects"("organizationId", "name");
CREATE UNIQUE INDEX "monitoring_subjects_org_id_key" ON "monitoring_subjects"("organizationId", "id");
CREATE UNIQUE INDEX "monitoring_subjects_org_legacy_scenario_key" ON "monitoring_subjects"("organizationId", "legacyScenarioId");
CREATE INDEX "monitoring_subject_aliases_lookup_idx" ON "monitoring_subject_aliases"("organizationId", "normalizedValue", "isNegative");
CREATE UNIQUE INDEX "monitoring_subject_aliases_org_id_key" ON "monitoring_subject_aliases"("organizationId", "id");
CREATE UNIQUE INDEX "monitoring_subject_aliases_org_subject_kind_value_key" ON "monitoring_subject_aliases"("organizationId", "subjectId", "kind", "normalizedValue");
CREATE INDEX "monitoring_subject_relations_related_idx" ON "monitoring_subject_relations"("organizationId", "relatedSubjectId");
CREATE UNIQUE INDEX "monitoring_subject_relations_org_id_key" ON "monitoring_subject_relations"("organizationId", "id");
CREATE UNIQUE INDEX "monitoring_subject_relations_unique_key" ON "monitoring_subject_relations"("organizationId", "subjectId", "relatedSubjectId", "relationType");
CREATE INDEX "monitoring_subject_sources_source_idx" ON "monitoring_subject_sources"("organizationId", "sourceId");
CREATE INDEX "monitoring_subject_sources_scenario_idx" ON "monitoring_subject_sources"("organizationId", "scenarioId");
CREATE UNIQUE INDEX "monitoring_subject_sources_org_id_key" ON "monitoring_subject_sources"("organizationId", "id");
CREATE UNIQUE INDEX "monitoring_subject_sources_org_subject_source_key" ON "monitoring_subject_sources"("organizationId", "subjectId", "sourceId");
CREATE INDEX "social_reply_identities_platform_idx" ON "social_reply_identities"("organizationId", "platform", "status", "priority");
CREATE UNIQUE INDEX "social_reply_identities_org_id_key" ON "social_reply_identities"("organizationId", "id");
CREATE UNIQUE INDEX "social_reply_identities_org_subject_account_key" ON "social_reply_identities"("organizationId", "subjectId", "socialAccountId");
CREATE INDEX "social_mention_subject_matches_subject_idx" ON "social_mention_subject_matches"("organizationId", "subjectId", "status", "decidedAt");
CREATE INDEX "social_mention_subject_matches_mention_idx" ON "social_mention_subject_matches"("organizationId", "mentionId", "confidence");
CREATE UNIQUE INDEX "social_mention_subject_matches_org_id_key" ON "social_mention_subject_matches"("organizationId", "id");
CREATE UNIQUE INDEX "social_mention_subject_matches_org_mention_subject_key" ON "social_mention_subject_matches"("organizationId", "mentionId", "subjectId");

ALTER TABLE "monitoring_subjects" ADD CONSTRAINT "monitoring_subjects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitoring_subject_aliases" ADD CONSTRAINT "monitoring_subject_aliases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitoring_subject_aliases" ADD CONSTRAINT "monitoring_subject_aliases_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitoring_subject_relations" ADD CONSTRAINT "monitoring_subject_relations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitoring_subject_relations" ADD CONSTRAINT "monitoring_subject_relations_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitoring_subject_relations" ADD CONSTRAINT "monitoring_subject_relations_organizationId_relatedSubject_fkey" FOREIGN KEY ("organizationId", "relatedSubjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitoring_subject_sources" ADD CONSTRAINT "monitoring_subject_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitoring_subject_sources" ADD CONSTRAINT "monitoring_subject_sources_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitoring_subject_sources" ADD CONSTRAINT "monitoring_subject_sources_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "monitoring_sources"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_reply_identities" ADD CONSTRAINT "social_reply_identities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_reply_identities" ADD CONSTRAINT "social_reply_identities_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_reply_identities" ADD CONSTRAINT "social_reply_identities_organizationId_socialAccountId_fkey" FOREIGN KEY ("organizationId", "socialAccountId") REFERENCES "social_accounts"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_mention_subject_matches" ADD CONSTRAINT "social_mention_subject_matches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_mention_subject_matches" ADD CONSTRAINT "social_mention_subject_matches_organizationId_mentionId_fkey" FOREIGN KEY ("organizationId", "mentionId") REFERENCES "social_mentions"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_mention_subject_matches" ADD CONSTRAINT "social_mention_subject_matches_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lossless compatibility: every legacy scenario becomes a TOPIC subject. It is
-- intentionally not guessed as BRAND/PERSON; operators can refine the type.
WITH scenarios AS (
  SELECT cfg."organizationId", scenario
  FROM "channel_configs" cfg
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cfg."settings"->'scenarios', '[]'::jsonb)) scenario
  WHERE cfg."channelType" = 'social_monitoring'
    AND cfg."configName" = 'Monitoring scenarios'
), normalized AS (
  SELECT "organizationId", scenario,
    NULLIF(scenario->>'id', '') AS scenario_id,
    COALESCE(NULLIF(scenario->>'name', ''), 'Legacy monitoring scenario') AS scenario_name
  FROM scenarios
)
INSERT INTO "monitoring_subjects" (
  "id", "organizationId", "type", "name", "description", "legacyScenarioId", "createdAt", "updatedAt"
)
SELECT 'legacy_' || substr(md5("organizationId" || ':' || scenario_id), 1, 24),
  "organizationId", 'TOPIC', scenario_name, NULLIF(scenario->>'description', ''), scenario_id,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM normalized
WHERE scenario_id IS NOT NULL
ON CONFLICT ("organizationId", "legacyScenarioId") DO NOTHING;

WITH scenarios AS (
  SELECT cfg."organizationId", scenario
  FROM "channel_configs" cfg
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cfg."settings"->'scenarios', '[]'::jsonb)) scenario
  WHERE cfg."channelType" = 'social_monitoring'
    AND cfg."configName" = 'Monitoring scenarios'
), alias_values AS (
  SELECT s."organizationId", s.scenario->>'id' AS scenario_id, 'NAME'::TEXT AS kind,
    s.scenario->>'name' AS value, 1.0::DOUBLE PRECISION AS weight
  FROM scenarios s
  UNION ALL
  SELECT s."organizationId", s.scenario->>'id', category.kind, item.value, category.weight
  FROM scenarios s
  CROSS JOIN LATERAL (VALUES
    ('CONTEXT'::TEXT, COALESCE(s.scenario#>'{search,topics}', '[]'::jsonb), 0.75::DOUBLE PRECISION),
    ('NAME'::TEXT, COALESCE(s.scenario#>'{search,keywords}', '[]'::jsonb), 0.90::DOUBLE PRECISION),
    ('HASHTAG'::TEXT, COALESCE(s.scenario#>'{search,hashtags}', '[]'::jsonb), 0.95::DOUBLE PRECISION),
    ('HANDLE'::TEXT, COALESCE(s.scenario#>'{search,handles}', '[]'::jsonb), 1.0::DOUBLE PRECISION)
  ) category(kind, values_json, weight)
  CROSS JOIN LATERAL jsonb_array_elements_text(category.values_json) item(value)
), deduped AS (
  SELECT DISTINCT ON ("organizationId", scenario_id, kind, normalized_value)
    "organizationId", scenario_id, kind, value, weight, normalized_value
  FROM (
    SELECT *, lower(regexp_replace(trim(leading '#@' from value), '\s+', ' ', 'g')) AS normalized_value
    FROM alias_values
    WHERE NULLIF(trim(value), '') IS NOT NULL AND NULLIF(scenario_id, '') IS NOT NULL
  ) values_normalized
  WHERE normalized_value <> ''
  ORDER BY "organizationId", scenario_id, kind, normalized_value, weight DESC
)
INSERT INTO "monitoring_subject_aliases" (
  "id", "organizationId", "subjectId", "kind", "value", "normalizedValue", "weight", "isAmbiguous", "createdAt", "updatedAt"
)
SELECT 'alias_' || substr(md5(d."organizationId" || ':' || d.scenario_id || ':' || d.kind || ':' || d.normalized_value), 1, 24),
  d."organizationId", subject."id", d.kind, d.value, d.normalized_value, d.weight,
  (char_length(d.normalized_value) <= 4), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM deduped d
JOIN "monitoring_subjects" subject
  ON subject."organizationId" = d."organizationId" AND subject."legacyScenarioId" = d.scenario_id
ON CONFLICT ("organizationId", "subjectId", "kind", "normalizedValue") DO NOTHING;

INSERT INTO "monitoring_subject_sources" (
  "id", "organizationId", "subjectId", "sourceId", "scenarioId", "relationType", "trustWeight", "createdAt"
)
SELECT 'subsrc_' || substr(md5(source."organizationId" || ':' || subject."id" || ':' || source."id"), 1, 24),
  source."organizationId", subject."id", source."id", subject."legacyScenarioId",
  CASE WHEN source."ownership" = 'owned' THEN 'OWNED' ELSE 'MONITORS' END,
  CASE WHEN source."ownership" = 'owned' THEN 1.0 ELSE 0.85 END,
  CURRENT_TIMESTAMP
FROM "monitoring_sources" source
JOIN "monitoring_subjects" subject ON subject."organizationId" = source."organizationId"
WHERE subject."legacyScenarioId" IS NOT NULL
  AND (
    source."settings"->>'scenarioId' = subject."legacyScenarioId"
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(source."settings"->'scenarioLinks', '[]'::jsonb)) link
      WHERE link->>'scenarioId' = subject."legacyScenarioId"
    )
  )
ON CONFLICT ("organizationId", "subjectId", "sourceId") DO NOTHING;

-- Tenant isolation is mandatory even when application code forgets a predicate.
ALTER TABLE "monitoring_subjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_subjects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "monitoring_subjects_tenant_isolation" ON "monitoring_subjects"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "monitoring_subject_aliases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_subject_aliases" FORCE ROW LEVEL SECURITY;
CREATE POLICY "monitoring_subject_aliases_tenant_isolation" ON "monitoring_subject_aliases"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "monitoring_subject_relations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_subject_relations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "monitoring_subject_relations_tenant_isolation" ON "monitoring_subject_relations"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "monitoring_subject_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_subject_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY "monitoring_subject_sources_tenant_isolation" ON "monitoring_subject_sources"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "social_reply_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_reply_identities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "social_reply_identities_tenant_isolation" ON "social_reply_identities"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "social_mention_subject_matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_mention_subject_matches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "social_mention_subject_matches_tenant_isolation" ON "social_mention_subject_matches"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

SELECT set_config('app.rls_bypass', 'off', false);
