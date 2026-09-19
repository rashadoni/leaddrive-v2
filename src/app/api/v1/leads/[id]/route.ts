import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { fireWebhooks } from "@/lib/webhooks"
import { clearDeletedMentionRefs } from "@/lib/social/mention-refs"
import { clearTaskRelations } from "@/lib/tasks/clear-task-relations"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { updateLeadCommand } from "@/lib/crm-commands/lead/update-lead"

export const GET = withRlsAuth("leads", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, role, userId } = auth
  const { id } = await params

  try {
    const where = await applyRecordFilter(orgId, userId, role, "lead", {
      id,
      organizationId: orgId,
    })
    const lead = await prisma.lead.findFirst({
      where,
      include: { pipeline: { select: { name: true } } },
    })
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const assignee = lead.assignedTo
      ? await prisma.user.findFirst({
          where: { id: lead.assignedTo, organizationId: orgId },
          select: { name: true, email: true },
        })
      : null
    const fieldPerms = await getFieldPermissions(orgId, role, "lead")
    const filteredLead = {
      ...filterEntityFields(lead, fieldPerms, role),
      assignedToName: assignee?.name || assignee?.email || null,
    }
    if (!Object.prototype.hasOwnProperty.call(filteredLead, "customerStage")) {
      delete filteredLead.salesCallOutcomes
    }
    return NextResponse.json({ success: true, data: filteredLead })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("leads", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const result = await updateLeadCommand(createRestActorContext({
      organizationId: auth.orgId,
      userId: auth.userId,
      role: auth.role,
      requestId: req.headers.get("x-request-id"),
    }), id, body)
    return NextResponse.json({
      success: true,
      data: result.entity,
      meta: result.meta,
    })
  } catch (error) {
    if (error instanceof CrmCommandError) {
      const publicCode = typeof error.safeDetails?.publicCode === "string"
        ? error.safeDetails.publicCode
        : error.code
      if (error.status === 403) {
        return NextResponse.json(
          { error: "Forbidden", message: error.message, code: publicCode },
          { status: error.status },
        )
      }
      return NextResponse.json({ error: error.message, code: publicCode }, { status: error.status })
    }
    console.error("[Leads PUT]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// PATCH = partial-update alias of PUT (inline-edit consumers expect PATCH verb).
// Both do partial updates — only fields present in the body are written.
export const PATCH = PUT

export const DELETE = withRlsAuth("leads", "delete", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, role, userId } = auth
  const { id } = await params

  try {
    const where = await applyRecordFilter(orgId, userId, role, "lead", {
      id,
      organizationId: orgId,
    })
    const existing = await prisma.lead.findFirst({ where, select: { contactName: true } })
    const result = await prisma.lead.deleteMany({ where })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    logAudit(orgId, "delete", "lead", id, existing?.contactName || "")
    fireWebhooks(orgId, "lead.deleted", { id, contactName: existing?.contactName }).catch(() => {})
    // Drop any social-mention back-reference so Social Monitoring stops showing
    // "view lead" for the now-deleted lead (and the row becomes convertible again).
    await clearDeletedMentionRefs(orgId, "leadId", [id])
    // Null out tasks that linked to this now-deleted lead (no FK → not auto-nulled).
    await clearTaskRelations(orgId, "lead", id)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
