/**
 * F4 — GET /api/v1/ai-configs/[id]/export
 *
 * Returns the agent as a portable definition envelope (no org/identity fields),
 * with an attachment Content-Disposition so a direct browser navigation saves a
 * file. The command-center fetches it and downloads the JSON as-is.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { toPortableDefinition } from "@/lib/ai/agent-portable"

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const config = await prisma.aiAgentConfig.findFirst({ where: { id, organizationId: orgId } })
  if (!config) return NextResponse.json({ error: "Agent config not found" }, { status: 404 })

  const envelope = toPortableDefinition(config as unknown as Record<string, unknown>)
  const slug = (config.configName || "definition").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60) || "definition"
  return new NextResponse(JSON.stringify(envelope, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="agent-${slug}.json"`,
    },
  })
})
