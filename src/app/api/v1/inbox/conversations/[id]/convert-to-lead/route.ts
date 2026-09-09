import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { getSalesAssignmentCandidates } from "@/lib/inbox/sales-assignment"
import { findSmmPipeline } from "@/lib/pipeline-routing"
import { extractPhoneNumber } from "@/lib/inbox/customer-phone"

const optionalText = (max: number) => z.string().max(max).optional().nullable()
const httpUrl = z.string().max(1000).refine((value) => {
  if (!value.trim()) return true
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}, "Invalid profile URL")

const convertSchema = z.object({
  assignedTo: z.string().min(1),
  contactName: z.string().trim().min(1).max(200),
  companyName: optionalText(200),
  email: z.string().email().max(320).optional().nullable().or(z.literal("")),
  phone: z.string().max(50).refine(
    (value) => extractPhoneNumber(value) !== null,
    "A valid phone number is required",
  ),
  phoneWhatsApp: optionalText(50),
  telegramHandle: optionalText(100),
  sourceDetail: optionalText(200),
  sourceProfileUrl: httpUrl.optional().nullable(),
  interest: optionalText(2000),
  brand: optionalText(100),
  category: optionalText(50),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  estimatedValue: nonNegativeFinancialAmountSchema.optional().nullable(),
  notes: optionalText(5000),
})

type MessageIdentity = {
  from: string
  body: string
  direction?: string
  createdAt?: Date
  metadata: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function extractPhone(value: unknown): string | null {
  return typeof value === "string" ? extractPhoneNumber(value) : null
}

function conversationSource(platform: string, metadata: Record<string, unknown>): string {
  const embedded = typeof metadata.channel === "string" ? metadata.channel.trim().toLowerCase() : ""
  return (platform === "inbox" && embedded ? embedded : platform).replace("_", "-").slice(0, 50)
}

function firstString(records: Record<string, unknown>[], keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  return null
}

function profileUrlForSource(input: {
  source: string
  externalId: string
  contactName?: string | null
  metadata: Record<string, unknown>
  messages: MessageIdentity[]
}): string | null {
  const records = [
    input.metadata,
    ...input.messages.map((message) => asRecord(message.metadata)),
  ]
  const explicitUrl = firstString(records, [
    "sourceProfileUrl",
    "socialProfileUrl",
    "senderProfileUrl",
    "profileUrl",
    "profile_url",
    "permalink",
  ])
  if (explicitUrl && /^https?:\/\//i.test(explicitUrl)) return explicitUrl

  const messageSender = input.messages
    .filter((message) => !message.direction || message.direction === "inbound")
    .map((message) => message.from.trim())
    .find(Boolean)
  const externalHandle = input.externalId.trim()
    && !(input.source === "tiktok" && /^\d+$/.test(input.externalId.trim()))
    ? input.externalId
    : null
  const username = firstString(records, [
    "senderUsername",
    "authorUsername",
    "username",
    "userName",
    "handle",
  ]) || messageSender || externalHandle || input.contactName
  const clean = username.trim().replace(/^@/, "")
  if (!clean) return null

  switch (input.source) {
    case "tiktok": return `https://www.tiktok.com/@${encodeURIComponent(clean)}`
    case "instagram": return `https://www.instagram.com/${encodeURIComponent(clean)}`
    case "facebook": return `https://www.facebook.com/${encodeURIComponent(clean)}`
    case "vkontakte": return `https://vk.com/${encodeURIComponent(clean)}`
    case "telegram": return `https://t.me/${encodeURIComponent(clean)}`
    case "whatsapp": {
      const phone = extractPhone(clean)
      return phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : null
    }
    default: return null
  }
}

function conversationTranscript(messages: MessageIdentity[]): string {
  return messages
    .filter((message) => message.body.trim())
    .map((message) => {
      const speaker = message.direction === "inbound" ? "Müştəri" : "AI / agent"
      const timestamp = message.createdAt ? `[${message.createdAt.toISOString()}] ` : ""
      return `${timestamp}${speaker}: ${message.body.trim()}`
    })
    .join("\n")
    .slice(-6000)
}

const PROFILE_HOSTS: Record<string, string[]> = {
  tiktok: ["tiktok.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  vkontakte: ["vk.com"],
  telegram: ["t.me", "telegram.me"],
  whatsapp: ["wa.me", "whatsapp.com"],
}

function profileMatchesSource(value: string | null | undefined, source: string): boolean {
  if (!value?.trim()) return true
  const allowed = PROFILE_HOSTS[source]
  if (!allowed) return true
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

export const GET = withRlsAuth("inbox", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const conversation = await prisma.socialConversation.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      platform: true,
      externalId: true,
      contactId: true,
      contactName: true,
      lastMessage: true,
      metadata: true,
      aiCustomerStageReason: true,
      messages: {
        where: { direction: "inbound" },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { from: true, body: true, metadata: true },
      },
    },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const contact = conversation.contactId
    ? await prisma.contact.findFirst({
        where: { id: conversation.contactId, organizationId: orgId },
        select: {
          fullName: true,
          email: true,
          phone: true,
          phones: true,
          company: { select: { name: true } },
        },
      })
    : null
  const metadata = asRecord(conversation.metadata)
  const existingLeadId = typeof metadata.qualificationLeadId === "string"
    ? metadata.qualificationLeadId
    : null
  const existingLead = existingLeadId
    ? await prisma.lead.findFirst({
        where: { id: existingLeadId, organizationId: orgId },
      })
    : null
  const source = conversationSource(conversation.platform, metadata)
  const inboundMessages = conversation.messages as MessageIdentity[]
  const messagePhone = inboundMessages
    .flatMap((message: MessageIdentity) => [message.from, message.body])
    .map(extractPhone)
    .find((value: string | null): value is string => Boolean(value))
  const contactPhones = (contact?.phones ?? []) as string[]
  const phone = extractPhone(contact?.phone)
    || contactPhones.map(extractPhone).find((value: string | null): value is string => Boolean(value))
    || ["contactPhone", "phone", "waPhone"]
      .map((key) => extractPhone(metadata[key]))
      .find((value: string | null): value is string => Boolean(value))
    || messagePhone
    || extractPhone(conversation.externalId)
    || ""
  const profileUrl = profileUrlForSource({
    source,
    externalId: conversation.externalId,
    metadata,
    messages: inboundMessages,
  })
  const sourceDetail = firstString(
    [metadata, ...inboundMessages.map((message: MessageIdentity) => asRecord(message.metadata))],
    ["pageName", "accountName", "channelName", "campaignName"],
  )
  const candidates = await getSalesAssignmentCandidates(prisma, orgId)

  return NextResponse.json({
    success: true,
    data: {
      candidates,
      recommendedAssigneeId: candidates.find((candidate) => candidate.recommended)?.id ?? null,
      existingLeadId: existingLead?.id ?? null,
      draft: {
        contactName: existingLead?.contactName || contact?.fullName || conversation.contactName || phone || "Unknown contact",
        companyName: existingLead?.companyName || contact?.company?.name || "",
        email: existingLead?.email || contact?.email || "",
        phone: existingLead?.phone || phone,
        phoneWhatsApp: existingLead?.phoneWhatsApp || (source === "whatsapp" ? phone : ""),
        telegramHandle: existingLead?.telegramHandle || (source === "telegram" ? conversation.externalId : ""),
        source,
        sourceDetail: existingLead?.sourceDetail || sourceDetail || source,
        sourceProfileUrl: existingLead?.sourceProfileUrl || profileUrl || "",
        interest: existingLead?.interest || conversation.aiCustomerStageReason || conversation.lastMessage || "",
        brand: existingLead?.brand || "",
        category: existingLead?.category || "SMM",
        priority: existingLead?.priority || "medium",
        estimatedValue: existingLead?.estimatedValue ?? null,
        notes: existingLead?.notes || `Inbox yazışmasından yaradılıb\n${conversation.lastMessage}`.slice(0, 5000),
      },
    },
  })
})

export const POST = withInboxSessionWrite(async (req, { orgId, userId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = convertSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid lead data" }, { status: 400 })
  }

  const seller = await prisma.user.findFirst({
    where: {
      id: parsed.data.assignedTo,
      organizationId: orgId,
      isActive: true,
      role: "sales",
    },
    select: { id: true, name: true, email: true },
  })
  if (!seller) return NextResponse.json({ error: "Invalid sales assignee" }, { status: 400 })

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${orgId}:${id}:convert-to-lead`}))`
      const conversation = await tx.socialConversation.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true,
          platform: true,
          externalId: true,
          contactName: true,
          metadata: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 40,
            select: { from: true, body: true, direction: true, createdAt: true, metadata: true },
          },
        },
      })
      if (!conversation) throw new Error("conversation-not-found")

      const metadata = asRecord(conversation.metadata)
      const source = conversationSource(conversation.platform, metadata)
      if (!profileMatchesSource(parsed.data.sourceProfileUrl, source)) {
        throw new Error("profile-url-source-mismatch")
      }
      const sourceProfileUrl = parsed.data.sourceProfileUrl?.trim()
        || profileUrlForSource({
          source,
          externalId: conversation.externalId,
          contactName: conversation.contactName,
          metadata,
          messages: conversation.messages,
        })
        || null

      const smmPipeline = findSmmPipeline(await tx.pipeline.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, name: true },
      }))
      const leadData = {
        contactName: parsed.data.contactName,
        companyName: parsed.data.companyName?.trim() || null,
        email: parsed.data.email?.trim() || null,
        phone: parsed.data.phone.trim(),
        phoneWhatsApp: parsed.data.phoneWhatsApp?.trim() || null,
        telegramHandle: parsed.data.telegramHandle?.trim() || null,
        source,
        sourceDetail: parsed.data.sourceDetail?.trim() || source,
        sourceProfileUrl,
        interest: parsed.data.interest?.trim() || null,
        brand: parsed.data.brand?.trim() || null,
        category: parsed.data.category?.trim() || "SMM",
        status: "new",
        priority: parsed.data.priority,
        estimatedValue: parsed.data.estimatedValue ?? null,
        assignedTo: seller.id,
        pipelineId: smmPipeline?.id ?? null,
        notes: [
          parsed.data.notes?.trim(),
          "Yazışma:",
          conversationTranscript(conversation.messages.slice().reverse()),
          `Inbox conversation ID: ${conversation.id}`,
        ].filter(Boolean).join("\n\n").slice(0, 10000),
      }
      const linkedLeadId = typeof metadata.qualificationLeadId === "string"
        ? metadata.qualificationLeadId
        : null
      const existingLead = linkedLeadId
        ? await tx.lead.findFirst({
            where: { id: linkedLeadId, organizationId: orgId },
            select: { id: true },
          })
        : null
      const created = !existingLead
      const lead = existingLead
        ? await tx.lead.update({
            where: { id: existingLead.id },
            data: leadData,
          })
        : await tx.lead.create({
            data: {
              organizationId: orgId,
              ...leadData,
            },
          })

      await tx.channelMessage.updateMany({
        where: { organizationId: orgId, conversationId: conversation.id },
        data: { leadId: lead.id },
      })
      await tx.socialConversation.update({
        where: { id: conversation.id },
        data: {
          status: "resolved",
          closedAt: new Date(),
          folderId: null,
          snoozedUntil: null,
          metadata: {
            ...metadata,
            qualificationLeadId: lead.id,
            salesAssigneeId: seller.id,
            salesAssignedBy: userId,
            salesAssignedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      })
      return { lead, created }
    })

    logAudit(orgId, result.created ? "create" : "update", "lead", result.lead.id, result.lead.contactName, {
      newValue: {
        source: "inbox-marketing-handoff",
        assignedTo: seller.id,
        sourceProfileUrl: result.lead.sourceProfileUrl,
      },
    })
    return NextResponse.json({
      success: true,
      data: {
        lead: result.lead,
        created: result.created,
        seller: { id: seller.id, name: seller.name || seller.email },
      },
    }, { status: result.created ? 201 : 200 })
  } catch (error) {
    if (error instanceof Error && error.message === "conversation-not-found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (error instanceof Error && error.message === "profile-url-source-mismatch") {
      return NextResponse.json({
        error: "The customer profile URL must match the Inbox source channel",
        code: "profile_url_source_mismatch",
      }, { status: 400 })
    }
    console.error("[inbox/convert-to-lead]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
