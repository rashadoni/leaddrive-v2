/**
 * CLM Slice 6c — Backfill cron: generate + upsert embeddings for contracts
 * that have a renderedBody but no ContractEmbedding yet (missing), OR whose
 * embedding is STALE (contractVersionId differs from the contract's latest
 * canonical signed version).
 *
 * POST /api/cron/contract-embeddings
 *   Auth: x-cron-secret header (mirrors loyalty-expiry cron pattern).
 *   Capped at 100 contracts per run to stay within Voyage free-tier + cron timeout.
 *   Returns: { indexed, skipped, errors }
 *
 * FIX 1 (2026-06-08): logs embedding spend per org via logEmbeddingSpend() so
 *   checkAiBudget() meters the Voyage calls this cron makes.
 * FIX 3 (2026-06-08): groups candidates by org; skips the entire org's batch if
 *   (a) ai_semantic_search feature flag is off, OR (b) budget is exceeded.
 *   Opted-out / over-budget tenants no longer incur paid embedding work.
 * FIX 5 (2026-06-08): candidate query now also selects STALE embeddings —
 *   those whose contractVersionId differs from the contract's latest canonical
 *   signed version (ce."contractVersionId" IS DISTINCT FROM cv.id).
 *
 * [P2-ops] Crontab entry needed on the Hetzner box:
 *   0 3 * * * curl -X POST https://app.leaddrivecrm.org/api/cron/contract-embeddings \
 *        -H "x-cron-secret: $CRON_SECRET"
 * Revisit: after Slice 7 (integrations) or when VOYAGE_API_KEY is confirmed on prod.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { isAiFeatureEnabled, checkAiBudget } from "@/lib/ai/budget"
import { logEmbeddingSpend } from "@/lib/ai/embedding-spend"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { runWithRlsBypass } from "@/lib/rls-context"

export const dynamic = "force-dynamic"

const BATCH_CAP = 100   // max contracts indexed per run
const MAX_EMBED_CHARS = 32_000

function maskEmbeddingText(text: string): string {
  return new PiiMasker().mask(text)
}

async function generateEmbedding(text: string): Promise<number[]> {
  const safeText = maskEmbeddingText(text)
  const voyageKey = process.env.VOYAGE_API_KEY
  if (voyageKey) {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${voyageKey}`,
      },
      body: JSON.stringify({
        model: "voyage-3-lite",
        input: [safeText.slice(0, 8000)],
      }),
    })
    const data = await response.json()
    if (data.data?.[0]?.embedding) {
      return data.data[0].embedding
    }
  }

  // Fallback: deterministic hash-based pseudo-embedding
  const DIMS = 512
  const result = new Array(DIMS).fill(0)
  for (let i = 0; i < DIMS; i++) {
    const charCode = safeText.charCodeAt(i % safeText.length) || 0
    result[i] = ((charCode * 2654435761) % 1000) / 1000 - 0.5
  }
  return result
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  let indexed = 0
  let skipped = 0
  const errors: string[] = []

  try {
    // FIX 5: Candidate query selects BOTH missing AND stale embeddings.
    //
    // Missing: ce.id IS NULL (no embedding row at all).
    // Stale:   ce.id IS NOT NULL but contractVersionId differs from the contract's
    //          latest canonical signed ContractVersion (cv.id).
    //          If no canonical signed version exists, we use cv.id IS NULL
    //          (the existing embedding has a non-null versionId but no canonical
    //          version → also stale; or if both are null it's already fresh).
    //
    // We LEFT JOIN contract_versions cv on the latest canonical signed version
    // so we can compare ce."contractVersionId" IS DISTINCT FROM cv.id.
    const candidates = await prisma.$queryRaw<Array<{
      id: string
      organizationId: string
      renderedBody: string | null
      embeddedVersionId: string | null
      latestCanonicalVersionId: string | null
    }>>`
      SELECT
        c.id,
        c."organizationId",
        c."renderedBody",
        ce."contractVersionId" AS "embeddedVersionId",
        cv.id                  AS "latestCanonicalVersionId"
      FROM contracts c
      LEFT JOIN contract_embeddings ce ON ce."contractId" = c.id
      LEFT JOIN LATERAL (
        SELECT id
        FROM contract_versions cv2
        WHERE cv2."contractId" = c.id
          AND cv2."isCanonicalSigned" = true
        ORDER BY cv2."createdAt" DESC
        LIMIT 1
      ) cv ON true
      WHERE c."renderedBody" IS NOT NULL
        AND c."renderedBody" != ''
        AND (
          ce.id IS NULL
          OR ce."contractVersionId" IS DISTINCT FROM cv.id
        )
      LIMIT ${BATCH_CAP}
    `

    // FIX 3: Group candidates by org so we can gate per-org once.
    const byOrg = new Map<string, typeof candidates>()
    for (const row of candidates) {
      const existing = byOrg.get(row.organizationId) ?? []
      existing.push(row)
      byOrg.set(row.organizationId, existing)
    }

    for (const [orgId, rows] of byOrg) {
      // FIX 3: Check feature flag + budget ONCE per org before embedding any of its contracts.
      const featureOn = await isAiFeatureEnabled(orgId, "ai_semantic_search")
      if (!featureOn) {
        // Org opted out — skip all contracts for this org
        skipped += rows.length
        continue
      }

      const budget = await checkAiBudget(orgId)
      if (!budget.allowed) {
        // Over budget — skip all contracts for this org
        skipped += rows.length
        continue
      }

      for (const row of rows) {
        const rawBody = (row.renderedBody ?? "").trim()
        if (!rawBody) { skipped++; continue }

        const embeddingText = maskEmbeddingText(rawBody).slice(0, MAX_EMBED_CHARS)

        try {
          const embedStart = Date.now()
          const vector = await generateEmbedding(embeddingText)
          const embedLatencyMs = Date.now() - embedStart

          const vectorStr = `[${vector.join(",")}]`
          const id = `cemb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

          // Upsert: ON CONFLICT covers both the missing AND stale paths cleanly.
          // The stale path hits the DO UPDATE branch (existing row, different versionId).
          await prisma.$executeRaw`
            INSERT INTO "contract_embeddings"
              ("id", "organizationId", "contractId", "contractVersionId", "content",
               "embedding", "model", "createdAt", "updatedAt")
            VALUES (${id}, ${orgId}, ${row.id}, ${row.latestCanonicalVersionId}, ${embeddingText}, ${vectorStr}::vector, 'voyage-3-lite', NOW(), NOW())
            ON CONFLICT ("contractId") DO UPDATE
              SET "content" = EXCLUDED."content",
                  "embedding" = EXCLUDED."embedding",
                  "model" = EXCLUDED."model",
                  "contractVersionId" = EXCLUDED."contractVersionId",
                  "updatedAt" = NOW()
          `

          // FIX 1: log embedding spend so checkAiBudget meters this cron call
          void logEmbeddingSpend(orgId, embeddingText, embedLatencyMs, "[contract-cron]")

          indexed++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[cron/contract-embeddings] contract ${row.id} failed: ${msg}`)
          errors.push(`${row.id}: ${msg.slice(0, 100)}`)
          skipped++
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[cron/contract-embeddings] query failed:", msg)
    return NextResponse.json(
      { indexed, skipped, errors: [msg] },
      { status: 500 },
    )
  }

  return NextResponse.json({ indexed, skipped, errors })
  })
}
