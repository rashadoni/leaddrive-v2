import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { addTicketCommentCommand } from "@/lib/crm-commands/ticket/ticket-comment"

/**
 * POST /api/v1/tickets/[id]/comments — комментарий в тикете.
 *
 * Вся работа — в `addTicketCommentCommand`, общей с голосом (этап 4,
 * 2026-11-09): ключ запроса, вложения, первый ответ (SLA), уведомление
 * ответственному, ответ клиенту в WhatsApp. Здесь — прежние ответы экрана.
 */
export const POST = withRlsAuth("tickets", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id: ticketId } = await params
  const body = await req.json()
  const actor = createRestActorContext({ organizationId: auth.orgId, userId: auth.userId, role: auth.role })

  try {
    const { comment, replayed } = await addTicketCommentCommand(actor, ticketId, body)
    return NextResponse.json({ success: true, data: comment, replayed }, { status: replayed ? 200 : 201 })
  } catch (error) {
    if (error instanceof CrmCommandError) {
      const errorKey = error.safeDetails?.errorKey
      return NextResponse.json(
        { error: error.message, ...(typeof errorKey === "string" ? { errorKey } : {}) },
        { status: error.status },
      )
    }
    console.error("[ticket-comments POST]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
