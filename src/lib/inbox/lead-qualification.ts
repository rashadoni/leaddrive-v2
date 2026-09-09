import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import {
  INBOX_QUALIFICATION_BOARD_PREFIX,
  INBOX_QUALIFICATION_FLAG,
  normalizeChatbotText,
} from "@/lib/chatbot-engine"
import { generateTaskKey } from "@/lib/tasks/task-key"
import { rankSalesAssignees } from "@/lib/inbox/sales-assignment"
import { createNotification } from "@/lib/notifications"
import { findSmmPipeline } from "@/lib/pipeline-routing"
import { extractPhoneNumber } from "@/lib/inbox/customer-phone"
import { extractCustomerPhoneNumber } from "@/lib/inbox/company-phone-policy"
import { featureFlagsToArray } from "@/lib/modules"
import { scoreLeadNow } from "@/lib/ai/lead-scoring"
import { salesBoardId } from "@/lib/tasks/sales-board"

export { extractPhoneNumber } from "@/lib/inbox/customer-phone"

const MODEL = "claude-haiku-4-5-20251001"
const MIN_CONFIDENCE = 0.72

export const QUALIFICATION_CHECKLIST = [
  "Əlaqə saxlanılsın",
  "Müştərinin yazışmasının qısa xülasəsi qeyd olunsun",
  "Nəticəni bölüş",
] as const

export const QUALIFICATION_CUSTOMER_STATUS_FIELD = "inboxCustomerStatus"
export const QUALIFICATION_CUSTOMER_STATUSES = [
  "Maraqlanan izləyici",
  "Potensial izləyici",
  "Marketinq əlaqə saxladı",
  "Satış əlaqə saxladı",
  "Satış əlaqə saxlaya bilmədi",
  "Satıldı",
  "Satılmadı",
  "Nəticəsiz",
] as const

const COMMERCIAL_TERMS = [
  "qiymet", "price", "цена", "сколько", "neceye", "olcu", "razmer", "размер",
  "ferq", "difference", "разница", "kredit", "credit", "кредит", "taksit", "рассрочка",
  "xususiyyet", "characteristic", "характеристик", "special", "xususi", "специальн",
  "nomre", "number", "номер",
  // Delivery / on-site fulfilment is a genuine pre-sales question. Without
  // these stems a customer asking "Daşı ... gətirirsiniz?" was labelled
  // COMMERCIAL_CONVERSATION=false, so the inbox agent never asked for the
  // contact number needed to clarify the address and terms.
  "catdir", "getir", "deliver", "bring", "достав", "привоз", "привез",
  "sifaris", "order", "заказ", "montaj", "install", "монтаж",
]

function includesNormalizedTerm(normalized: string, terms: string[]): boolean {
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const padded = ` ${words.join(" ")} `
  return terms.some((term) => {
    const foldedTerm = normalizeChatbotText(term)
    return foldedTerm.includes(" ")
      ? padded.includes(` ${foldedTerm} `)
      : words.some((word) => word.startsWith(foldedTerm))
  })
}

function isAfterSalesOrComplaint(normalized: string): boolean {
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const stemmedComplaint = [
    "sikayet", "narazi", "gecik", "catmadi", "gelmedi", "zede", "qaytar",
    "жалоб", "пожалов", "недовол", "опозд", "задерж", "поврежд", "возврат",
    "complaint", "unhappy", "delay", "damag", "refund",
  ].some((stem) => words.some((word) => word.startsWith(stem)))
  if (stemmedComplaint || words.includes("late")) return true

  return [
    /(?:^| )не (?:достав|привез)\p{L}*(?= |$)/u,
    /(?:^| )не приш\p{L}*(?= |$)/u,
    /(?:^| )заказ не привез\p{L}*(?= |$)/u,
    /(?:^| )not delivered(?= |$)/u,
    /(?:^| )did not arrive(?= |$)/u,
    /(?:^| )where is my order(?= |$)/u,
    /(?:^| )where s my order(?= |$)/u,
    /(?:^| )my order never arrived(?= |$)/u,
    /(?:^| )где мо(?:й|и) заказ(?= |$)/u,
    /(?:^| )sifaris\p{L}* harada\p{L}*(?= |$)/u,
  ].some((pattern) => pattern.test(normalized))
    || words.some((word) => /^(?:getir|catdir)\p{L}*(?:me|ma)(?:di|yib|mis)\p{L}*$/u.test(word))
}

export type QualificationCategory =
  | "price"
  | "size"
  | "difference"
  | "credit"
  | "characteristics"
  | "special_question"

const CATEGORY_LABEL: Record<QualificationCategory, string> = {
  price: "Qiymət sorğusu",
  size: "Ölçü sorğusu",
  difference: "Məhsul fərqləri",
  credit: "Kredit / taksit marağı",
  characteristics: "Xüsusiyyət sorğusu",
  special_question: "Xüsusi sual",
}

const CATEGORY_SELLER_ADVICE: Record<QualificationCategory, string> = {
  price: "Məhsulu, miqdarı və büdcəni dəqiqləşdirin; aktual qiyməti və ödəniş variantlarını izah edin.",
  size: "Modeli və istifadə məqsədini dəqiqləşdirin; uyğun ölçünü və mövcudluğu təklif edin.",
  difference: "Müqayisə edilən modelləri dəqiqləşdirin; əsas fərqləri və müştəriyə uyğun üstünlüyü izah edin.",
  credit: "İlkin ödənişi və müddəti dəqiqləşdirin; kredit və taksit şərtlərini izah edin.",
  characteristics: "Vacib xüsusiyyətləri və istifadə ssenarisini dəqiqləşdirin; uyğun modeli tövsiyə edin.",
  special_question: "Sualın məqsədini dəqiqləşdirin; cavab üçün lazım olan texniki məlumatı hazırlayın.",
}

type QualificationDecision = {
  realCustomer: boolean
  commercialIntent: boolean
  category: QualificationCategory
  confidence: number
  summary: string
  suggestedPitch: string
}

export function qualificationChecklist(
  category: QualificationCategory,
  summary: string,
  suggestedPitch?: string,
): string[] {
  const interest = summary.trim().replace(/\s+/g, " ").slice(0, 320)
  const pitch = suggestedPitch?.trim().replace(/\s+/g, " ").slice(0, 600)
    || CATEGORY_SELLER_ADVICE[category]
  return [
    ...QUALIFICATION_CHECKLIST,
    `Müştərinin əsas marağı: ${interest || CATEGORY_LABEL[category]}`,
    `Satıcı üçün təklif: ${pitch}`,
  ]
}

export type InboxQualificationResult =
  | { created: true; leadId: string; taskId: string }
  | { created: false; reason: string }

export function qualificationDueDate(now: Date, timeZone = "UTC"): Date {
  let weekday = ""
  try {
    weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(now)
  } catch {
    weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(now)
  }
  const weekend = weekday === "Sat" || weekday === "Sun"
  return new Date(now.getTime() + (weekend ? 72 : 24) * 60 * 60 * 1000)
}

/**
 * After-sales and complaint wording, on raw text.
 *
 * Exported because the inbox phone gate needs exactly this and nothing else
 * around it: a delayed delivery or a refund request is the one conversation
 * where asking "may I have your phone number?" reads as tone-deaf, whatever
 * the tenant's prompt says.
 */
export function isAfterSalesOrComplaintMessage(text: string): boolean {
  return isAfterSalesOrComplaint(normalizeChatbotText(text))
}

export function isCommercialCandidate(text: string): boolean {
  const normalized = normalizeChatbotText(text)
  // A delivery complaint is after-sales support, not a fresh sales lead. The
  // same delivery stem appears in both, so complaint cues must win.
  if (isAfterSalesOrComplaint(normalized)) return false
  return includesNormalizedTerm(normalized, COMMERCIAL_TERMS)
}

function parseDecision(text: string): QualificationDecision | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  try {
    const value = JSON.parse(cleaned) as Partial<QualificationDecision>
    const categories: QualificationCategory[] = [
      "price", "size", "difference", "credit", "characteristics", "special_question",
    ]
    if (
      typeof value.realCustomer !== "boolean"
      || typeof value.commercialIntent !== "boolean"
      || !categories.includes(value.category as QualificationCategory)
      || typeof value.confidence !== "number"
      || typeof value.summary !== "string"
      || typeof value.suggestedPitch !== "string"
    ) return null
    return {
      realCustomer: value.realCustomer,
      commercialIntent: value.commercialIntent,
      category: value.category as QualificationCategory,
      confidence: Math.max(0, Math.min(1, value.confidence)),
      summary: value.summary.trim().slice(0, 600),
      suggestedPitch: value.suggestedPitch.trim().slice(0, 1000),
    }
  } catch {
    return null
  }
}

async function classifyCommercialMessage(text: string, model = MODEL): Promise<QualificationDecision | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const masked = new PiiMasker().mask(text)
  try {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: 320,
      temperature: 0,
      system: `Classify an inbound CRM message. Determine whether this is a real potential customer with commercial intent.
Allowed categories: price, size, difference, credit, characteristics, special_question.
Reject greetings, spam, support complaints, job requests, jokes, and messages without a genuine product/service question.
If it is a genuine commercial request, write a concise Azerbaijani seller pitch tailored to the exact need: what to clarify, which benefit to emphasize, and what next action to offer. Do not invent prices, stock, terms, or product facts.
Return JSON only:
{"realCustomer":boolean,"commercialIntent":boolean,"category":"one allowed category","confidence":0.0,"summary":"one short Azerbaijani sentence","suggestedPitch":"one actionable Azerbaijani recommendation for the seller"}`,
      messages: [{ role: "user", content: masked.slice(0, 4000) }],
    })
    const content = response.content[0]
    return content?.type === "text" ? parseDecision(content.text) : null
  } catch {
    return null
  }
}

function qualificationBoardId(features: unknown): string | null {
  const flags: unknown[] = featureFlagsToArray(features)
  if (!flags.includes(INBOX_QUALIFICATION_FLAG)) return null
  const flag = flags.find(
    (value: unknown): value is string => typeof value === "string" && value.startsWith(INBOX_QUALIFICATION_BOARD_PREFIX),
  )
  return flag?.slice(INBOX_QUALIFICATION_BOARD_PREFIX.length) || null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function firstText(records: Record<string, unknown>[], keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  return null
}

function normalizedSource(channelType: string, platform?: string | null): string {
  const source = (platform || channelType || "inbox").trim().toLowerCase()
  if (source === "chatwoot") return "tiktok"
  if (source === "web-chat" || source === "web_chat") return "web-chat"
  return source.replaceAll("_", "-").slice(0, 50)
}

function sourceProfileUrl(input: {
  source: string
  externalId?: string | null
  contactName?: string | null
  conversationMetadata: Record<string, unknown>
  messageMetadata: Record<string, unknown>[]
}): string | null {
  const records = [input.conversationMetadata, ...input.messageMetadata]
  const explicit = firstText(records, [
    "sourceProfileUrl",
    "socialProfileUrl",
    "senderProfileUrl",
    "profileUrl",
    "profile_url",
    "permalink",
  ])
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit.slice(0, 1000)

  const username = firstText(records, [
    "senderUsername",
    "authorUsername",
    "username",
    "userName",
    "handle",
  ])
  const externalHandle = input.externalId?.trim()
    && !(input.source === "tiktok" && /^\d+$/.test(input.externalId.trim()))
    ? input.externalId
    : null
  const raw = (username || externalHandle || input.contactName || "").trim().replace(/^@/, "")
  if (!raw || /^\d+$/.test(raw)) return null
  const encoded = encodeURIComponent(raw)
  switch (input.source) {
    case "tiktok": return `https://www.tiktok.com/@${encoded}`
    case "instagram": return `https://www.instagram.com/${encoded}`
    case "facebook": return `https://www.facebook.com/${encoded}`
    case "vkontakte": return `https://vk.com/${encoded}`
    case "telegram": return `https://t.me/${encoded}`
    default: return null
  }
}

function conversationTranscript(messages: Array<{
  body: string
  direction: string
  createdAt: Date
}>): string {
  return messages
    .filter((message) => message.body.trim())
    .map((message) => {
      const speaker = message.direction === "inbound" ? "Müştəri" : "AI / agent"
      return `[${message.createdAt.toISOString()}] ${speaker}: ${message.body.trim()}`
    })
    .join("\n")
    .slice(-6000)
}

export async function maybeCreateQualifiedLeadTask(opts: {
  orgId: string
  conversationId: string | null
  contactId?: string | null
  channelType: string
  inboundText: string
  senderName?: string | null
  now?: Date
}): Promise<InboxQualificationResult> {
  if (!opts.conversationId) return { created: false, reason: "no-conversation" }

  const org = await prisma.organization.findUnique({
    where: { id: opts.orgId },
    select: { features: true, settings: true },
  })
  const agent = await prisma.aiAgentConfig.findFirst({
    where: {
      organizationId: opts.orgId,
      agentType: "inbox",
      isActive: true,
      autoLeadEnabled: true,
    },
    orderBy: { priority: "desc" },
    select: { model: true, autoAssignSales: true },
  })
  if (!agent) return { created: false, reason: "agent-auto-lead-disabled" }
  // The board comes from the sales-board setting, which falls back to this
  // module's own historical flag — one destination for sales work, whether it
  // arrived as a chat or as a promise made on a call.
  const divisionId = salesBoardId(org?.features)
  if (!divisionId) return { created: false, reason: "disabled" }

  const conversation = await prisma.socialConversation.findFirst({
    where: { id: opts.conversationId, organizationId: opts.orgId },
    select: {
      id: true,
      platform: true,
      externalId: true,
      contactId: true,
      contactName: true,
      metadata: true,
      assignedTo: true,
    },
  })
  if (!conversation) return { created: false, reason: "no-conversation" }
  const priorMetadata = conversation.metadata && typeof conversation.metadata === "object" && !Array.isArray(conversation.metadata)
    ? conversation.metadata as Record<string, unknown>
    : {}
  if (typeof priorMetadata.qualificationTaskId === "string") {
    return { created: false, reason: "already-qualified" }
  }
  const recentMessages = await prisma.channelMessage.findMany({
    where: {
      organizationId: opts.orgId,
      conversationId: opts.conversationId,
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { body: true, direction: true, createdAt: true, metadata: true },
  })
  const recentInbounds = recentMessages.filter((message) => message.direction === "inbound")
  const conversationText = recentInbounds
    .map((message: { body: string }) => message.body)
    .reverse()
    .join("\n")
    .slice(-4000)
  const qualificationText = conversationText || opts.inboundText

  const contactId = opts.contactId ?? conversation.contactId
  const contact = contactId
    ? await prisma.contact.findFirst({
        where: { id: contactId, organizationId: opts.orgId },
        select: { fullName: true, phone: true, phones: true, email: true, company: { select: { name: true } } },
      })
    : null
  let phone = extractCustomerPhoneNumber(opts.inboundText)
    || (contact?.phone ? extractPhoneNumber(contact.phone) : null)
    || (contact?.phones ?? []).map(extractPhoneNumber).find((value: string | null): value is string => Boolean(value))
    || null
  if (!phone) {
    phone = recentInbounds
      .map((message: { body: string }) => extractCustomerPhoneNumber(message.body))
      .find((value: string | null): value is string => Boolean(value)) ?? null
  }
  if (!phone) return { created: false, reason: "phone-required" }

  const classified = await classifyCommercialMessage(qualificationText, agent.model || MODEL)
  const decision: QualificationDecision = classified
    && classified.realCustomer
    && classified.commercialIntent
    && classified.confidence >= MIN_CONFIDENCE
    ? classified
    : {
        realCustomer: true,
        commercialIntent: true,
        category: "special_question",
        confidence: 0.8,
        summary: "Müştəri TikTok yazışmasında əlaqə nömrəsi təqdim edib.",
        suggestedPitch: "Müştəriyə zəng edin, maraqlandığı məhsul və ya xidməti dəqiqləşdirin.",
      }

  const division = await prisma.division.findFirst({
    where: { id: divisionId, organizationId: opts.orgId, isActive: true, isDepartment: false },
    select: {
      id: true,
      key: true,
      boardColumns: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { key: true, mapsToStatus: true },
      },
    },
  })
  if (!division) return { created: false, reason: "board-unavailable" }

  const name = contact?.fullName || conversation.contactName || opts.senderName || phone
  const now = opts.now ?? new Date()
  const orgSettings = org?.settings && typeof org.settings === "object" && !Array.isArray(org.settings)
    ? org.settings as Record<string, unknown>
    : {}
  const timeZone = typeof orgSettings.timezone === "string" ? orgSettings.timezone : "Asia/Baku"
  const dueDate = qualificationDueDate(now, timeZone)
  const conversationMetadata = asRecord(conversation.metadata)
  const source = normalizedSource(opts.channelType, conversation.platform)
  const profileUrl = sourceProfileUrl({
    source,
    externalId: conversation.externalId,
    contactName: conversation.contactName,
    conversationMetadata,
    messageMetadata: recentInbounds.map((message: { metadata: unknown }) => asRecord(message.metadata)),
  })
  const sourceDetail = firstText(
    [
      conversationMetadata,
      ...recentInbounds.map((message: { metadata: unknown }) => asRecord(message.metadata)),
    ],
    ["pageName", "accountName", "channelName", "campaignName"],
  ) || source
  const description = [
    "Lid kateqoriyası: SMM",
    `AI kateqoriyası: ${CATEGORY_LABEL[decision.category]}`,
    `AI etibarı: ${Math.round(decision.confidence * 100)}%`,
    `Telefon: ${phone}`,
    `Kanal: ${source}`,
    ...(profileUrl ? [`Müştəri profili: ${profileUrl}`] : []),
    `Xülasə: ${decision.summary}`,
    `Əsas maraq: ${decision.summary || CATEGORY_LABEL[decision.category]}`,
    `Tövsiyə edilən təqdimat: ${decision.suggestedPitch || CATEGORY_SELLER_ADVICE[decision.category]}`,
    "",
    "Yazışma:",
    conversationTranscript(recentMessages.slice().reverse()),
    `Inbox conversation ID: ${opts.conversationId}`,
  ].join("\n")

  for (let attempt = 0; attempt < 3; attempt++) {
    const taskKey = await generateTaskKey(prisma, opts.orgId, division.key)
    try {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${opts.orgId}:${opts.conversationId}`}))`
        const locked = await tx.socialConversation.findFirst({
          where: { id: opts.conversationId!, organizationId: opts.orgId },
          select: { metadata: true },
        })
        const metadata = locked?.metadata && typeof locked.metadata === "object" && !Array.isArray(locked.metadata)
          ? locked.metadata as Record<string, unknown>
          : {}
        if (typeof metadata.qualificationTaskId === "string") return null

        const existingLead = await tx.lead.findFirst({
          where: {
            organizationId: opts.orgId,
            OR: [{ phone }, { phoneWhatsApp: phone }],
          },
          orderBy: { createdAt: "desc" },
        })
        let salesAssigneeId = existingLead?.assignedTo ?? null
        if (!salesAssigneeId && agent.autoAssignSales) {
          const salesUsers = await tx.user.findMany({
            where: {
              organizationId: opts.orgId,
              isActive: true,
              isAvailable: true,
              role: "sales",
            },
            select: { id: true, name: true, email: true },
          })
          const salesLoads = salesUsers.length > 0
            ? await tx.lead.groupBy({
                by: ["assignedTo"],
                where: {
                  organizationId: opts.orgId,
                  assignedTo: { in: salesUsers.map((user) => user.id) },
                  status: { in: ["new", "contacted", "qualified"] },
                },
                _count: { _all: true },
              })
            : []
          salesAssigneeId = rankSalesAssignees(salesUsers, salesLoads)[0]?.id ?? null
        }
        const smmPipeline = findSmmPipeline(await tx.pipeline.findMany({
          where: { organizationId: opts.orgId, isActive: true },
          select: { id: true, name: true },
        }))
        const lead = existingLead ?? await tx.lead.create({
          data: {
            organizationId: opts.orgId,
            contactName: name,
            companyName: contact?.company?.name ?? null,
            email: contact?.email ?? null,
            phone,
            source,
            sourceDetail: sourceDetail.slice(0, 200),
            sourceProfileUrl: profileUrl,
            interest: decision.summary || CATEGORY_LABEL[decision.category],
            category: "SMM",
            status: "new",
            priority: decision.confidence >= 0.88 ? "high" : "medium",
            assignedTo: salesAssigneeId,
            pipelineId: smmPipeline?.id ?? null,
            notes: description,
          },
        })
        if (existingLead && (
          !existingLead.interest
          || !existingLead.assignedTo
          || !existingLead.sourceProfileUrl
          || !existingLead.pipelineId
          || !existingLead.category
          || !existingLead.notes
          || !existingLead.source
        )) {
          await tx.lead.update({
            where: { id: existingLead.id },
            data: {
              interest: existingLead.interest || decision.summary || CATEGORY_LABEL[decision.category],
              source: existingLead.source || source,
              sourceDetail: existingLead.sourceDetail || sourceDetail.slice(0, 200),
              sourceProfileUrl: existingLead.sourceProfileUrl || profileUrl,
              category: existingLead.category || "SMM",
              notes: existingLead.notes || description,
              assignedTo: existingLead.assignedTo || salesAssigneeId,
              pipelineId: existingLead.pipelineId || smmPipeline?.id || null,
            },
          })
        }
        const firstColumn = division.boardColumns[0]
        const maxPosition = await tx.task.aggregate({
          where: { organizationId: opts.orgId, divisionId: division.id, boardColumnKey: firstColumn?.key ?? null },
          _max: { boardPosition: true },
        })
        await tx.customField.upsert({
          where: {
            organizationId_entityType_fieldName: {
              organizationId: opts.orgId,
              entityType: "task",
              fieldName: QUALIFICATION_CUSTOMER_STATUS_FIELD,
            },
          },
          create: {
            organizationId: opts.orgId,
            entityType: "task",
            fieldName: QUALIFICATION_CUSTOMER_STATUS_FIELD,
            fieldLabel: "Müştəri statusu",
            fieldType: "select",
            options: [...QUALIFICATION_CUSTOMER_STATUSES],
            sortOrder: 0,
            isActive: true,
          },
          update: {
            fieldLabel: "Müştəri statusu",
            fieldType: "select",
            options: [...QUALIFICATION_CUSTOMER_STATUSES],
            isActive: true,
          },
        })
        const task = await tx.task.create({
          data: {
            organizationId: opts.orgId,
            title: `${CATEGORY_LABEL[decision.category]} — ${name}`.slice(0, 200),
            description,
            status: firstColumn?.mapsToStatus ?? "backlog",
            boardColumnKey: firstColumn?.key ?? null,
            boardPosition: (maxPosition._max.boardPosition ?? 0) + 1024,
            divisionId: division.id,
            taskKey,
            type: "task",
            priority: decision.confidence >= 0.88 ? "high" : "medium",
            assignedTo: salesAssigneeId ?? conversation.assignedTo,
            dueDate,
            relatedType: "lead",
            relatedId: lead.id,
            customFields: {
              inboxMainInterest: decision.summary || CATEGORY_LABEL[decision.category],
              inboxSuggestedPitch: decision.suggestedPitch || CATEGORY_SELLER_ADVICE[decision.category],
            },
            checklist: {
              create: qualificationChecklist(decision.category, decision.summary, decision.suggestedPitch).map((title, sortOrder) => ({
                organizationId: opts.orgId,
                title,
                sortOrder,
              })),
            },
          },
        })
        await tx.socialConversation.update({
          where: { id: opts.conversationId! },
          data: {
            metadata: {
              ...metadata,
              qualificationLeadId: lead.id,
              qualificationTaskId: task.id,
              qualificationCategory: decision.category,
              qualificationConfidence: decision.confidence,
              qualifiedAt: now.toISOString(),
              autonomousQualification: true,
              salesAssigneeId,
            } as Prisma.InputJsonValue,
          },
        })
        await tx.channelMessage.updateMany({
          where: {
            organizationId: opts.orgId,
            conversationId: opts.conversationId!,
          },
          data: { leadId: lead.id },
        })
        return { leadId: lead.id, taskId: task.id, salesAssigneeId }
      })
      if (!result) return { created: false, reason: "already-qualified" }
      // After the transaction, never inside it: the scorer reads the lead back
      // through its own connection and would not see a row that has not
      // committed. This is the channel the business actually sells on, so a
      // lead born here must arrive on the salesperson's screen with a real
      // number rather than a placeholder zero.
      await scoreLeadNow(opts.orgId, result.leadId)
      logAudit(opts.orgId, "create", "lead", result.leadId, name, { newValue: { source: "inbox-ai-qualification" } })
      logAudit(opts.orgId, "create", "task", result.taskId, `${CATEGORY_LABEL[decision.category]} — ${name}`, { newValue: { source: "inbox-ai-qualification" } })
      if (result.salesAssigneeId) {
        await createNotification({
          organizationId: opts.orgId,
          userId: result.salesAssigneeId,
          type: "info",
          title: "Yeni lid təyin edildi",
          message: `${name}: ${decision.summary || CATEGORY_LABEL[decision.category]}`,
          entityType: "lead",
          entityId: result.leadId,
          kind: "lead.created",
          push: true,
        }).catch(() => {})
      }
      return { created: true, leadId: result.leadId, taskId: result.taskId }
    } catch (error) {
      const keyCollision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
      if (keyCollision && attempt < 2) continue
      throw error
    }
  }
  return { created: false, reason: "task-key-conflict" }
}
