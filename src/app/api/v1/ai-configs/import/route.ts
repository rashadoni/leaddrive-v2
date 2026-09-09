/**
 * F4 — POST /api/v1/ai-configs/import
 *
 * Accepts an exported agent-definition envelope and creates a NEW config in the
 * current org. Imports always land as an inactive draft (isActive:false) with a
 * fresh version — a human reviews + publishes. Name collisions get a " (imported)"
 * suffix so import never overwrites an existing agent. The singleton inbox agent
 * can't be created blindly by import, so an imported "inbox" definition is
 * downgraded to "general" (the admin can re-file it deliberately).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { KNOWN_AI_MODELS } from "@/lib/ai/budget"
import { importEnvelopeSchema } from "@/lib/ai/agent-portable"

export const POST = withRlsAuth("ai", "write", async (req, auth) => {
  const { orgId } = auth

  const body = await req.json().catch(() => null)
  const parsed = importEnvelopeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Not a valid agent definition file", details: parsed.error.issues[0]?.message },
      { status: 400 },
    )
  }
  const def = parsed.data.definition

  // Unknown model → fall back to the schema default rather than reject the import
  // (a definition from another environment may name a model this build doesn't ship).
  const model = def.model && KNOWN_AI_MODELS.includes(def.model) ? def.model : undefined

  // Avoid clobbering: if the name is taken, suffix it.
  const base = def.configName.slice(0, 240)
  let configName = base
  if (await prisma.aiAgentConfig.findFirst({ where: { organizationId: orgId, configName }, select: { id: true } })) {
    configName = `${base} (imported)`
  }

  const created = await prisma.aiAgentConfig.create({
    data: {
      organizationId: orgId,
      configName,
      ...(model ? { model } : {}),
      maxTokens: def.maxTokens,
      temperature: def.temperature,
      systemPrompt: def.systemPrompt,
      toolsEnabled: def.toolsEnabled ?? [],
      escalationEnabled: def.escalationEnabled,
      escalationRules: def.escalationRules ?? [],
      kbEnabled: def.kbEnabled,
      kbMaxArticles: def.kbMaxArticles,
      // Never auto-create the inbox singleton via import; land it as general.
      agentType: def.agentType === "inbox" ? "general" : def.agentType,
      department: def.department,
      priority: def.priority,
      intents: def.intents ?? [],
      greeting: def.greeting,
      maxToolRounds: def.maxToolRounds,
      notes: def.notes,
      // Imports are drafts — reviewed and published deliberately.
      isActive: false,
      version: 1,
    },
  })

  return NextResponse.json({ success: true, data: created }, { status: 201 })
})
