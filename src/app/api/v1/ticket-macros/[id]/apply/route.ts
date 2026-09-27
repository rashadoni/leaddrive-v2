import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { MACRO_ASSIGNABLE_ROLES } from "@/lib/ticket-macros/presentation"
import { macroActionsSchema } from "@/lib/ticket-macros/schema"
import { withRlsAuth } from "@/lib/with-rls"

const applySchema = z.object({ ticketId: z.string().min(1) }).strict()

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

    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({ where: { id: parsedRequest.data.ticketId, organizationId: auth.orgId } })
      if (!ticket) return null
      let tags = [...(ticket.tags || [])]

      for (const action of parsedActions.data) {
        switch (action.type) {
          case "set_status":
            await tx.ticket.update({ where: { id: ticket.id }, data: { status: action.value } })
            break
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

      await tx.ticketMacro.update({ where: { id }, data: { usageCount: { increment: 1 } } })
      return tx.ticket.findFirst({
        where: { id: ticket.id, organizationId: auth.orgId },
        include: { comments: { orderBy: { createdAt: "desc" }, take: 10 } },
      })
    })

    if (!updated) return NextResponse.json({ error: "Ticket not found.", code: "TICKET_NOT_FOUND" }, { status: 404 })
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    if (error instanceof Error && error.message === "macro_assignee_invalid") {
      return NextResponse.json({ error: "Macro assignee is no longer available.", code: "MACRO_ASSIGNEE_INVALID" }, { status: 409 })
    }
    console.error("[ticket-macros/:id/apply POST]", error)
    return NextResponse.json({ error: "Macro could not be applied. No actions were committed.", code: "MACRO_APPLY_FAILED" }, { status: 500 })
  }
})
