import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { KNOWN_AI_MODELS } from "@/lib/ai/budget"
import {
  SOCIAL_AGENT_DEFAULTS,
  SOCIAL_AGENT_TYPE,
  getCanonicalSocialAgentConfig,
} from "@/lib/ai/social-agent"

/**
 * Social Monitoring's own AI agent persona — a per-org singleton
 * `AiAgentConfig(agentType="social")`. Gated by the omnichannel module (NOT the
 * `ai` add-on like /ai-configs), so social-monitoring clients configure their
 * agent without opening the AI Command Center.
 */
const putSchema = z.object({
  systemPrompt: z.string().max(8000).optional(),
  model: z.string().refine((m) => KNOWN_AI_MODELS.includes(m), { message: "Unsupported model" }).optional(),
  temperature: z.number().min(0).max(1).optional(),
  greeting: z.string().max(1000).optional(),
  escalationEnabled: z.boolean().optional(),
})

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth) => {
  const [config, agents] = await Promise.all([
    getCanonicalSocialAgentConfig(auth.orgId),
    prisma.aiAgentConfig.findMany({
      where: { organizationId: auth.orgId, agentType: SOCIAL_AGENT_TYPE, isActive: true },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, configName: true, version: true },
    }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      id: config?.id ?? null,
      configured: Boolean(config),
      systemPrompt: config?.systemPrompt ?? SOCIAL_AGENT_DEFAULTS.systemPrompt,
      model: config?.model ?? SOCIAL_AGENT_DEFAULTS.model,
      temperature: typeof config?.temperature === "number" ? config.temperature : SOCIAL_AGENT_DEFAULTS.temperature,
      greeting: config?.greeting ?? SOCIAL_AGENT_DEFAULTS.greeting,
      escalationEnabled: config?.escalationEnabled ?? SOCIAL_AGENT_DEFAULTS.escalationEnabled,
      version: config?.version ?? null,
      agents,
    },
  })
})

export const PUT = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const data = {
    ...(parsed.data.systemPrompt !== undefined ? { systemPrompt: parsed.data.systemPrompt } : {}),
    ...(parsed.data.model !== undefined ? { model: parsed.data.model } : {}),
    ...(parsed.data.temperature !== undefined ? { temperature: parsed.data.temperature } : {}),
    ...(parsed.data.greeting !== undefined ? { greeting: parsed.data.greeting } : {}),
    ...(parsed.data.escalationEnabled !== undefined ? { escalationEnabled: parsed.data.escalationEnabled } : {}),
  }

  // Per-org singleton: reuse the existing social row rather than creating duplicates.
  const existing = await getCanonicalSocialAgentConfig(auth.orgId)

  const config = existing
    ? await prisma.aiAgentConfig.update({
        where: { id: existing.id },
        data: {
          ...data,
          configName: SOCIAL_AGENT_DEFAULTS.configName,
          isActive: true,
          version: { increment: 1 },
        },
      })
    : await prisma.aiAgentConfig.create({
        data: {
          organizationId: auth.orgId,
          agentType: SOCIAL_AGENT_TYPE,
          configName: SOCIAL_AGENT_DEFAULTS.configName,
          isActive: true,
          model: parsed.data.model ?? SOCIAL_AGENT_DEFAULTS.model,
          temperature: parsed.data.temperature ?? SOCIAL_AGENT_DEFAULTS.temperature,
          systemPrompt: parsed.data.systemPrompt ?? SOCIAL_AGENT_DEFAULTS.systemPrompt,
          greeting: parsed.data.greeting ?? SOCIAL_AGENT_DEFAULTS.greeting,
          escalationEnabled: parsed.data.escalationEnabled ?? SOCIAL_AGENT_DEFAULTS.escalationEnabled,
        },
      })

  return NextResponse.json({
    success: true,
    data: {
      id: config.id,
      configured: true,
      systemPrompt: config.systemPrompt ?? SOCIAL_AGENT_DEFAULTS.systemPrompt,
      model: config.model ?? SOCIAL_AGENT_DEFAULTS.model,
      temperature: typeof config.temperature === "number"
        ? config.temperature
        : SOCIAL_AGENT_DEFAULTS.temperature,
      greeting: config.greeting ?? SOCIAL_AGENT_DEFAULTS.greeting,
      escalationEnabled: config.escalationEnabled ?? SOCIAL_AGENT_DEFAULTS.escalationEnabled,
      version: config.version,
    },
  })
})
