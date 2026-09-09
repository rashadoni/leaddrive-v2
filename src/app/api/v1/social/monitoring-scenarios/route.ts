import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import {
  createMonitoringScenario,
  getMonitoringScenarios,
  MONITORING_SCENARIO_ACTIONS,
  MONITORING_SCENARIO_PLATFORMS,
  MONITORING_SCENARIO_REPLY_MODES,
  MONITORING_SCENARIO_SENTIMENTS,
} from "@/lib/social/monitoring-scenarios"
import { compileOrganizationSourceRoutePlans } from "@/lib/social/source-route-plan"

const scenarioSchema = z.object({
  subjectId: z.string().trim().max(255).nullable().optional(),
  subjectName: z.string().trim().max(200).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["active", "paused", "draft"]).optional(),
  platforms: z.array(z.enum(MONITORING_SCENARIO_PLATFORMS)).min(1).max(8),
  topics: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
  keywords: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(500).optional(),
  // Rolling-client compatibility only; the scenario service discards direct
  // targets because pages/profiles now live exclusively in Sources.
  handles: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
  urls: z.array(z.string().trim().min(1).max(2000)).max(500).optional(),
  useHashtagFallback: z.boolean().optional(),
  includeOwnedComments: z.boolean().optional(),
  includeExternalComments: z.boolean().nullable().optional(),
  archiveStartAt: z.string().datetime({ offset: true }).nullable().optional(),
  sentiments: z.array(z.enum(MONITORING_SCENARIO_SENTIMENTS)).min(1).max(8).optional(),
  minConfidence: z.coerce.number().int().min(1).max(100).optional(),
  action: z.enum(MONITORING_SCENARIO_ACTIONS).optional(),
  replyIdentityId: z.string().trim().max(255).nullable().optional(),
  replyIdentityLabel: z.string().trim().max(255).nullable().optional(),
  replyMode: z.enum(MONITORING_SCENARIO_REPLY_MODES).optional(),
  autoReplyEnabled: z.boolean().optional(),
  googleAlertsRssUrl: z.string().trim().url().max(1000).nullable().optional(),
}).strict()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid monitoring scenario"
}

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth) => {
  const scenarios = await getMonitoringScenarios(auth.orgId)
  return NextResponse.json({
    success: true,
    data: {
      scenarios,
      stats: {
        total: scenarios.length,
        active: scenarios.filter((scenario) => scenario.status === "active").length,
        draft: scenarios.filter((scenario) => scenario.status === "draft").length,
        paused: scenarios.filter((scenario) => scenario.status === "paused").length,
      },
    },
  })
})

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth) => {
  const body = await req.json()
  const parsed = scenarioSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const scenario = await createMonitoringScenario(auth.orgId, auth.userId, parsed.data)
    await compileOrganizationSourceRoutePlans(auth.orgId)
    await logAudit(auth.orgId, "create", "social_monitoring_scenario", scenario.id, scenario.name)
    return NextResponse.json({ success: true, data: scenario }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 })
  }
})
