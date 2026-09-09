/**
 * KPI Arena per-org config (Phase C4).
 *   GET    — current EFFECTIVE config (the org row merged onto defaults), plus a
 *            `customized` flag (false = pure defaults, no row yet).
 *   PUT    — save org overrides (admin/manager; org-wide setting, NOT mtm-gated —
 *            the status bands drive tickets/projects/tasks too). Validates ranges,
 *            descending bands, and a non-zero weight sum, then upserts.
 *   DELETE — reset to defaults (drop the override row).
 *
 * The aggregators read this via `loadLeaderboardConfig` (see config-loader.ts).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { resolveLeaderboardConfig } from "@/lib/leaderboard/config-loader"

const weight = z.number().min(0).max(1)
const threshold = z.number().min(0).max(200)

const BodySchema = z.object({
  mtmWeights: z.object({ task: weight, photo: weight, route: weight }),
  statusThresholds: z.object({
    exceeding: threshold,
    on_track: threshold,
    behind: threshold,
    at_risk: threshold,
  }),
})

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const row = await prisma.leaderboardConfig.findUnique({ where: { organizationId: orgId } })
    return NextResponse.json({ success: true, data: resolveLeaderboardConfig(row), customized: !!row })
  } catch (e) {
    console.error("[leaderboard/config GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("settings", "write", async (req, auth) => {
  try {
    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid config" }, { status: 400 })
    }
    const { mtmWeights, statusThresholds } = parsed.data
    if (mtmWeights.task + mtmWeights.photo + mtmWeights.route <= 0) {
      return NextResponse.json({ error: "At least one MTM weight must be greater than zero" }, { status: 400 })
    }
    const { exceeding, on_track, behind, at_risk } = statusThresholds
    if (!(exceeding >= on_track && on_track >= behind && behind >= at_risk)) {
      return NextResponse.json(
        { error: "Status thresholds must descend: exceeding ≥ on track ≥ behind ≥ at risk" },
        { status: 400 },
      )
    }
    const row = await prisma.leaderboardConfig.upsert({
      where: { organizationId: auth.orgId },
      create: { organizationId: auth.orgId, mtmWeights, statusThresholds },
      update: { mtmWeights, statusThresholds },
    })
    return NextResponse.json({ success: true, data: resolveLeaderboardConfig(row), customized: true })
  } catch (e) {
    console.error("[leaderboard/config PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("settings", "write", async (_req, auth) => {
  try {
    await prisma.leaderboardConfig.deleteMany({ where: { organizationId: auth.orgId } })
    return NextResponse.json({ success: true, data: resolveLeaderboardConfig(null), customized: false })
  } catch (e) {
    console.error("[leaderboard/config DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
