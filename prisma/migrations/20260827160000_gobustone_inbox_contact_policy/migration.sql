-- The phone and address are approved tenant facts, so they belong to the Inbox
-- agent's second prompt (knowledgeBase), not to the shared system prompt. The
-- explicit markers are the only contact values deterministic guards trust.
--
-- Scope this data change to the one highest-priority active Inbox persona that
-- already identifies itself as Gobustone/Qobustone. If there is no match, more
-- than one match, or a priority tie, target is empty and the migration fails
-- closed rather than writing the number into an arbitrary tenant.
WITH top_inbox AS (
  SELECT candidate.*
  FROM "ai_agent_configs" AS candidate
  WHERE candidate."agentType" = 'inbox'
    AND candidate."isActive" = true
    AND candidate."organizationId" = (
      SELECT "id" FROM "organizations" WHERE "slug" = 'leaddrive'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "ai_agent_configs" AS higher
      WHERE higher."organizationId" = candidate."organizationId"
        AND higher."agentType" = 'inbox'
        AND higher."isActive" = true
        AND higher."priority" > candidate."priority"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "ai_agent_configs" AS peer
      WHERE peer."organizationId" = candidate."organizationId"
        AND peer."agentType" = 'inbox'
        AND peer."isActive" = true
        AND peer."priority" = candidate."priority"
        AND peer."id" <> candidate."id"
    )
), matched AS (
  SELECT "id"
  FROM top_inbox
  WHERE concat_ws(
    ' ',
    COALESCE("configName", ''),
    COALESCE("systemPrompt", ''),
    COALESCE("knowledgeBase", ''),
    COALESCE("greeting", '')
  ) ILIKE ANY (ARRAY['%gobustone%', '%qobustone%'])
), target AS (
  SELECT "id"
  FROM matched
  WHERE (SELECT count(*) FROM matched) = 1
), cleaned AS (
  SELECT
    config."id",
    regexp_replace(
      regexp_replace(
        COALESCE(config."knowledgeBase", ''),
        '(^|[\r\n]+)[[:blank:]]*APPROVED_COMPANY_PHONE[[:blank:]]*:[^\r\n]*',
        '',
        'gi'
      ),
      '(^|[\r\n]+)[[:blank:]]*APPROVED_COMPANY_ADDRESS[[:blank:]]*:[^\r\n]*',
      '',
      'gi'
    ) AS "knowledgeBase"
  FROM "ai_agent_configs" AS config
  JOIN target ON target."id" = config."id"
)
UPDATE "ai_agent_configs" AS config
SET "knowledgeBase" = concat_ws(
  E'\n\n',
  NULLIF(btrim(cleaned."knowledgeBase"), ''),
  'APPROVED_COMPANY_PHONE: 0507778555',
  'APPROVED_COMPANY_ADDRESS: Bakı şəhəri, Qaradağ rayonu, Səngəçal qəsəbəsi, Salyan şossesi, 47-ci kilometr'
)
FROM cleaned
WHERE config."id" = cleaned."id";
