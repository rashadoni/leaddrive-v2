import { NextResponse } from "next/server"
import { z } from "zod"
import { createHash } from "node:crypto"

import { markTicketMilestonesMet, milestoneTypesForStatusChange } from "@/lib/entitlement-process/ticket-milestones"
import type { MilestoneType } from "@/lib/entitlement-process/types"
import { prisma } from "@/lib/prisma"
import { MACRO_ASSIGNABLE_ROLES } from "@/lib/ticket-macros/presentation"
import { macroActionsSchema } from "@/lib/ticket-macros/schema"
import { withRlsAuth } from "@/lib/with-rls"

const applySchema = z.object({
  ticketId: z.string().min(1),
  requestId: z.string().uuid().optional(),
  expectedActions: macroActionsSchema.optional(),
}).strict().refine(value => Boolean(value.requestId) === Boolean(value.expectedActions), {
  message: "A confirmed preview and request ID must be provided together",
})

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

export const POST = withRlsAuth("tickets", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsedRequest = applySchema.safeParse(await req.json().catch(() => null))
  if (!parsedRequest.success) {
    return NextResponse.json({ error: "ticketId is required.", code: "MACRO_APPLY_INVALID" }, { status: 400 })
  }

  try {
    const macro = await prisma.ticketMacro.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!macro) return NextResponse.json({ error: "Macro not found.", code: "MACRO_NOT_FOUND" }, { status: 404 })
    if (!macro.isActive) return NextResponse.json({ error: "Macro is inactive.", code: "MACRO_INACTIVE" }, { status: 409 })

    const parsedActions = macroActionsSchema.safeParse(macro.actions)
    if (!parsedActions.success) {
      return NextResponse.json({ error: "Macro contains an unsupported action.", code: "MACRO_ACTION_INVALID" }, { status: 422 })
    }

    // What a manual change would have recorded. Filled only when the actions
    // really run, so a replayed request never completes a milestone twice.
    const completedMilestones = new Set<MilestoneType>()
    let firstResponseAt: Date | null = null

    const updated = await prisma.$transaction(async (tx) => {
      let ticket = await tx.ticket.findFirst({ where: { id: parsedRequest.data.ticketId, organizationId: auth.orgId } })
      if (!ticket) return null
      const { requestId, expectedActions } = parsedRequest.data
      const receiptId = requestId ? "macro_" + digest([auth.orgId, auth.userId, ticket.id, requestId]) : null
      const requestDigest = digest([id, expectedActions])
      if (receiptId) {
        // Serialize confirmed attempts for this tenant/ticket. Audit and actions commit together.
        await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${ticket.id} AND "organizationId" = ${auth.orgId} FOR UPDATE`
        ticket = await tx.ticket.findFirst({ where: { id: parsedRequest.data.ticketId, organizationId: auth.orgId } })
        if (!ticket) return null
        const receipt = await tx.auditLog.findFirst({
          where: { id: receiptId, organizationId: auth.orgId, entityType: "ticket_macro_application", entityId: ticket.id },
        })
        if (receipt) {
          const stored = receipt.newValue as { requestDigest?: string } | null
          if (stored?.requestDigest !== requestDigest) throw new Error("macro_request_conflict")
          return tx.ticket.findFirst({
            where: { id: ticket.id, organizationId: auth.orgId },
            include: { comments: { orderBy: { createdAt: "desc" }, take: 10 } },
          })
        }
        if (digest(expectedActions) !== digest(parsedActions.data)) throw new Error("macro_preview_stale")
      }
      let tags = [...(ticket.tags || [])]
      let status = ticket.status

      for (const action of parsedActions.data) {
        switch (action.type) {
          case "set_status": {
            // Reports and SLA read these timestamps; a macro keeps them exactly
            // as the ticket card does for the same change.
            const now = new Date()
            const reopened = (status === "resolved" || status === "closed") && action.value === "in_progress"
            await tx.ticket.update({ where: { id: ticket.id }, data: {
              status: action.value,
              ...(action.value === "resolved" && status !== "resolved" ? { resolvedAt: now } : {}),
              ...(action.value === "closed" && status !== "closed" ? { closedAt: now } : {}),
              ...(reopened ? { reopenCount: { increment: 1 }, resolvedAt: null, closedAt: null } : {}),
            } })
            for (const type of milestoneTypesForStatusChange(status, action.value)) completedMilestones.add(type)
            status = action.value
            break
          }
          case "set_priority":
            await tx.ticket.update({ where: { id: ticket.id }, data: { priority: action.value } })
            break
          case "set_assignee": {
            const assignee = await tx.user.findFirst({
              where: {
                id: action.value,
                organizationId: auth.orgId,
                role: { in: [...MACRO_ASSIGNABLE_ROLES] },
                isActive: true,
              },
              select: { id: true },
            })
            if (!assignee) throw new Error("macro_assignee_invalid")
            await tx.ticket.update({ where: { id: ticket.id }, data: { assignedTo: assignee.id } })
            break
          }
          case "add_comment":
            await tx.ticketComment.create({ data: { ticketId: ticket.id, comment: action.value, userId: auth.userId || null, isInternal: false } })
            // The first public reply stops the first-response clock, whoever sends it.
            if (!ticket.firstResponseAt && !firstResponseAt) firstResponseAt = new Date()
            break
          case "add_internal_note":
            await tx.ticketComment.create({ data: { ticketId: ticket.id, comment: action.value, userId: auth.userId || null, isInternal: true } })
            break
          case "add_tag":
            if (!tags.includes(action.value)) tags = [...tags, action.value]
            await tx.ticket.update({ where: { id: ticket.id }, data: { tags } })
            break
          case "remove_tag":
            tags = tags.filter((tag) => tag !== action.value)
            await tx.ticket.update({ where: { id: ticket.id }, data: { tags } })
            break
        }
      }

      if (firstResponseAt) {
        await tx.ticket.update({ where: { id: ticket.id }, data: { firstResponseAt } })
        completedMilestones.add("first_response")
      }

      if (receiptId) {
        await tx.auditLog.create({ data: {
          id: receiptId, organizationId: auth.orgId, userId: auth.userId || null,
          entityType: "ticket_macro_application", entityId: ticket.id, action: "ticket_macro_applied",
          newValue: { macroId: id, requestDigest, actionTypes: parsedActions.data.map(action => action.type) },
        } })
      }
      await tx.ticketMacro.update({ where: { id }, data: { usageCount: { increment: 1 } } })
      return tx.ticket.findFirst({
        where: { id: ticket.id, organizationId: auth.orgId },
        include: { comments: { orderBy: { createdAt: "desc" }, take: 10 } },
      })
    })

    if (!updated) return NextResponse.json({ error: "Ticket not found.", code: "TICKET_NOT_FOUND" }, { status: 404 })
    if (completedMilestones.size > 0) {
      try {
        await markTicketMilestonesMet(prisma, {
          organizationId: auth.orgId,
          ticketId: updated.id,
          types: [...completedMilestones],
          eventName: "ticket_macro_applied",
          actorUserId: auth.userId,
        })
      } catch (error) {
        console.error("[ticket-milestones] macro milestone sync failed:", error)
      }
    }
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    if (error instanceof Error && error.message === "macro_preview_stale") {
      return NextResponse.json({ error: "Macro changed after preview. Review it again.", code: "MACRO_PREVIEW_STALE" }, { status: 409 })
    }
    if (error instanceof Error && error.message === "macro_request_conflict") {
      return NextResponse.json({ error: "Request ID already belongs to a different confirmed action.", code: "MACRO_REQUEST_CONFLICT" }, { status: 409 })
    }
    if (error instanceof Error && error.message === "macro_assignee_invalid") {
      return NextResponse.json({ error: "Macro assignee is no longer available.", code: "MACRO_ASSIGNEE_INVALID" }, { status: 409 })
    }
    console.error("[ticket-macros/:id/apply POST]", error)
    return NextResponse.json({ error: "Macro could not be applied. No actions were committed.", code: "MACRO_APPLY_FAILED" }, { status: 500 })
  }
})
