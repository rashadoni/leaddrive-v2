/**
 * POST /api/v1/agent-sessions/[id]/steps
 *
 * Append a step to an agent session. Slice 1 accepts pre-computed step
 * data from the caller (driver) and applies the state-machine transition
 * in a Prisma transaction. Slice 2 replaces this with an internal driver
 * that calls Claude tool-calling end-to-end.
 *
 * Part of H1 Agent framework (Phase 3 slice 1).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { applyStep, AgentStateError, type SessionStatus } from "@/lib/agent/state-machine"

const bodySchema = z.object({
  kind: z.enum(["observe", "think", "act", "respond", "ask"]),
  observation: z.string().max(8000).optional().nullable(),
  thought: z.string().max(8000).optional().nullable(),
  action: z.string().max(2000).optional().nullable(),
  toolName: z.string().max(120).optional().nullable(),
  toolInput: z.unknown().optional(),
  toolOutput: z.unknown().optional(),
  outcome: z.enum(["ok", "error", "deferred"]).default("ok"),
  errorMessage: z.string().max(2000).optional().nullable(),
  costUsd: z.number().min(0).max(10).optional().nullable(),
  latencyMs: z.number().int().min(0).max(600_000).optional().nullable(),
})

export const POST = withRlsAuth("ai", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Transactional: read current state, validate, write step + update session.
  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const session = await tx.agentSession.findFirst({
        where: { id, organizationId: auth.orgId },
        select: {
          id: true, status: true, stepCount: true, maxSteps: true,
          costSoFarUsd: true, budgetUsd: true,
        },
      })
      if (!session) return { error: "Not found", status: 404 } as const

      // `parsed.data.kind` and `outcome` are already narrowed by Zod enums
      // — they ARE `StepKind`/`StepOutcome` at the type level.
      let transition
      try {
        transition = applyStep(
          {
            status: session.status as SessionStatus,
            stepCount: session.stepCount,
            maxSteps: session.maxSteps,
            costSoFarUsd: session.costSoFarUsd,
            budgetUsd: session.budgetUsd ?? null,
          },
          {
            kind: parsed.data.kind,
            outcome: parsed.data.outcome,
            costUsd: parsed.data.costUsd ?? 0,
          }
        )
      } catch (e) {
        if (e instanceof AgentStateError) {
          return { error: e.message, status: 409 } as const
        }
        throw e
      }

      const stepIndex = session.stepCount // 0-indexed pre-increment
      const step = await tx.agentStep.create({
        data: {
          sessionId: id,
          stepIndex,
          kind: parsed.data.kind,
          observation: parsed.data.observation ?? null,
          thought: parsed.data.thought ?? null,
          action: parsed.data.action ?? null,
          toolName: parsed.data.toolName ?? null,
          // Optional JSONB columns: pass `undefined` when caller didn't
          // supply tool data → Prisma writes DB NULL (column absent), not
          // the JSON literal `null`. Matches the convention in
          // src/lib/mtm-audit.ts:37 and src/lib/mtm-notify.ts:27.
          // Semantic: a `think` or `respond` step has no tool call, so the
          // tool* columns must be SQL NULL, queryable via
          // `where: { toolInput: { equals: Prisma.DbNull } }`.
          toolInput: (parsed.data.toolInput ?? undefined) as Prisma.InputJsonValue | undefined,
          toolOutput: (parsed.data.toolOutput ?? undefined) as Prisma.InputJsonValue | undefined,
          outcome: parsed.data.outcome,
          errorMessage: parsed.data.errorMessage ?? null,
          costUsd: parsed.data.costUsd ?? null,
          latencyMs: parsed.data.latencyMs ?? null,
        },
      })

      const updateData: Prisma.AgentSessionUpdateInput = {
        status: transition.nextStatus,
        stepCount: transition.nextStepCount,
        costSoFarUsd: transition.nextCostSoFarUsd,
      }
      if (transition.nextStatus === "completed" || transition.nextStatus === "failed") {
        updateData.completedAt = new Date()
        if (transition.reason) updateData.result = transition.reason
      }
      const updatedSession = await tx.agentSession.update({
        where: { id },
        data: updateData,
      })

      return { step, session: updatedSession }
    })

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ success: true, ...result }, { status: 201 })
  } catch (e) {
    console.error("[agent-session step]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
})
