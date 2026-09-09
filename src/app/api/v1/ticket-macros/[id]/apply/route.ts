import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const POST = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const userId = session?.userId

  const body = await req.json()
  const { ticketId } = body
  if (!ticketId) return NextResponse.json({ error: "ticketId required" }, { status: 400 })

  const macro = await prisma.ticketMacro.findFirst({ where: { id, organizationId: orgId } })
  if (!macro) return NextResponse.json({ error: "Macro not found" }, { status: 404 })

  const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, organizationId: orgId } })
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

  const actions = macro.actions as Array<{ type: string; value: string }>

  for (const action of actions) {
    switch (action.type) {
      case "set_status":
        await prisma.ticket.update({ where: { id: ticketId }, data: { status: action.value } })
        break
      case "set_priority":
        await prisma.ticket.update({ where: { id: ticketId }, data: { priority: action.value } })
        break
      case "set_assignee":
        await prisma.ticket.update({ where: { id: ticketId }, data: { assignedTo: action.value } })
        break
      case "add_comment":
        await prisma.ticketComment.create({
          data: { ticketId, comment: action.value, userId: userId || null, isInternal: false },
        })
        break
      case "add_internal_note":
        await prisma.ticketComment.create({
          data: { ticketId, comment: action.value, userId: userId || null, isInternal: true },
        })
        break
      case "add_tag": {
        const currentTags = ticket.tags || []
        if (!currentTags.includes(action.value)) {
          await prisma.ticket.update({
            where: { id: ticketId },
            data: { tags: [...currentTags, action.value] },
          })
        }
        break
      }
      case "remove_tag": {
        const filtered = (ticket.tags || []).filter((t: string) => t !== action.value)
        await prisma.ticket.update({ where: { id: ticketId }, data: { tags: filtered } })
        break
      }
    }
  }

  // Increment usage count
  await prisma.ticketMacro.update({ where: { id }, data: { usageCount: { increment: 1 } } })

  // Return updated ticket
  const updated = await prisma.ticket.findFirst({
    where: { id: ticketId },
    include: { comments: { orderBy: { createdAt: "desc" }, take: 10 } },
  })

  return NextResponse.json({ success: true, data: updated })
})
