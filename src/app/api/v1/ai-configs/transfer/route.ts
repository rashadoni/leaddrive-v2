import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  toTransferDocument,
  parseTransferDocument,
  TRANSFERABLE_FIELDS,
} from "@/lib/inbox/agent-config-transfer"
import { knowledgeWithoutApprovedCompanyContacts } from "@/lib/inbox/company-phone-policy"

/**
 * Move a configured agent between tenants.
 *
 * GET  — download the card as a document.
 * POST — apply a document to THIS organisation.
 *
 * The inbox agent is a per-organisation singleton, so an import replaces the
 * existing one rather than adding a second: the reply engine reads exactly one
 * active `agentType="inbox"`, and two would make its choice arbitrary.
 *
 * Import is `settings:write` even though export is `ai:read` — pulling a card
 * out is reading, pushing one in rewrites how the assistant talks to every
 * customer of this tenant.
 */

export const GET = withRlsAuth("ai", "read", async (req, { orgId }) => {
  const url = new URL(req.url)
  const agentType = url.searchParams.get("agentType") || "inbox"

  const [config, org] = await Promise.all([
    prisma.aiAgentConfig.findFirst({
      where: { organizationId: orgId, agentType },
      orderBy: { priority: "desc" },
    }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
  ])
  if (!config) {
    return NextResponse.json({ error: `No ${agentType} agent is configured` }, { status: 404 })
  }

  const document = toTransferDocument(config as unknown as Record<string, unknown>, {
    exportedAt: new Date().toISOString(),
    sourceOrganization: org?.name ?? undefined,
  })

  return new NextResponse(JSON.stringify(document, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-agent-${agentType}.json"`,
      // A configuration snapshot must never be served from a cache: the next
      // reader would carry away yesterday's prompt believing it was today's.
      "Cache-Control": "no-store",
    },
  })
})

export const POST = withRlsAuth("settings", "write", async (req, { orgId }) => {
  const body = await req.json().catch(() => null)
  const parsed = parseTransferDocument(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const agentType = typeof parsed.agent.agentType === "string" ? parsed.agent.agentType : "inbox"
  const data: Record<string, unknown> = {}
  for (const field of TRANSFERABLE_FIELDS) {
    if (parsed.agent[field] !== undefined) data[field] = parsed.agent[field]
  }
  if (typeof data.knowledgeBase === "string") {
    const safeKnowledge = knowledgeWithoutApprovedCompanyContacts(data.knowledgeBase)
    if (safeKnowledge !== data.knowledgeBase.trim()) {
      data.knowledgeBase = safeKnowledge
      parsed.warnings.push("Removed tenant-specific company contact details from the imported Knowledge Base.")
    }
  }
  data.agentType = agentType

  const existing = await prisma.aiAgentConfig.findFirst({
    where: { organizationId: orgId, agentType },
    select: { id: true },
  })

  const saved = existing
    ? await prisma.aiAgentConfig.update({ where: { id: existing.id }, data })
    : await prisma.aiAgentConfig.create({
        data: { organizationId: orgId, configName: "Imported agent", ...data } as never,
      })

  return NextResponse.json({
    success: true,
    data: {
      id: saved.id,
      agentType,
      replaced: Boolean(existing),
      // Echoed so the operator can see what actually landed rather than trust
      // that it did.
      applied: Object.keys(data).sort(),
      warnings: parsed.warnings,
    },
  })
})
