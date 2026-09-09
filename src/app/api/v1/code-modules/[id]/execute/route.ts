/**
 * POST /api/v1/code-modules/[id]/execute
 *
 * Run a tenant code module manually. Slice 1 only supports the
 * "manual" trigger — slice 2 adds record-event + cron triggers (which
 * call into the same engine but skip the route).
 *
 * Persists a `CodeExecution` row per run capturing outcome / output /
 * result / duration regardless of success.
 *
 * Part of N3 Apex-equivalent JS sandbox (Phase 5 slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { runCodeModule } from "@/lib/apex/engine"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { recordStageTransition } from "@/lib/revenue-intelligence/transition-recorder"
import type {
  ContactRepository,
  DealRepository,
} from "@/lib/apex/types"

/**
 * Slice 1 Deal repository — tenant-scoped Prisma wrapper. The
 * sandbox sees ONLY this surface; no Prisma client leaks in.
 * Every method enforces `organizationId` server-side so a misbehaving
 * handler can't escape its tenant.
 */
function makeDealRepo(organizationId: string, actorUserId?: string | null): DealRepository {
  return {
    async find(filter) {
      const where: Record<string, unknown> = { organizationId }
      // Slice 1 whitelist: only safe scalar fields. Slice 2 extends
      // with a typed filter spec.
      if (typeof filter.stage === "string") where.stage = filter.stage
      if (typeof filter.companyId === "string") where.companyId = filter.companyId
      if (typeof filter.assignedTo === "string") where.assignedTo = filter.assignedTo
      const rows = await prisma.deal.findMany({
        where,
        select: {
          id: true,
          name: true,
          stage: true,
          valueAmount: true,
          currency: true,
          companyId: true,
          assignedTo: true,
        },
        take: 200,
      })
      return rows
    },
    async create(data) {
      const name = typeof data.name === "string" ? data.name : ""
      if (!name) throw new Error("crm.deals.create requires `name`")
      const created = await prisma.deal.create({
        data: {
          organizationId,
          name,
          stage: typeof data.stage === "string" ? data.stage : "LEAD",
          valueAmount: typeof data.valueAmount === "number" ? data.valueAmount : 0,
          currency: typeof data.currency === "string" ? data.currency : "AZN",
          companyId: typeof data.companyId === "string" ? data.companyId : null,
          assignedTo: typeof data.assignedTo === "string" ? data.assignedTo : null,
        },
        select: { id: true, name: true, stage: true, valueAmount: true },
      })
      return { ...created, valueAmount: decimalToNumber(created.valueAmount) }
    },
    async update(id, data) {
      // Force tenant scoping via updateMany + count, then re-fetch.
      const patch: Record<string, unknown> = {}
      if (typeof data.stage === "string") patch.stage = data.stage
      if (typeof data.valueAmount === "number") patch.valueAmount = data.valueAmount
      if (typeof data.assignedTo === "string") patch.assignedTo = data.assignedTo
      // A12 — a sandbox-driven stage change must land in the pipeline
      // waterfall too. Snapshot prior state before the write; bump
      // stageChangedAt + record ONLY on a real stage change (parity with
      // REST + bulk). A no-op move (stage set to its current value) must
      // not reset stageChangedAt or velocity duration would zero out.
      const prior =
        typeof patch.stage === "string"
          ? await prisma.deal.findFirst({
              where: { id, organizationId },
              select: { stage: true, valueAmount: true, currency: true, pipelineId: true, stageChangedAt: true },
            })
          : null
      const stageChanges = !!prior && prior.stage !== patch.stage
      if (stageChanges) patch.stageChangedAt = new Date()
      const result = await prisma.deal.updateMany({
        where: { id, organizationId },
        data: patch,
      })
      if (result.count === 0) throw new Error(`Deal ${id} not found in tenant`)
      if (stageChanges && prior) {
        const newAmount =
          typeof data.valueAmount === "number"
            ? data.valueAmount
            : decimalToNumber(prior.valueAmount)
        recordStageTransition(prisma, {
          organizationId,
          dealId: id,
          pipelineId: prior.pipelineId ?? null,
          fromStage: prior.stage,
          toStage: patch.stage as string,
          fromAmount: decimalToNumber(prior.valueAmount),
          toAmount: newAmount,
          currency: prior.currency ?? "AZN",
          actorUserId: actorUserId ?? null,
          priorStageChangedAt: prior.stageChangedAt ?? null,
        }).catch(() => {
          /* fire-and-forget — recordStageTransition logs internally */
        })
      }
      const row = await prisma.deal.findUnique({
        where: { id },
        select: { id: true, name: true, stage: true, valueAmount: true },
      })
      return row ? { ...row, valueAmount: decimalToNumber(row.valueAmount) } : row
    },
  }
}

function makeContactRepo(organizationId: string): ContactRepository {
  return {
    async find(filter) {
      const where: Record<string, unknown> = { organizationId }
      if (typeof filter.email === "string") where.email = filter.email
      if (typeof filter.companyId === "string") where.companyId = filter.companyId
      const rows = await prisma.contact.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          companyId: true,
        },
        take: 200,
      })
      return rows
    },
    async create(data) {
      const fullName = typeof data.fullName === "string" ? data.fullName : ""
      if (!fullName) throw new Error("crm.contacts.create requires `fullName`")
      const created = await prisma.contact.create({
        data: {
          organizationId,
          fullName,
          email: typeof data.email === "string" ? data.email : null,
          phone: typeof data.phone === "string" ? data.phone : null,
          companyId: typeof data.companyId === "string" ? data.companyId : null,
        },
        select: { id: true, fullName: true, email: true },
      })
      return created
    },
    async update(id, data) {
      const patch: Record<string, unknown> = {}
      if (typeof data.fullName === "string") patch.fullName = data.fullName
      if (typeof data.email === "string") patch.email = data.email
      if (typeof data.phone === "string") patch.phone = data.phone
      const result = await prisma.contact.updateMany({
        where: { id, organizationId },
        data: patch,
      })
      if (result.count === 0) throw new Error(`Contact ${id} not found in tenant`)
      const row = await prisma.contact.findUnique({
        where: { id },
        select: { id: true, fullName: true, email: true },
      })
      return row
    },
  }
}

export const POST = withRlsAuth("settings", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const mod = await prisma.codeModule.findFirst({
    where: { id, organizationId: auth.orgId },
  })
  if (!mod) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!mod.isActive) {
    return NextResponse.json({ error: "Module is inactive" }, { status: 409 })
  }
  if (mod.triggerType !== "manual") {
    return NextResponse.json(
      { error: `Manual execute only supports triggerType=manual (this module: ${mod.triggerType})` },
      { status: 409 }
    )
  }

  const result = await runCodeModule({
    source: mod.source,
    context: {
      organizationId: auth.orgId,
      userId: auth.userId,
      trigger: "manual",
    },
    deals: makeDealRepo(auth.orgId, auth.userId),
    contacts: makeContactRepo(auth.orgId),
    timeoutMs: mod.timeoutMs,
    maxLogLines: mod.maxLogLines,
  })

  // Append-only execution log — always persist, regardless of outcome.
  const execution = await prisma.codeExecution.create({
    data: {
      moduleId: mod.id,
      organizationId: auth.orgId,
      outcome: result.outcome,
      output: result.output.join("\n"),
      errorMessage: result.errorMessage,
      result: result.result,
      durationMs: result.durationMs,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    },
    select: { id: true, outcome: true, durationMs: true },
  })

  return NextResponse.json({
    execution,
    result: {
      outcome: result.outcome,
      output: result.output,
      result: result.result,
      errorMessage: result.errorMessage,
      durationMs: result.durationMs,
    },
  })
})
