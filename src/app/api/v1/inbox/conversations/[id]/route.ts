import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { validateConversationTagsInput } from "@/lib/inbox/conversation-tags"
import { normalizeCloseOutcome } from "@/lib/inbox/close-outcome"
import { isManagerOrAbove } from "@/lib/constants"
import {
  normalizeCustomerStage,
  setCustomerStage,
  type CustomerStage,
} from "@/lib/inbox/customer-stage"

export const GET = withRlsAuth("inbox", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const conv = await prisma.socialConversation.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const messages = await prisma.channelMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: 100,
  })

  return NextResponse.json({ success: true, data: { ...conv, messages } })
})

export const PATCH = withInboxSessionWrite(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()

  // Whitelist status — convStatusTab classifies unknown values as "opened", so an
  // invalid status would silently strand a conversation in the wrong tab.
  if (body.status !== undefined && !["open", "resolved", "archived"].includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  let closeOutcome: string | null | undefined = undefined
  if (body.closeOutcome !== undefined) {
    try {
      closeOutcome = normalizeCloseOutcome(body.closeOutcome)
    } catch {
      return NextResponse.json({ error: "Invalid close outcome" }, { status: 400 })
    }
  }
  const closingNow = body.status === "resolved"
  let requestedCustomerStage: CustomerStage | null = null
  if (body.customerStage !== undefined) {
    requestedCustomerStage = normalizeCustomerStage(body.customerStage)
    if (!requestedCustomerStage) {
      return NextResponse.json({ error: "Invalid customer stage" }, { status: 400 })
    }
    if (requestedCustomerStage !== "marketing_contacted") {
      return NextResponse.json({
        error: "Lead qualification must be updated from the assigned lead",
        code: "sales_stage_lead_only",
      }, { status: 400 })
    }
  }

  let tags: string[] | undefined = undefined
  if (body.tags !== undefined) {
    const parsedTags = validateConversationTagsInput(body.tags)
    if (!parsedTags.ok) {
      return NextResponse.json({ error: parsedTags.error }, { status: 400 })
    }
    tags = parsedTags.tags
  }

  // snoozedUntil: null = unsnooze, or a valid date string = snooze until then.
  let snoozedUntil: Date | null | undefined = undefined
  if (body.snoozedUntil !== undefined) {
    if (body.snoozedUntil === null) {
      snoozedUntil = null
    } else {
      const d = new Date(body.snoozedUntil)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid snoozedUntil" }, { status: 400 })
      }
      snoozedUntil = d
    }
  }

  // assignedTo must be a real user in THIS org (or null = unassign) — the column
  // is a bare String?, so without this a crafted body could assign a cross-tenant
  // userId.
  if (body.assignedTo) {
    const member = await prisma.user.findFirst({
      where: { id: body.assignedTo, organizationId: orgId },
      select: { id: true },
    })
    if (!member) return NextResponse.json({ error: "Invalid assignee" }, { status: 400 })
  }

  // folderId must be a real folder in THIS org (or null = unfile) — same bare
  // String? cross-tenant concern as assignedTo.
  if (body.folderId) {
    const folder = await prisma.inboxFolder.findFirst({
      where: { id: body.folderId, organizationId: orgId },
      select: { id: true },
    })
    if (!folder) return NextResponse.json({ error: "Invalid folder" }, { status: 400 })
  }

  const updated = await prisma.socialConversation.updateMany({
    where: { id, organizationId: orgId },
    data: {
      ...(body.status && { status: body.status }),
      ...(closingNow && { closedAt: new Date() }),
      ...(closeOutcome !== undefined && { closeOutcome }),
      ...(body.closeOutcomeReason !== undefined && { closeOutcomeReason: String(body.closeOutcomeReason).slice(0, 2000) || null }),
      ...(body.assignedTo !== undefined && { assignedTo: body.assignedTo }),
      ...(body.contactId !== undefined && { contactId: body.contactId }),
      ...(snoozedUntil !== undefined && { snoozedUntil }),
      ...(body.folderId !== undefined && { folderId: body.folderId }),
      ...(tags !== undefined && { tags }),
    },
  })

  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const stage = requestedCustomerStage
  if (stage) {
    await setCustomerStage(prisma, {
      organizationId: orgId,
      conversationId: id,
      stage,
      source: requestedCustomerStage ? "agent" : "system",
      reason: String(body.customerStageReason ?? body.closeOutcomeReason ?? "").slice(0, 2000) || null,
    })
  }

  return NextResponse.json({ success: true, data: { updated: updated.count, customerStage: stage } })
})

/**
 * Move a conversation to the trash, or bring it back.
 *
 * Deleting is soft on purpose. The messages, the lead the conversation
 * produced and the audit trail all still reference this row, so destroying it
 * would leave a lead whose origin cannot be read — and the usual reason for
 * deleting a thread is that it is spam or a mistake, not that anyone needs the
 * evidence gone.
 *
 * Restricted to managers and above: widening this later is one line, while an
 * agent clearing a thread another agent was working is not undoable by them.
 */
export const DELETE = withInboxSessionWrite(async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: "Only a manager can delete a conversation" }, { status: 403 })
  }
  // Scoped read first: the organizationId in the filter is what makes a wrong
  // id a 404 rather than a cross-tenant write.
  const existing = await prisma.socialConversation.findFirst({
    where: { id, organizationId: auth.orgId, deletedAt: null },
    select: { id: true, metadata: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Deleting a thread starts it over, it does not merely hide it.
  //
  // The qualification markers live on the conversation and mean "a lead was
  // already made from this thread". They outlive the lead: delete the lead,
  // delete the thread, write again from the same account, and no new lead is
  // ever created because the marker still says one exists. The thread is then
  // permanently unable to produce a lead and nothing on screen explains it.
  //
  // The lead record itself is untouched — it is a separate object with its own
  // history, and removing it is the leads screen's job, not this one's.
  const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
    ? { ...(existing.metadata as Record<string, unknown>) }
    : {}
  for (const key of [
    "qualificationLeadId",
    "qualificationTaskId",
    "qualificationCategory",
    "qualificationConfidence",
    "qualifiedAt",
    "autonomousQualification",
    "salesAssigneeId",
  ]) {
    delete metadata[key]
  }

  await prisma.socialConversation.update({
    where: { id: existing.id },
    data: {
      deletedAt: new Date(),
      deletedBy: auth.userId,
      metadata: metadata as never,
    },
  })
  return NextResponse.json({ success: true, data: { id, deleted: true, qualificationReset: true } })
})

/** Restore a conversation from the trash. Same permission as deleting it. */
export const POST = withInboxSessionWrite(async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: "Only a manager can restore a conversation" }, { status: 403 })
  }
  const result = await prisma.socialConversation.updateMany({
    where: { id, organizationId: auth.orgId, deletedAt: { not: null } },
    data: { deletedAt: null, deletedBy: null },
  })
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: { id, deleted: false } })
})
