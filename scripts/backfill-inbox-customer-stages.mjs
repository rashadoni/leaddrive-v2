// Classify existing inbox conversations into the explicit customer lifecycle.
//
// Safe defaults:
//   node scripts/backfill-inbox-customer-stages.mjs --org=leaddrive
//     -> dry-run, counts only, no message text or PII is printed.
//
// Apply one tenant only:
//   CONFIRM_PROD=1 node scripts/backfill-inbox-customer-stages.mjs \
//     --org=leaddrive --execute --confirm=leaddrive
//
// Idempotent: conversations with an explicit customerStage are preserved.
// Deterministic, evidence-backed states are assigned first. AI only writes an
// advisory suggestion for the remaining conversations; a salesperson confirms
// the real call result on the Lead. Potential is impossible without a usable
// phone number.

import { makeScriptPrisma } from "./_rls.mjs"

const args = process.argv.slice(2)
const valueArg = (name) => (args.find((arg) => arg.startsWith(`--${name}=`)) || "").slice(name.length + 3)
const orgArg = valueArg("org")
const execute = args.includes("--execute")
const confirm = valueArg("confirm")
const limit = Math.min(Math.max(Number(valueArg("limit")) || 2000, 1), 10000)
const useAi = !args.includes("--no-ai")
const MODEL = "claude-haiku-4-5-20251001"
const STAGES = new Set(["interested", "potential", "marketing_contacted", "sales_contacted", "unable_to_contact", "sold", "not_sold", "no_result"])
const AI_STAGES = new Set(["interested", "potential", "no_result", "unclassified"])
const TASK_LABELS = {
  interested: "Maraqlanan izləyici",
  potential: "Potensial izləyici",
  marketing_contacted: "Marketinq əlaqə saxladı",
  sales_contacted: "Satış əlaqə saxladı",
  unable_to_contact: "Satış əlaqə saxlaya bilmədi",
  sold: "Satıldı",
  not_sold: "Satılmadı",
  no_result: "Nəticəsiz",
}

if (!orgArg) {
  console.error("✗ --org=<slug-or-id> is required; all-tenant mode is not supported.")
  process.exit(1)
}
if (execute && (process.env.CONFIRM_PROD !== "1" || confirm !== orgArg)) {
  console.error(`✗ Apply requires CONFIRM_PROD=1 and --confirm=${orgArg}.`)
  process.exit(1)
}

const prisma = await makeScriptPrisma()

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function hasPhoneText(value) {
  return /\d{7,}/.test(String(value || "").replace(/\D/g, ""))
}

function maskPii(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/(?:\+?\d[\d\s().-]{5,}\d)/g, "[PHONE]")
    .slice(0, 8000)
}

function isHumanOutbound(message) {
  if (message.direction !== "outbound") return false
  const metadata = record(message.metadata)
  return metadata.aiGenerated !== true
    && metadata.autoReply !== true
    && metadata.chatbotRuleId == null
    && metadata.aiReply !== true
}

function parseAiDecision(text, hasPhone) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  try {
    const value = JSON.parse(cleaned)
    if (!AI_STAGES.has(value.stage) || typeof value.confidence !== "number" || typeof value.reason !== "string") return null
    const stage = value.stage === "potential" && !hasPhone ? "interested" : value.stage
    return {
      stage,
      confidence: Math.max(0, Math.min(1, value.confidence)),
      reason: value.reason.trim().replace(/\s+/g, " ").slice(0, 600),
    }
  } catch {
    return null
  }
}

async function classifyWithAi(context, hasPhone) {
  if (!useAi || !process.env.ANTHROPIC_API_KEY) return null
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 220,
      temperature: 0,
      system: `Classify a CRM conversation:
interested = real product/service/price/size/difference/credit/availability/characteristics question without phone;
potential = genuine commercial interest and a usable phone;
no_result = clear spam, testing/abuse, job solicitation, explicit disinterest;
unclassified = greeting, fragment, support-only request, or insufficient evidence.
Understand Azerbaijani/Russian/English transliteration and misspellings such as ölçü/olcu/olchu.
Never choose potential when HAS_PHONE=false. Return JSON only:
{"stage":"interested|potential|no_result|unclassified","confidence":0.0,"reason":"short Azerbaijani explanation"}`,
      messages: [{ role: "user", content: `HAS_PHONE=${hasPhone}\nMESSAGES:\n${maskPii(context)}` }],
    }),
  })
  if (!response.ok) return null
  const data = await response.json()
  return parseAiDecision(data?.content?.find((item) => item.type === "text")?.text, hasPhone)
}

async function ensureWebChatShells(orgId) {
  const sessions = await prisma.webChatSession.findMany({
    where: { organizationId: orgId },
    select: { id: true, contactId: true, visitorName: true, lastMessageAt: true },
  })
  const keys = sessions.map((session) => `w:${session.id}`)
  const existing = keys.length
    ? await prisma.socialConversation.findMany({
        where: { organizationId: orgId, platform: "inbox", externalId: { in: keys } },
        select: { externalId: true },
      })
    : []
  const existingKeys = new Set(existing.map((row) => row.externalId))
  const missing = sessions.filter((session) => !existingKeys.has(`w:${session.id}`))
  if (execute) {
    for (const session of missing) {
      await prisma.socialConversation.create({
        data: {
          organizationId: orgId,
          platform: "inbox",
          externalId: `w:${session.id}`,
          contactId: session.contactId,
          contactName: session.visitorName || "Web visitor",
          lastMessageAt: session.lastMessageAt,
          metadata: { channel: "web-chat", webChatSessionId: session.id, backfilledShell: true },
        },
      })
    }
  }
  return { total: sessions.length, missing: missing.length, created: execute ? missing.length : 0 }
}

function deterministicStage(conversation, messages) {
  if (conversation.closeOutcome === "won") return { stage: "sold", reason: "Söhbət satıldı nəticəsi ilə bağlanıb." }
  if (conversation.closeOutcome === "lost") return { stage: "not_sold", reason: "Söhbət satılmadı nəticəsi ilə bağlanıb." }
  if (
    conversation.closeOutcome === "none"
    && /(no.?answer|unreachable|cavab|elaqe|əlaqə|недоступ|не.?ответ)/i.test(conversation.closeOutcomeReason || "")
  ) {
    return { stage: "unable_to_contact", reason: "Bağlanma səbəbi müştəri ilə əlaqə saxlamağın mümkün olmadığını göstərir." }
  }
  if (conversation.closeOutcome === "none") return { stage: "no_result", reason: "Söhbət nəticəsiz bağlanıb." }
  if (messages.some(isHumanOutbound)) return { stage: "marketing_contacted", reason: "Mesaj tarixçəsində marketinq əməkdaşının cavabı var." }
  return null
}

async function syncTaskStatus(tx, conversation, stage) {
  const metadata = record(conversation.metadata)
  const taskId = typeof metadata.qualificationTaskId === "string" ? metadata.qualificationTaskId : null
  if (!taskId) return
  const task = await tx.task.findFirst({
    where: { id: taskId, organizationId: conversation.organizationId },
    select: { id: true, customFields: true },
  })
  if (!task) return
  await tx.task.update({
    where: { id: task.id },
    data: {
      customFields: {
        ...record(task.customFields),
        inboxCustomerStatus: TASK_LABELS[stage],
      },
    },
  })
}

async function applyStage(orgId, conversation, decision, aiSuggested) {
  if (!execute) return
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.socialConversation.findFirst({
      where: { id: conversation.id, organizationId: orgId },
      select: { customerStage: true },
    })
    if (!fresh || fresh.customerStage) return
    if (aiSuggested) {
      await tx.socialConversation.update({
        where: { id: conversation.id },
        data: {
          aiSuggestedCustomerStage: decision.stage,
          aiCustomerStageConfidence: decision.confidence,
          aiCustomerStageReason: decision.reason,
          aiCustomerStageSuggestedAt: new Date(),
        },
      })
      return
    }
    await tx.socialConversation.update({
      where: { id: conversation.id },
      data: {
        customerStage: decision.stage,
        customerStageSource: "backfill",
        customerStageConfidence: decision.confidence ?? null,
        customerStageReason: decision.reason,
        customerStageUpdatedAt: new Date(),
        customerStageUpdatedBy: null,
      },
    })
    await tx.inboxCustomerStageEvent.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        fromStage: null,
        toStage: decision.stage,
        source: "backfill",
        confidence: decision.confidence ?? null,
        reason: decision.reason,
      },
    })
    await syncTaskStatus(tx, conversation, decision.stage)
  })
}

async function main() {
  const org = await prisma.organization.findFirst({
    where: { OR: [{ id: orgArg }, { slug: orgArg }] },
    select: { id: true, slug: true, name: true, features: true },
  })
  if (!org) throw new Error(`Organization not found: ${orgArg}`)
  console.log(`Org: ${org.name} (${org.slug} / ${org.id})`)
  console.log(`Mode: ${execute ? "APPLY" : "DRY-RUN"}; AI: ${useAi && process.env.ANTHROPIC_API_KEY ? MODEL : "disabled"}`)

  const web = await ensureWebChatShells(org.id)
  console.log(`Web-chat shells: ${web.total} total; ${web.missing} missing; ${web.created} created`)

  const conversations = await prisma.socialConversation.findMany({
    where: { organizationId: org.id },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: {
      id: true,
      organizationId: true,
      platform: true,
      externalId: true,
      contactId: true,
      metadata: true,
      customerStage: true,
      closeOutcome: true,
      closeOutcomeReason: true,
      lastMessage: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { direction: true, body: true, from: true, to: true, metadata: true },
      },
    },
  })
  const contactIds = [...new Set(conversations.map((row) => row.contactId).filter(Boolean))]
  const contacts = contactIds.length
    ? await prisma.contact.findMany({
        where: { organizationId: org.id, id: { in: contactIds } },
        select: { id: true, phone: true, phones: true },
      })
    : []
  const phoneByContact = new Map(contacts.map((contact) => [contact.id, contact.phone || contact.phones[0] || null]))

  const counts = {
    total: conversations.length,
    preserved: 0,
    interested: 0,
    potential: 0,
    marketing_contacted: 0,
    sales_contacted: 0,
    unable_to_contact: 0,
    sold: 0,
    not_sold: 0,
    no_result: 0,
    unclassified: 0,
    aiErrors: 0,
  }

  let processed = 0
  for (const conversation of conversations) {
    processed++
    if (conversation.customerStage && STAGES.has(conversation.customerStage)) {
      counts.preserved++
      if (processed % 25 === 0 || processed === conversations.length) {
        console.log(`Progress: ${processed}/${conversations.length}`)
      }
      continue
    }
    let messages = conversation.messages
    let visitorPhone = null
    if (conversation.platform === "inbox" && conversation.externalId.startsWith("w:")) {
      const sessionId = conversation.externalId.slice(2)
      const session = await prisma.webChatSession.findFirst({
        where: { id: sessionId, organizationId: org.id },
        select: {
          visitorPhone: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 30,
            select: { fromRole: true, text: true, metadata: true },
          },
        },
      })
      visitorPhone = session?.visitorPhone ?? null
      if (session?.messages.length) {
        messages = session.messages.map((message) => ({
          direction: message.fromRole === "visitor" ? "inbound" : "outbound",
          body: message.text,
          from: message.fromRole,
          to: "",
          metadata: message.metadata,
        }))
      }
    }
    const deterministic = deterministicStage(conversation, messages)
    if (deterministic) {
      counts[deterministic.stage]++
      await applyStage(org.id, conversation, deterministic, false)
      if (processed % 25 === 0 || processed === conversations.length) {
        console.log(`Progress: ${processed}/${conversations.length}`)
      }
      continue
    }
    const metadata = record(conversation.metadata)
    const hasPhone = hasPhoneText(visitorPhone)
      || hasPhoneText(phoneByContact.get(conversation.contactId))
      || ["contactPhone", "phone", "waPhone"].some((key) => hasPhoneText(metadata[key]))
      || messages.some((message) => hasPhoneText(`${message.from} ${message.to} ${message.body}`))
    const context = messages
      .slice()
      .reverse()
      .map((message) => `${message.direction === "inbound" ? "CUSTOMER" : "AGENT"}: ${message.body}`)
      .concat(conversation.lastMessage ? [`LATEST: ${conversation.lastMessage}`] : [])
      .join("\n")
    const decision = await classifyWithAi(context, hasPhone)
    if (!decision) {
      counts.unclassified++
      if (useAi && process.env.ANTHROPIC_API_KEY) counts.aiErrors++
      if (processed % 25 === 0 || processed === conversations.length) {
        console.log(`Progress: ${processed}/${conversations.length}`)
      }
      continue
    }
    if (decision.stage === "unclassified" || decision.confidence < 0.72) {
      counts.unclassified++
      if (processed % 25 === 0 || processed === conversations.length) {
        console.log(`Progress: ${processed}/${conversations.length}`)
      }
      continue
    }
    counts[decision.stage]++
    await applyStage(org.id, conversation, decision, true)
    if (processed % 25 === 0 || processed === conversations.length) {
      console.log(`Progress: ${processed}/${conversations.length}`)
    }
  }

  if (execute) {
    const features = Array.isArray(org.features) ? org.features : []
    if (!features.includes("inbox-customer-segmentation")) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { features: [...features, "inbox-customer-segmentation"] },
      })
    }
    // custom_fields is FORCE RLS in production. Use an explicitly tenant-scoped
    // client for this final tenant-owned definition instead of relying on the
    // operator bypass used by the rest of the maintenance script.
    const tenantPrisma = await makeScriptPrisma({ orgId: org.id })
    try {
      await tenantPrisma.customField.upsert({
        where: {
          organizationId_entityType_fieldName: {
            organizationId: org.id,
            entityType: "task",
            fieldName: "inboxCustomerStatus",
          },
        },
        create: {
          organizationId: org.id,
          entityType: "task",
          fieldName: "inboxCustomerStatus",
          fieldLabel: "Müştəri statusu",
          fieldType: "select",
          options: Object.values(TASK_LABELS),
          sortOrder: 0,
          isActive: true,
        },
        update: { options: Object.values(TASK_LABELS), isActive: true },
      })
    } finally {
      await tenantPrisma.$disconnect()
    }
  }

  console.log(JSON.stringify(counts, null, 2))
  console.log(execute
    ? "✓ Applied explicit customer stages and enabled future AI classification for this tenant."
    : "DRY-RUN — nothing written. Review counts, then rerun with --execute and confirmation.")
}

main()
  .catch((error) => {
    console.error(`✗ Backfill failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
