import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

// GET — list guardrails
export const GET = withRls(async (_req, { orgId }) => {
  const guardrails = await prisma.aiGuardrail.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ success: true, data: { guardrails } })
})

// POST — create guardrail
export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const { ruleName, ruleType, description, promptInjection } = body

  if (!ruleName) return NextResponse.json({ error: "Rule name is required" }, { status: 400 })

  const guardrail = await prisma.aiGuardrail.create({
    data: {
      organizationId: orgId,
      ruleName,
      ruleType: ruleType || "restriction",
      description: description || "",
      promptInjection: promptInjection || "",
    },
  })

  return NextResponse.json({ success: true, data: guardrail })
})

// DELETE — delete guardrail
export const DELETE = withRls(async (req, { orgId }) => {
  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 })

  await prisma.aiGuardrail.deleteMany({
    where: { id, organizationId: orgId },
  })

  return NextResponse.json({ success: true })
})
