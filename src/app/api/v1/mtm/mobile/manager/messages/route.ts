import { z } from "zod"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import type { MobileAuthResult } from "@/lib/mobile-auth"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { isValidMtmAgentRole, resolveAgentScope } from "@/lib/mtm/territory-scope"
import { createFieldMessage } from "@/lib/mtm/field-message-send"
import { sanitizeOperationalText } from "@/lib/mtm/operational-announcement"
import { MTM_TEAM_MESSAGES_PUSH_CHANNEL, notifyAgents } from "@/lib/mtm/push-notify"
import { writeMtmAudit } from "@/lib/mtm-audit"

/**
 * «Komandaya yaz» — a manager writes to their team from the phone
 * (owner-approved mockup, 2026-10-17). Until then only the web workspace
 * could (`/api/v1/mtm/operations/messages`); the app only read.
 *
 * GET lists who may be written to; POST sends to all of them or to one.
 * Both come from one list — the caller's scope (`resolveAgentScope`, the same
 * team «Komanda» shows), ACTIVE cards only, the caller left out — so the phone
 * cannot name anyone the server would not, and a recipient outside it is
 * refused before anything is written.
 *
 * The thread, message and notifications are written by the same code as the
 * web's (`createFieldMessage`). A message to the whole team is a broadcast
 * titled with the sender's name; one to a person joins the pair's direct
 * conversation. Messages are a Route & Field feature — employees read them in
 * «Komanda mesajları» — so the tenant must have it.
 */

const SendSchema = z.object({
  to: z.enum(["TEAM", "AGENT"]),
  agentId: z.string().trim().min(1).max(128).optional().nullable(),
  body: z.string().max(4000),
  /** The phone's id for this message: a resend after a lost answer is not a second message. */
  clientMessageId: z.string().trim().min(8).max(128),
}).superRefine((value, ctx) => {
  if (value.to === "AGENT" && !value.agentId) {
    ctx.addIssue({ code: "custom", path: ["agentId"], message: "Choose whom to write to" })
  }
})

function refuse(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, error, code }, { status })
}

type TeamMember = { id: string; name: string; role: string }

/** Everyone the caller may write to: their scope, ACTIVE, not themselves. */
async function teamRecipients(auth: MobileAuthResult): Promise<TeamMember[]> {
  if (!isValidMtmAgentRole(auth.role)) return []
  const scope = await resolveAgentScope(prisma, {
    organizationId: auth.orgId,
    agentId: auth.agentId,
    role: auth.role,
  })
  return prisma.mtmAgent.findMany({
    where: {
      organizationId: auth.orgId,
      status: "ACTIVE",
      id: { ...(scope.agentIds ? { in: scope.agentIds } : {}), not: auth.agentId },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  })
}

/** The message this phone already sent under that id, answered as it was. */
async function alreadySent(auth: MobileAuthResult, clientMessageId: string) {
  const message = await prisma.mtmMessage.findFirst({
    where: { organizationId: auth.orgId, senderAgentId: auth.agentId, clientMessageId },
    select: { id: true, threadId: true },
  })
  if (!message) return null
  const recipientCount = await prisma.mtmMessageParticipant.count({
    where: { organizationId: auth.orgId, threadId: message.threadId, agentId: { not: auth.agentId } },
  })
  return NextResponse.json({
    success: true,
    data: { threadId: message.threadId, messageId: message.id, recipientCount, replayed: true },
  })
}

/** GET /api/v1/mtm/mobile/manager/messages — whom the manager may write to. */
export const GET = withMobileRls(async (_req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  try {
    return NextResponse.json({ success: true, data: { recipients: await teamRecipients(auth) } })
  } catch (error) {
    console.error("[MTM/mobile/manager/messages GET]", error)
    return refuse(500, "MTM_TEAM_MESSAGE_UNAVAILABLE", "Failed to load the team")
  }
}, { requiredCapability: "route-field" })

/** POST /api/v1/mtm/mobile/manager/messages — send to the whole team or to one person in it. */
export const POST = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden

  const parsed = SendSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return refuse(400, "MTM_TEAM_MESSAGE_INVALID", parsed.error.issues[0]?.message ?? "Invalid message")
  }
  const input = parsed.data
  const body = sanitizeOperationalText(input.body)
  if (!body) return refuse(400, "MTM_TEAM_MESSAGE_EMPTY", "Write the message first")

  try {
    const replay = await alreadySent(auth, input.clientMessageId)
    if (replay) return replay

    const team = await teamRecipients(auth)
    const recipients = input.to === "TEAM" ? team : team.filter((agent) => agent.id === input.agentId)
    if (input.to === "AGENT" && recipients.length !== 1) {
      return refuse(403, "MTM_TEAM_MESSAGE_RECIPIENT_FORBIDDEN", "This employee is not in your team")
    }
    if (recipients.length === 0) {
      return refuse(409, "MTM_TEAM_MESSAGE_NO_RECIPIENTS", "There is no active employee in your team")
    }

    const type = input.to === "TEAM" ? "BROADCAST" : "DIRECT"
    const senderName = sanitizeOperationalText(auth.name || auth.email, 200) || auth.email
    let result: Awaited<ReturnType<typeof createFieldMessage>>
    try {
      result = await prisma.$transaction((tx: Prisma.TransactionClient) => createFieldMessage(tx, {
        organizationId: auth.orgId,
        type,
        subject: type === "BROADCAST" ? senderName : null,
        body,
        recipients,
        sender: { agentId: auth.agentId, userId: auth.userId || null, name: senderName },
        acknowledgementRequired: false,
        clientMessageId: input.clientMessageId,
        notificationTitle: senderName,
        sentAt: new Date(),
      }))
    } catch (error) {
      // The same message sent twice at once: the second lost the race to the
      // unique (sender, clientMessageId) and answers with what the first wrote.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await alreadySent(auth, input.clientMessageId)
        if (raced) return raced
      }
      throw error
    }

    const recipientAgentIds = recipients.map((agent) => agent.id)
    // The message is sent once it is in the database; the push is a courtesy.
    void notifyAgents({
      client: prisma,
      organizationId: auth.orgId,
      agentIds: recipientAgentIds,
      title: senderName,
      body,
      data: { target: "Messages", threadId: result.threadId },
      channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
    }).catch((error) => console.warn("[MTM/mobile/manager/messages POST] push failed", error))

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      action: type === "BROADCAST" ? "MESSAGE_BROADCAST" : "MESSAGE_DIRECT_SEND",
      entity: "message_thread",
      entityId: result.threadId,
      metadataKind: "field_message",
      newData: { recipientAgentIds, channel: "mobile" },
      req,
    }).catch((error) => console.warn("[MTM/mobile/manager/messages POST] audit failed", error))

    return NextResponse.json({
      success: true,
      data: { threadId: result.threadId, messageId: result.message.id, recipientCount: recipients.length },
    }, { status: 201 })
  } catch (error) {
    console.error("[MTM/mobile/manager/messages POST]", error)
    return refuse(500, "MTM_TEAM_MESSAGE_UNAVAILABLE", "Failed to send the message")
  }
}, { requiredCapability: "route-field" })
