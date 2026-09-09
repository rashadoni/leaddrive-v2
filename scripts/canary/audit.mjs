// Read-only pre-flight audit for the Bright Data live canary (runbook Step 0).
// Confirms starting posture for the brandprotection tenant before any routing
// flip or spend: route-plan Apify residue, capability proofs, current paid-run
// policy, and the blast radius of the GLOBAL SOCIAL_MONITORING_ENFORCE_USD_BUDGETS
// flag (which other tenants would it affect).
//
// NO WRITES. NO SPEND. Prints ids/statuses/counts only — no tokens or secrets.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
const SRC = "cmrlscyhx0036506ruferpk9c" // TikTok keyword source "araz supermarket" (runbook)
const BD_ONLY = ["tiktok", "instagram", "facebook"]
const SOCIAL_REPLY_PROMPT_VERSION = "social-reply-v4-tenant-responder"
const SOCIAL_REPLY_TARGETS = [
  { key: "araz", normalizedNamePrefix: "araz" },
  { key: "baku_electronics", normalizedNamePrefix: "baku electronics" },
  { key: "oba", normalizedNamePrefix: "oba" },
]

function isApifyResidue(p) {
  return p.primaryAdapter === "APIFY_ASYNC"
    || (p.fallbackAdapters || []).includes("APIFY_ASYNC")
    || p.acquisitionMode === "APIFY_FALLBACK"
}

function aggregateCount(row, key) {
  const value = row?.[key]
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value)
  throw new Error(`[canary-audit] invalid aggregate ${key}`)
}

async function collectSocialMonitoringQueueCounts(organizationId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [counts] = await prisma.$queryRaw`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM "social_mentions" m
        WHERE m."organizationId" = ${organizationId}
          AND m."externalId" <> '__tg_offset__'
          AND m."purgedAt" IS NULL
          AND m."deletedAtSource" IS NULL
          AND LOWER(COALESCE(m."sentiment", '')) = 'negative'
      ) AS "negativeMentions",
      (
        SELECT COUNT(*)::int
        FROM "social_mentions" m
        WHERE m."organizationId" = ${organizationId}
          AND m."externalId" <> '__tg_offset__'
          AND m."purgedAt" IS NULL
          AND m."deletedAtSource" IS NULL
          AND LOWER(COALESCE(m."sentiment", '')) = 'negative'
          AND (
            m."contentKind" IN ('POST', 'COMMENT', 'REPLY')
            OR m."sourceType" IN ('post', 'comment', 'reply')
          )
      ) AS "negativePostCommentReplyMentions",
      (
        SELECT COUNT(*)::int
        FROM "social_mentions" m
        WHERE m."organizationId" = ${organizationId}
          AND m."status" = 'new'
          AND m."createdAt" >= ${sevenDaysAgo}
          AND m."sentiment" = 'negative'
          AND m."platform" IN ('twitter', 'facebook', 'instagram', 'tiktok')
          AND (
            m."contentKind" IN ('POST', 'COMMENT', 'REPLY')
            OR m."sourceType" IN ('post', 'comment', 'reply')
          )
      ) AS "negativeAutoEligible7d",
      (
        SELECT COUNT(*)::int
        FROM "social_mentions" m
        WHERE m."organizationId" = ${organizationId}
          AND m."status" = 'new'
          AND m."createdAt" >= ${sevenDaysAgo}
          AND m."sentiment" = 'negative'
          AND m."platform" IN ('twitter', 'facebook', 'instagram', 'tiktok')
          AND (
            m."contentKind" IN ('POST', 'COMMENT', 'REPLY')
            OR m."sourceType" IN ('post', 'comment', 'reply')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "social_mention_ai_drafts" d
            WHERE d."organizationId" = m."organizationId"
              AND d."mentionId" = m."id"
          )
      ) AS "negativeAutoPending7d",
      (
        SELECT COUNT(*)::int
        FROM "social_mention_ai_drafts" d
        WHERE d."organizationId" = ${organizationId}
          AND d."status" = 'needs_approval'
      ) AS "needsApprovalDrafts",
      (
        SELECT COUNT(DISTINCT d."mentionId")::int
        FROM "social_mention_ai_drafts" d
        WHERE d."organizationId" = ${organizationId}
          AND d."status" = 'needs_approval'
      ) AS "needsApprovalMentions",
      (
        SELECT COUNT(*)::int
        FROM "manual_engagement_tasks" t
        WHERE t."organizationId" = ${organizationId}
          AND t."status" IN ('OPEN', 'IN_PROGRESS')
      ) AS "openManualTasks",
      (
        SELECT COUNT(*)::int
        FROM "social_mentions" m
        WHERE m."organizationId" = ${organizationId}
          AND m."externalId" <> '__tg_offset__'
          AND m."purgedAt" IS NULL
          AND m."deletedAtSource" IS NULL
          AND (
            EXISTS (
              SELECT 1
              FROM "social_mention_ai_drafts" d
              WHERE d."organizationId" = m."organizationId"
                AND d."mentionId" = m."id"
                AND d."status" = 'needs_approval'
            )
            OR EXISTS (
              SELECT 1
              FROM "manual_engagement_tasks" t
              WHERE t."organizationId" = m."organizationId"
                AND t."mentionId" = m."id"
                AND t."status" IN ('OPEN', 'IN_PROGRESS')
            )
          )
      ) AS "replyQueueMentions"
  `
  if (!counts) throw new Error("[canary-audit] Social Monitoring aggregate returned no row")
  return counts
}

async function collectSocialReplyTargetCounts(organizationId, normalizedNamePrefix) {
  // The CTEs retain only identifiers, states, booleans, and aggregate counts.
  // Snapshot JSON is inspected in PostgreSQL for binding/version equality and
  // is never selected into the script output.
  const [counts] = await prisma.$queryRaw`
    WITH target_subjects AS (
      SELECT s."id", s."assignedAgentId"
      FROM "monitoring_subjects" s
      WHERE s."organizationId" = ${organizationId}
        AND s."status" <> 'deleted'
        AND (
          LOWER(BTRIM(s."name")) = ${normalizedNamePrefix}
          OR LOWER(BTRIM(s."name")) LIKE ${`${normalizedNamePrefix} %`}
        )
    ),
    target_drafts AS (
      SELECT DISTINCT
        d."id",
        d."status",
        CASE
          WHEN d."subjectId" IS NULL THEN TRUE
          WHEN bound_subject."id" IS NULL THEN TRUE
          WHEN COALESCE(d."promptSnapshot" ->> 'version', '') <> ${SOCIAL_REPLY_PROMPT_VERSION} THEN TRUE
          WHEN bound_subject."assignedAgentId" IS NULL
            THEN COALESCE(d."agentSnapshot" ->> 'binding', '') <> 'SAFE_DEFAULT'
          ELSE
            COALESCE(d."agentSnapshot" ->> 'binding', '') <> 'SUBJECT'
            OR COALESCE(d."agentSnapshot" ->> 'id', '') <> bound_subject."assignedAgentId"
        END AS "isUnsafe"
      FROM "social_mention_ai_drafts" d
      LEFT JOIN "monitoring_subjects" bound_subject
        ON bound_subject."organizationId" = d."organizationId"
        AND bound_subject."id" = d."subjectId"
      WHERE d."organizationId" = ${organizationId}
        AND (
          EXISTS (
            SELECT 1
            FROM target_subjects ts
            WHERE ts."id" = d."subjectId"
          )
          OR (
            d."subjectId" IS NULL
            AND EXISTS (
              SELECT 1
              FROM "social_mention_subject_matches" sm
              JOIN target_subjects ts ON ts."id" = sm."subjectId"
              WHERE sm."organizationId" = d."organizationId"
                AND sm."mentionId" = d."mentionId"
                AND sm."status" = 'MATCHED'
            )
          )
        )
    ),
    target_outbound AS (
      SELECT o."id", o."draftId", o."state", o."sentAt"
      FROM "outbound_social_replies" o
      WHERE o."organizationId" = ${organizationId}
        AND (
          EXISTS (
            SELECT 1
            FROM target_subjects ts
            WHERE ts."id" = o."subjectId"
          )
          OR EXISTS (
            SELECT 1
            FROM target_drafts td
            WHERE td."id" = o."draftId"
          )
        )
    )
    SELECT
      (SELECT COUNT(*)::int FROM target_subjects) AS "subjects",
      (
        SELECT COUNT(*)::int
        FROM target_subjects ts
        WHERE ts."assignedAgentId" IS NOT NULL
      ) AS "assignedSubjects",
      (
        SELECT COUNT(*)::int
        FROM target_subjects ts
        JOIN "ai_agent_configs" a
          ON a."organizationId" = ${organizationId}
          AND a."id" = ts."assignedAgentId"
        WHERE a."agentType" = 'social'
          AND a."isActive" = TRUE
          AND NULLIF(BTRIM(a."systemPrompt"), '') IS NOT NULL
      ) AS "readyAssignedSubjects",
      (SELECT COUNT(*)::int FROM target_drafts) AS "drafts",
      (
        SELECT COUNT(*)::int
        FROM target_drafts td
        WHERE td."status" = 'needs_approval'
      ) AS "needsApprovalDrafts",
      (
        SELECT COUNT(*)::int
        FROM target_drafts td
        WHERE td."isUnsafe" = TRUE
      ) AS "legacyUnsafeDrafts",
      (
        SELECT COUNT(*)::int
        FROM target_drafts td
        WHERE td."isUnsafe" = TRUE
          AND td."status" = 'needs_approval'
      ) AS "legacyUnsafeNeedsApproval",
      (SELECT COUNT(*)::int FROM target_outbound) AS "outboundReplies",
      (
        SELECT COUNT(*)::int
        FROM target_outbound o
        WHERE o."sentAt" IS NOT NULL OR o."state" = 'SENT'
      ) AS "outboundSent",
      (
        SELECT COUNT(*)::int
        FROM target_outbound o
        JOIN target_drafts td ON td."id" = o."draftId"
        WHERE td."isUnsafe" = TRUE
      ) AS "unsafeDraftOutboundReplies",
      (
        SELECT COUNT(*)::int
        FROM target_outbound o
        JOIN target_drafts td ON td."id" = o."draftId"
        WHERE td."isUnsafe" = TRUE
          AND o."state" IN ('PENDING', 'APPROVED', 'QUEUED', 'SENDING', 'FAILED', 'RECONCILIATION_REQUIRED')
      ) AS "unsafeDraftOutboundAtRisk",
      (
        SELECT COUNT(*)::int
        FROM target_outbound o
        JOIN target_drafts td ON td."id" = o."draftId"
        WHERE td."isUnsafe" = TRUE
          AND (o."sentAt" IS NOT NULL OR o."state" = 'SENT')
      ) AS "unsafeDraftOutboundSent"
  `
  if (!counts) throw new Error("[canary-audit] target aggregate returned no row")
  return counts
}

async function printSocialMonitoringProductionSmoke(organizationId) {
  const queue = await collectSocialMonitoringQueueCounts(organizationId)
  console.log("--- Social Monitoring production data smoke (aggregate-only) ---")
  console.log(
    `    negativeMentions=${aggregateCount(queue, "negativeMentions")}`
      + ` negativePostCommentReplyMentions=${aggregateCount(queue, "negativePostCommentReplyMentions")}`
      + ` negativeAutoEligible7d=${aggregateCount(queue, "negativeAutoEligible7d")}`
      + ` negativeAutoPending7d=${aggregateCount(queue, "negativeAutoPending7d")}`,
  )
  console.log(
    `    needsApprovalDrafts=${aggregateCount(queue, "needsApprovalDrafts")}`
      + ` needsApprovalMentions=${aggregateCount(queue, "needsApprovalMentions")}`
      + ` openManualTasks=${aggregateCount(queue, "openManualTasks")}`
      + ` replyQueueMentions=${aggregateCount(queue, "replyQueueMentions")}`,
  )

  for (const target of SOCIAL_REPLY_TARGETS) {
    const counts = await collectSocialReplyTargetCounts(organizationId, target.normalizedNamePrefix)
    console.log(
      `    target=${target.key}`
        + ` subjects=${aggregateCount(counts, "subjects")}`
        + ` assignedSubjects=${aggregateCount(counts, "assignedSubjects")}`
        + ` readyAssignedSubjects=${aggregateCount(counts, "readyAssignedSubjects")}`,
    )
    console.log(
      `      drafts=${aggregateCount(counts, "drafts")}`
        + ` needsApproval=${aggregateCount(counts, "needsApprovalDrafts")}`
        + ` legacyUnsafe=${aggregateCount(counts, "legacyUnsafeDrafts")}`
        + ` legacyUnsafeNeedsApproval=${aggregateCount(counts, "legacyUnsafeNeedsApproval")}`,
    )
    console.log(
      `      outboundReplies=${aggregateCount(counts, "outboundReplies")}`
        + ` outboundSent=${aggregateCount(counts, "outboundSent")}`
        + ` unsafeDraftOutboundReplies=${aggregateCount(counts, "unsafeDraftOutboundReplies")}`
        + ` unsafeDraftOutboundAtRisk=${aggregateCount(counts, "unsafeDraftOutboundAtRisk")}`
        + ` unsafeDraftOutboundSent=${aggregateCount(counts, "unsafeDraftOutboundSent")}`,
    )
  }
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true, slug: true, name: true } })
  if (!org) { console.error(`[canary-audit] no tenant slug=${SLUG}`); process.exit(1) }
  console.log(`[canary-audit] tenant=${org.slug} (${org.name})`)

  // --- Target source ---
  const src = await prisma.monitoringSource.findFirst({
    where: { organizationId: org.id, id: SRC },
    select: { id: true, platform: true, sourceType: true, status: true, handle: true, query: true, cadenceMinutes: true },
  })
  console.log(`--- Target source ${SRC} ---`)
  console.log(src ? `  platform=${src.platform} type=${src.sourceType} status=${src.status} q=${src.handle || src.query || "-"} cadence=${src.cadenceMinutes}m` : `  NOT FOUND`)

  // --- Route plans for Bright-Data-only platforms ---
  const plans = await prisma.sourceRoutePlan.findMany({
    where: { organizationId: org.id, platform: { in: BD_ONLY } },
    select: { platform: true, capability: true, primaryAdapter: true, fallbackAdapters: true, acquisitionMode: true, status: true, capabilityProofId: true, sourceId: true },
    orderBy: [{ platform: "asc" }, { capability: "asc" }],
  })
  const residue = plans.filter(p => isApifyResidue(p) && p.status !== "INVALIDATED")
  console.log(`--- Route plans (tiktok/ig/fb): ${plans.length} total; APIFY residue (non-INVALIDATED): ${residue.length} ---`)
  const byKey = new Map()
  for (const p of plans) {
    const k = `${p.platform}/${p.capability}/${p.primaryAdapter}/${p.status}`
    byKey.set(k, (byKey.get(k) || 0) + 1)
  }
  for (const [k, n] of [...byKey.entries()].sort()) console.log(`    ${k}  x${n}`)
  if (residue.length) {
    console.log(`  !! APIFY residue rows:`)
    for (const p of residue) console.log(`     ${p.platform}/${p.capability} primary=${p.primaryAdapter} fb=[${p.fallbackAdapters}] mode=${p.acquisitionMode} status=${p.status}`)
  }
  // tiktok READ_EXTERNAL_COMMENTS route(s) specifically (the canary path)
  const ttComments = plans.filter(p => p.platform === "tiktok" && p.capability === "READ_EXTERNAL_COMMENTS")
  console.log(`--- tiktok READ_EXTERNAL_COMMENTS routes: ${ttComments.length} ---`)
  for (const p of ttComments) console.log(`    primary=${p.primaryAdapter} mode=${p.acquisitionMode} status=${p.status} proof=${p.capabilityProofId ? "yes" : "no"} src=${p.sourceId === SRC ? "TARGET" : p.sourceId.slice(0,8)}`)

  // --- Capability proofs ---
  const proofs = await prisma.socialProviderCapabilityProof.findMany({
    where: { organizationId: org.id },
    select: { platform: true, capability: true, providerKey: true, adapterKey: true, status: true, readAllowed: true, exportAllowed: true, replyAllowed: true, expiresAt: true },
    orderBy: [{ platform: "asc" }, { capability: "asc" }, { status: "asc" }],
  })
  console.log(`--- Capability proofs: ${proofs.length} ---`)
  for (const p of proofs) {
    console.log(`    ${p.status.padEnd(8)} ${p.platform.padEnd(10)} ${p.capability.padEnd(24)} ${p.providerKey}/${p.adapterKey}` +
      ` read=${p.readAllowed?"y":"n"} export=${p.exportAllowed?"y":"n"} reply=${p.replyAllowed?"y":"n"}` +
      ` exp=${p.expiresAt ? p.expiresAt.toISOString().slice(0,10) : "-"}`)
  }

  // --- Current paid-run policy (brandprotection) ---
  const orgSettings = await prisma.organization.findUnique({ where: { id: org.id }, select: { settings: true } })
  const pol = (orgSettings?.settings && typeof orgSettings.settings === "object" ? orgSettings.settings.socialMonitoringPaidRuns : null) || {}
  console.log(`--- Paid-run policy (brandprotection) ---`)
  console.log(`    manualRunsEnabled=${pol.manualRunsEnabled === true} emergencyStopped=${pol.emergencyStopped !== false}` +
    ` maxPerRunUsd=${pol.maxPerRunUsd ?? 0} dailyUsd=${pol.dailyBudgetUsd ?? 0} monthlyUsd=${pol.monthlyBudgetUsd ?? 0}` +
    ` dailyRunQuota=${pol.dailyRunQuota ?? 0} authorized=${Boolean(pol.authorizedAt && pol.authorizedBy)}`)

  // --- GLOBAL ENFORCE flag blast radius: other tenants with an enabled paid policy ---
  const allOrgs = await prisma.organization.findMany({ select: { id: true, slug: true, settings: true } })
  const enabledElsewhere = allOrgs.filter(o => {
    if (o.id === org.id) return false
    const p = o.settings && typeof o.settings === "object" ? o.settings.socialMonitoringPaidRuns : null
    return p && p.manualRunsEnabled === true
  })
  console.log(`--- GLOBAL SOCIAL_MONITORING_ENFORCE_USD_BUDGETS blast radius ---`)
  console.log(`    total tenants=${allOrgs.length}; OTHER tenants with manualRunsEnabled paid policy: ${enabledElsewhere.length}`)
  for (const o of enabledElsewhere) console.log(`      - ${o.slug}`)

  await printSocialMonitoringProductionSmoke(org.id)
}

main()
  .catch((err) => { console.error("[canary-audit] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
