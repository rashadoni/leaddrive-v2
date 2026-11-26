/**
 * Contract vectors for «Ağıllı axtarış», hourly (scripts/install-resilience-crons.sh).
 *
 * POST /api/cron/contract-embeddings   (x-cron-secret)
 *   For every organization with the switch on (ai_semantic_search — Settings →
 *   AI automation), makes vectors for contracts that have none or changed after
 *   theirs was made: src/lib/clm/contract-search-index.ts, the same text and
 *   rule the search uses. At most PER_RUN contracts per run in all.
 *
 * Until 2026-11-26 this job was in no schedule, read only the signed version's
 * id to judge staleness (a draft edited after indexing stayed stale for ever),
 * and without a Voyage key stored a «vector» made of character codes.
 * Without Voyage now nothing is stored and the search goes by words.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { isAiFeatureEnabled } from "@/lib/ai/budget"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { indexContracts } from "@/lib/clm/contract-search-index"

export const dynamic = "force-dynamic"

const PER_RUN = 200
const RUN_MS = 4 * 60_000

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const run = await runWithRlsBypass(() =>
    withJobLease({ name: "contract-embeddings", ttlMs: 10 * 60_000 }, async () => {
      const deadline = Date.now() + RUN_MS
      const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } })
      let indexed = 0
      let organizations = 0
      let unavailable = 0
      for (const org of orgs as Array<{ id: string }>) {
        if (indexed >= PER_RUN || Date.now() > deadline) break
        if (!(await isAiFeatureEnabled(org.id, "ai_semantic_search"))) continue
        organizations++
        const result = await indexContracts(org.id, { limit: PER_RUN - indexed, deadline })
        indexed += result.indexed
        if (result.unavailable) unavailable++
      }
      return { indexed, organizations, unavailable }
    }),
  )
  return NextResponse.json({ success: true, data: run })
}
