import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { validateAdvisorEditedPayload } from "@/lib/ai/advisor/execution"
import { buildAdvisorShadowActionWhere } from "@/lib/ai/advisor/shadow-action-history"

function positiveIntParam(value: string | null, fallback: number, max?: number) {
  const parsed = Number.parseInt(value || "", 10)
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  return max ? Math.min(max, safe) : safe
}

/**
 * AI Shadow Actions API
 * GET — list shadow actions (pending review)
 * PATCH — approve/reject a shadow action
 */
export const GET = withRlsAuth("ai", "read", async (req, auth) => {
  const url = new URL(req.url)
  const status = url.searchParams.get("status") || "pending" // pending, approved, rejected, reviewed, executing, executed, failed
  const executionStatus = url.searchParams.get("executionStatus") || undefined
  const featureName = url.searchParams.get("feature") || undefined
  const moduleName = url.searchParams.get("module") || undefined
  const owner = url.searchParams.get("owner") || undefined
  const q = (url.searchParams.get("q") || "").trim()
  const sinceParam = url.searchParams.get("since") // ISO date → only return items newer than this
  const dateFrom = url.searchParams.get("from") || undefined
  const dateTo = url.searchParams.get("to") || undefined
  const page = positiveIntParam(url.searchParams.get("page"), 1)
  const limit = positiveIntParam(url.searchParams.get("limit"), 20, 50)

  const where: Prisma.AiShadowActionWhereInput = buildAdvisorShadowActionWhere({
    organizationId: auth.orgId,
    status,
    executionStatus,
    featureName,
    module: moduleName,
    owner,
    query: q,
    since: sinceParam,
    dateFrom,
    dateTo,
  })

  const [actions, total] = await Promise.all([
    prisma.aiShadowAction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.aiShadowAction.count({ where }),
  ])

  return NextResponse.json({
    data: actions,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

function shadowActionName(action: { payload: Prisma.JsonValue; actionType: string; entityId: string }) {
  const payload = action.payload
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    const advisor = record.advisor
    if (advisor && typeof advisor === "object" && !Array.isArray(advisor)) {
      const title = (advisor as Record<string, unknown>).title
      if (typeof title === "string" && title.trim()) return title
    }
    for (const key of ["title", "subject", "leadName", "dealName", "ticketNumber", "invoiceNumber"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value
    }
  }
  return `${action.actionType}:${action.entityId}`
}

function shadowActionAuditValue(action: {
  id: string
  featureName: string
  actionType: string
  entityType: string
  entityId: string
  riskLevel: string | null
  approved: boolean | null
  executionStatus: string | null
}, reviewerId: string | null | undefined, extras: Record<string, unknown> = {}) {
  return {
    shadowActionId: action.id,
    featureName: action.featureName,
    actionType: action.actionType,
    target: { entityType: action.entityType, entityId: action.entityId },
    riskLevel: action.riskLevel,
    approved: action.approved,
    executionStatus: action.executionStatus,
    reviewerId: reviewerId || "system",
    ...extras,
  }
}

export const PATCH = withRlsAuth("ai", "write", async (req, auth) => {
  if (!["admin", "superadmin", "manager"].includes(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { actionId, decision, editedPayload } = body as {
    actionId: string
    decision: "approve" | "reject" | "edit"
    editedPayload?: Record<string, unknown>
  }

  if (!actionId || !["approve", "reject", "edit"].includes(decision)) {
    return NextResponse.json({ error: "Invalid request: actionId and decision (approve/reject/edit) required" }, { status: 400 })
  }

  const action = await prisma.aiShadowAction.findFirst({
    where: { id: actionId, organizationId: auth.orgId },
  })

  if (!action) {
    return NextResponse.json({ error: "Shadow action not found" }, { status: 404 })
  }

  if (action.approved !== null) {
    return NextResponse.json({ error: "Action already reviewed" }, { status: 409 })
  }

  if (decision === "edit") {
    const validation = validateAdvisorEditedPayload(action, editedPayload)
    if (!validation.ok) {
      return NextResponse.json({
        error: validation.error === "editedPayload must be an object" ? "editedPayload is required for edit" : validation.error,
      }, { status: 400 })
    }
    const edited = await prisma.aiShadowAction.updateMany({
      where: { id: actionId, organizationId: auth.orgId, approved: null },
      data: { payload: validation.payload, editedPayload: validation.payload },
    })
    if (edited.count !== 1) {
      return NextResponse.json({ error: "Action already reviewed" }, { status: 409 })
    }
    const updated = await prisma.aiShadowAction.findFirst({
      where: { id: actionId, organizationId: auth.orgId },
    })
    if (!updated) {
      return NextResponse.json({ error: "Shadow action not found" }, { status: 404 })
    }
    logAudit(auth.orgId, "ai_shadow_edit", "ai_shadow_action", action.id, shadowActionName(action), {
      oldValue: shadowActionAuditValue(action, auth.userId, { payloadEdited: false }),
      newValue: shadowActionAuditValue(updated, auth.userId, { payloadEdited: true }),
    })
    return NextResponse.json({ data: updated })
  }

  let validatedPayload: Record<string, unknown> | undefined
  if (editedPayload !== undefined) {
    const validation = validateAdvisorEditedPayload(action, editedPayload)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    validatedPayload = validation.payload
  }

  const reviewed = await prisma.aiShadowAction.updateMany({
    where: { id: actionId, organizationId: auth.orgId, approved: null },
    data: {
      approved: decision === "approve",
      reviewedAt: new Date(),
      reviewedBy: auth.userId || "system",
      executionStatus: decision === "approve" ? "queued" : "rejected",
      ...(validatedPayload ? { payload: validatedPayload, editedPayload: validatedPayload } : {}),
    },
  })
  if (reviewed.count !== 1) {
    return NextResponse.json({ error: "Action already reviewed" }, { status: 409 })
  }
  const updated = await prisma.aiShadowAction.findFirst({
    where: { id: actionId, organizationId: auth.orgId },
  })
  if (!updated) {
    return NextResponse.json({ error: "Shadow action not found" }, { status: 404 })
  }

  logAudit(auth.orgId, decision === "approve" ? "ai_shadow_approve" : "ai_shadow_reject", "ai_shadow_action", action.id, shadowActionName(action), {
    oldValue: shadowActionAuditValue(action, auth.userId),
    newValue: shadowActionAuditValue(updated, auth.userId, { payloadEdited: Boolean(validatedPayload) }),
  })

  return NextResponse.json({ data: updated })
})
