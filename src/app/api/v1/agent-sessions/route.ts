/**
 * Agent sessions CRUD.
 *
 *   GET  /api/v1/agent-sessions?status=executing      → list
 *   POST /api/v1/agent-sessions                       → create + start
 *
 * Part of H1 Agent framework (Phase 3 slice 1). Slice 2 wires the
 * actual planning-loop driver that consumes `AiAgentConfig.toolsEnabled`
 * and dispatches to Claude's tool-calling API.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const VALID_STATUSES = new Set([
  "planning", "executing", "waiting_input", "completed", "failed", "cancelled",
])
const VALID_CONTEXT_TYPES = new Set(["deal", "lead", "contact", "ticket", "task"])

const createSchema = z.object({
  agentConfigId: z.string().min(1),
  goal: z.string().min(1).max(2000),
  contextType: z.string().optional().nullable(),
  contextId: z.string().optional().nullable(),
  maxSteps: z.number().int().min(1).max(100).optional(),
  budgetUsd: z.number().positive().max(100).optional().nullable(),
})

export const GET = withRlsAuth("ai", "read", async (req, auth) => {
  const statusParam = req.nextUrl.searchParams.get("status") || undefined
  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return NextResponse.json(
      { error: "Invalid status", validValues: [...VALID_STATUSES] },
      { status: 400 }
    )
  }
  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "50", 10) || 50))

  const sessions = await prisma.agentSession.findMany({
    where: {
      organizationId: auth.orgId,
      ...(statusParam ? { status: statusParam } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, agentConfigId: true, agentName: true, goal: true, status: true,
      contextType: true, contextId: true, stepCount: true, maxSteps: true,
      costSoFarUsd: true, budgetUsd: true, result: true,
      createdAt: true, updatedAt: true, completedAt: true,
    },
  })
  return NextResponse.json({ success: true, data: sessions })
})

export const POST = withRlsAuth("ai", "write", async (req, auth) => {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  if (parsed.data.contextType && !VALID_CONTEXT_TYPES.has(parsed.data.contextType)) {
    return NextResponse.json(
      { error: "Invalid contextType", validValues: [...VALID_CONTEXT_TYPES] },
      { status: 400 }
    )
  }
  if (parsed.data.contextType && !parsed.data.contextId) {
    return NextResponse.json({ error: "contextId required when contextType is set" }, { status: 400 })
  }

  // Verify agent config belongs to caller's org — defence-in-depth against
  // cross-tenant agent reuse.
  const agentConfig = await prisma.aiAgentConfig.findFirst({
    where: { id: parsed.data.agentConfigId, organizationId: auth.orgId },
    select: { id: true, configName: true, isActive: true },
  })
  if (!agentConfig) {
    return NextResponse.json({ error: "Agent config not found" }, { status: 404 })
  }
  if (!agentConfig.isActive) {
    return NextResponse.json({ error: "Agent config is not active" }, { status: 400 })
  }

  const session = await prisma.agentSession.create({
    data: {
      organizationId: auth.orgId,
      agentConfigId: agentConfig.id,
      agentName: agentConfig.configName,
      goal: parsed.data.goal,
      status: "planning",
      contextType: parsed.data.contextType ?? null,
      contextId: parsed.data.contextId ?? null,
      maxSteps: parsed.data.maxSteps ?? 20,
      budgetUsd: parsed.data.budgetUsd ?? null,
      initiatedBy: auth.userId,
    },
  })
  return NextResponse.json({ success: true, data: session }, { status: 201 })
})
