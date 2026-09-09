import { z } from "zod"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { directMessageThreadKey } from "@/lib/mtm/mobile-message"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { sanitizeOperationalText } from "@/lib/mtm/operational-announcement"

const MessageCommandSchema = z.object({
  type: z.enum(["DIRECT", "BROADCAST"]),
  subject: z.string().trim().max(200).optional().nullable(),
  body: z.string().trim().min(1).max(4000),
  agentIds: z.array(z.string().min(1).max(128)).min(1).max(500),
  acknowledgementRequired: z.boolean().optional(),
  keyMessage: z.boolean().optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveUntil: z.string().datetime().optional(),
  localizations: z.object({
    en: z.string().trim().max(4000).optional(),
    ru: z.string().trim().max(4000).optional(),
    az: z.string().trim().max(4000).optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (value.type === "DIRECT" && value.agentIds.length !== 1) {
    ctx.addIssue({ code: "custom", path: ["agentIds"], message: "Direct messages require exactly one recipient" })
  }
  if (value.type === "BROADCAST" && !value.subject) {
    ctx.addIssue({ code: "custom", path: ["subject"], message: "Broadcast subject is required" })
  }
  if (value.keyMessage) {
    if (value.type !== "BROADCAST") {
      ctx.addIssue({ code: "custom", path: ["keyMessage"], message: "Key messages must be broadcasts" })
    }
    if (!value.effectiveFrom || !value.effectiveUntil) {
      ctx.addIssue({ code: "custom", path: ["effectiveUntil"], message: "Key messages require an active period" })
    } else if (new Date(value.effectiveUntil) <= new Date(value.effectiveFrom)) {
      ctx.addIssue({ code: "custom", path: ["effectiveUntil"], message: "End time must be after start time" })
    }
  }
})

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_OPERATIONS_SCOPE_DENIED" }, { status: 403 })
}

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || actor.role === "AGENT") return forbidden()

  const parsed = MessageCommandSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid message" }, { status: 400 })
  }
  const input = parsed.data
  const sanitizedBody = sanitizeOperationalText(input.body)
  const sanitizedSubject = input.subject ? sanitizeOperationalText(input.subject, 200) : null
  const sanitizedLocalizations = input.localizations
    ? Object.fromEntries(
        Object.entries(input.localizations)
          .map(([locale, text]) => [locale, sanitizeOperationalText(text || "")])
          .filter(([, text]) => Boolean(text)),
      )
    : {}
  if (!sanitizedBody) return NextResponse.json({ error: "Message body is empty after sanitization" }, { status: 400 })
  if (input.type === "BROADCAST" && !sanitizedSubject) {
    return NextResponse.json({ error: "Broadcast subject is empty after sanitization" }, { status: 400 })
  }
  const uniqueAgentIds = [...new Set(input.agentIds)]
  if (uniqueAgentIds.length !== input.agentIds.length) {
    return NextResponse.json({ error: "Each recipient may be selected only once" }, { status: 400 })
  }
  if (uniqueAgentIds.some((agentId) => !isAgentInRouteScope(actor, agentId))) return forbidden()
  if (input.type === "DIRECT" && actor.agentId === uniqueAgentIds[0]) {
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 })
  }

  const recipients = await prisma.mtmAgent.findMany({
    where: { organizationId: auth.orgId, id: { in: uniqueAgentIds }, status: "ACTIVE" },
    select: { id: true, name: true },
  })
  if (recipients.length !== uniqueAgentIds.length) {
    return NextResponse.json({ error: "One or more recipients are unavailable" }, { status: 400 })
  }

  const sentAt = new Date()
  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let thread: { id: string }
      if (input.type === "BROADCAST") {
        thread = await tx.mtmMessageThread.create({
          data: {
            organizationId: auth.orgId,
            type: "BROADCAST",
            subject: sanitizedSubject,
            createdByAgentId: actor.agentId,
            createdByUserId: auth.userId,
            lastMessageAt: sentAt,
            participants: {
              create: recipients.map((recipient: { id: string }) => ({
                organizationId: auth.orgId,
                agentId: recipient.id,
                role: "MEMBER",
              })),
            },
          },
          select: { id: true },
        })
      } else {
        const recipient = recipients[0]
        const directKey = actor.agentId
          ? directMessageThreadKey(actor.agentId, recipient.id)
          : `web:${auth.userId}:${recipient.id}`
        thread = await tx.mtmMessageThread.upsert({
          where: { organizationId_directKey: { organizationId: auth.orgId, directKey } },
          update: { subject: actor.agentId ? undefined : auth.name },
          create: {
            organizationId: auth.orgId,
            type: "DIRECT",
            subject: actor.agentId ? null : auth.name,
            directKey,
            createdByAgentId: actor.agentId,
            createdByUserId: auth.userId,
            lastMessageAt: sentAt,
          },
          select: { id: true },
        })
        for (const participantId of [...new Set([recipient.id, ...(actor.agentId ? [actor.agentId] : [])])]) {
          await tx.mtmMessageParticipant.upsert({
            where: { threadId_agentId: { threadId: thread.id, agentId: participantId } },
            create: {
              organizationId: auth.orgId,
              threadId: thread.id,
              agentId: participantId,
              role: participantId === actor.agentId ? "OWNER" : "MEMBER",
            },
            update: { archivedAt: null },
          })
        }
      }

      const message = await tx.mtmMessage.create({
        data: {
          organizationId: auth.orgId,
          threadId: thread.id,
          senderAgentId: actor.agentId,
          senderUserId: auth.userId,
          senderName: auth.name || auth.email,
          body: sanitizedBody,
          acknowledgementRequired: input.type === "BROADCAST" && Boolean(input.acknowledgementRequired || input.keyMessage),
          sentAt,
        },
        select: { id: true, threadId: true, body: true, sentAt: true, acknowledgementRequired: true },
      })
      await tx.mtmMessageThread.update({ where: { id: thread.id }, data: { lastMessageAt: sentAt } })
      await tx.mtmNotification.createMany({
        data: recipients.map((recipient: { id: string }) => ({
          organizationId: auth.orgId,
          agentId: recipient.id,
          title: input.type === "BROADCAST" ? sanitizedSubject! : `Message from ${auth.name || auth.email}`,
          body: sanitizedBody.slice(0, 500),
          type: input.type === "BROADCAST" ? "announcement" : "message",
          metadata: {
            threadId: thread.id,
            messageId: message.id,
            ...(input.keyMessage ? {
              keyMessage: true,
              effectiveFrom: input.effectiveFrom!,
              effectiveUntil: input.effectiveUntil!,
              fallbackBody: sanitizedBody,
              localizations: sanitizedLocalizations,
            } : {}),
          },
        })),
      })
      return { threadId: thread.id, message }
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: input.type === "BROADCAST" ? "MESSAGE_BROADCAST" : "MESSAGE_DIRECT_SEND",
      entity: "message_thread",
      entityId: result.threadId,
      metadataKind: "field_message",
      newData: {
        recipientAgentIds: uniqueAgentIds,
        acknowledgementRequired: result.message.acknowledgementRequired,
        keyMessage: Boolean(input.keyMessage),
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveUntil: input.effectiveUntil ?? null,
      },
      req,
    }).catch((error) => console.warn("[MTM/operations/messages POST] audit failed", error))

    return NextResponse.json({ success: true, data: result }, { status: 201 })
  } catch (error) {
    console.error("[MTM/operations/messages POST]", error)
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 })
  }
})
