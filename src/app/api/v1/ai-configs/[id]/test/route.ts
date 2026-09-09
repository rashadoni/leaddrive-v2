/**
 * F3 — POST /api/v1/ai-configs/[id]/test
 *
 * Sandbox preview: run the agent config's model + persona against the tester's
 * messages and return the reply + token/cost trace. Executes NO tools and writes
 * NO customer data, so testing a draft is side-effect free. Body:
 *   { messages: [{ role: "user" | "assistant", content }] }  // last must be user
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { runAgentSandbox, validateSandboxMessages } from "@/lib/ai/agent-sandbox"

export const POST = withRlsAuth("ai", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const config = await prisma.aiAgentConfig.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { model: true, systemPrompt: true, temperature: true, maxTokens: true, toolsEnabled: true },
  })
  if (!config) return NextResponse.json({ error: "Agent config not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const validated = validateSandboxMessages((body as { messages?: unknown }).messages)
  if (!validated.ok) {
    return NextResponse.json({ error: "Invalid conversation", reason: validated.error }, { status: 400 })
  }

  try {
    const result = await runAgentSandbox(auth.orgId, config, validated.messages)
    return NextResponse.json({ success: true, data: result })
  } catch {
    return NextResponse.json({ error: "Sandbox run failed" }, { status: 502 })
  }
})
