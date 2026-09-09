import { prisma } from "@/lib/prisma"

/**
 * The Social Monitoring group's own AI agent — a per-org singleton
 * `AiAgentConfig(agentType="social")`, distinct from the inbox agent and the CRM
 * "general" chat agent. Managed inside the Social Monitoring module (omnichannel
 * gate), NOT the AI Command Center, so a tenant with only social monitoring can
 * configure it without the AI add-on.
 */
export const SOCIAL_AGENT_TYPE = "social"

export const SOCIAL_AGENT_DEFAULTS = {
  configName: "Social AI Agent",
  model: "claude-haiku-4-5-20251001",
  temperature: 0.7,
  systemPrompt: "",
  greeting: "",
  escalationEnabled: true,
}

export interface SocialAgentPersona {
  id: string
  configName: string
  version: number
  systemPrompt: string
  model: string
  temperature: number
}

export interface CanonicalSocialAgentConfig {
  id: string
  configName: string
  version: number
  systemPrompt: string | null
  model: string
  temperature: number
  greeting: string | null
  escalationEnabled: boolean
  isActive: boolean
}

/**
 * Resolve the tenant-level Social Monitoring agent deterministically.
 * Older tenants may contain more than one `agentType="social"` row; a plain
 * `findFirst` allowed the editor and generator to select different rows.
 */
export async function getCanonicalSocialAgentConfig(
  orgId: string,
): Promise<CanonicalSocialAgentConfig | null> {
  const configs = await prisma.aiAgentConfig.findMany({
    where: { organizationId: orgId, agentType: SOCIAL_AGENT_TYPE },
    orderBy: [
      { isActive: "desc" },
      { priority: "desc" },
      { updatedAt: "desc" },
      { id: "desc" },
    ],
    select: {
      id: true,
      configName: true,
      version: true,
      systemPrompt: true,
      model: true,
      temperature: true,
      greeting: true,
      escalationEnabled: true,
      isActive: true,
    },
  })

  return configs.find(config =>
    config.isActive && config.configName === SOCIAL_AGENT_DEFAULTS.configName
  ) ?? configs.find(config => config.isActive)
    ?? configs.find(config => config.configName === SOCIAL_AGENT_DEFAULTS.configName)
    ?? configs[0]
    ?? null
}

async function loadSocialAgent(orgId: string, id?: string | null): Promise<SocialAgentPersona | null> {
  const config = id
    ? await prisma.aiAgentConfig.findFirst({
        where: {
          id,
          organizationId: orgId,
          agentType: SOCIAL_AGENT_TYPE,
          isActive: true,
        },
        select: { id: true, configName: true, version: true, systemPrompt: true, model: true, temperature: true },
      })
    : await getCanonicalSocialAgentConfig(orgId)
  if (!config) return null
  const systemPrompt = (config.systemPrompt ?? "").trim()
  if (!systemPrompt) return null
  return {
    id: config.id,
    configName: config.configName,
    version: config.version,
    systemPrompt,
    model: config.model || SOCIAL_AGENT_DEFAULTS.model,
    temperature: typeof config.temperature === "number" ? config.temperature : SOCIAL_AGENT_DEFAULTS.temperature,
  }
}

/** Loads the org's social agent persona, or null when none is configured yet. */
export async function getSocialAgentPersona(orgId: string): Promise<SocialAgentPersona | null> {
  return loadSocialAgent(orgId)
}

/** Loads the exact social agent assigned to a monitoring subject. */
export async function getSubjectSocialAgentPersona(orgId: string, agentId: string | null | undefined) {
  if (!agentId) return null
  return loadSocialAgent(orgId, agentId)
}
