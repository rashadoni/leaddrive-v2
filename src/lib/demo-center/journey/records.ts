/**
 * Synthetic, session-scoped records for the guided journey.
 *
 * The prospect's own identity (name, company, position, masked contacts)
 * seeds a small CRM world: the campaign that «brought» them, their inbound
 * conversation, and — as the journey advances — their lead, task, deal and
 * quote. Every amount, date and message is a sample; nothing here reads a
 * tenant. Effects are applied per journey transition by
 * `applyTransitionEffects`, so refresh/retry replays the same result.
 */
import type { DemoJourneyState } from "./types"

export const DEMO_SOURCE_CHANNELS = ["website", "instagram", "whatsapp", "referral", "event"] as const
export type DemoSourceChannel = (typeof DEMO_SOURCE_CHANNELS)[number]

export interface DemoProspectIdentity {
  readonly name: string
  readonly company: string
  readonly jobTitle: string | null
  /** Already masked by the server (`r***@company.az`). */
  readonly emailMasked: string
  /** Already masked by the server (`+994 ** *** 12 34`) or null. */
  readonly phoneMasked: string | null
  readonly sourceChannel: DemoSourceChannel
}

/** The synthetic manager who «works» the prospect's record. */
export const DEMO_MANAGER_NAME = "Aysel Məmmədova"

export interface DemoCampaignRecord {
  readonly id: string
  readonly name: string
  readonly channel: DemoSourceChannel
  readonly status: "sent"
  readonly audience: number
  readonly sent: number
  readonly opened: number
  readonly clicked: number
  readonly sentAt: string
  /** What was entered for the campaign; the product counts the budget as the cost once it has gone out (src/lib/campaigns/roi.ts). */
  readonly budget: number
  /** The funnel the campaign ROI screen draws: leads → deals → won, and the money the won ones brought. */
  readonly leads: number
  readonly deals: number
  readonly wonDeals: number
  readonly revenue: number
}

/**
 * Opens, clicks, bounces and spam are recorded for e-mail campaigns only —
 * the campaign page says so itself when the campaign is of another type
 * (`campaigns.detailEngagementEmailOnly`). Two of the demo's channels are
 * e-mail ones; for the rest the demo shows «—», exactly like a live tenant,
 * instead of inventing an open rate Instagram never reports.
 */
export function campaignRecordsEngagement(channel: DemoSourceChannel): boolean {
  return channel === "referral" || channel === "event"
}

export interface DemoMessageRecord {
  readonly id: string
  readonly direction: "inbound" | "outbound"
  readonly author: string
  readonly text: string
  readonly at: string
  readonly ai: boolean
  /** Outbound demo messages never leave the session. */
  readonly delivery: "received" | "simulated"
}

export interface DemoAiDraft {
  readonly text: string
  readonly quality: number
  readonly reason: string
  readonly createdAt: string
}

export interface DemoConversationRecord {
  readonly id: string
  readonly channel: DemoSourceChannel
  readonly contactName: string
  readonly companyName: string
  readonly status: "opened" | "closed"
  readonly assignedTo: string
  readonly unread: number
  readonly messages: readonly DemoMessageRecord[]
  readonly aiDraft: DemoAiDraft | null
}

export type DemoLeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost"

export interface DemoActivityRecord {
  readonly id: string
  readonly type: "note" | "call" | "email" | "meeting" | "message"
  readonly subject: string
  readonly description: string
  readonly createdAt: string
  readonly createdByName: string
}

export interface DemoTimelineEntry {
  readonly id: string
  readonly kind: "message" | "email" | "activity" | "task" | "call" | "deal" | "quote"
  readonly title: string
  readonly subtitle?: string
  readonly date: string
  readonly channel?: string
}

export interface DemoLeadRecord {
  readonly id: string
  readonly contactName: string
  readonly companyName: string
  readonly jobTitle: string | null
  readonly email: string
  readonly phone: string | null
  readonly source: DemoSourceChannel
  readonly sourceDetail: string
  readonly status: DemoLeadStatus
  readonly priority: "low" | "medium" | "high"
  readonly score: number
  readonly scoreDetails: { readonly reasoning: string; readonly factors: Readonly<Record<string, number>> }
  readonly estimatedValue: number
  readonly currency: "AZN"
  readonly assignedToName: string
  readonly createdAt: string
  readonly convertedAt: string | null
  readonly activities: readonly DemoActivityRecord[]
  readonly timeline: readonly DemoTimelineEntry[]
}

export interface DemoTaskRecord {
  readonly id: string
  readonly title: string
  readonly status: "todo" | "in_progress" | "done"
  readonly priority: "low" | "medium" | "high"
  readonly dueAt: string
  readonly assigneeName: string
  readonly relatedLeadId: string
  readonly createdAt: string
  readonly comments: readonly { readonly id: string; readonly author: string; readonly text: string; readonly at: string }[]
}

export interface DemoDealRecord {
  readonly id: string
  readonly title: string
  readonly stageIndex: number
  readonly amount: number
  readonly currency: "AZN"
  readonly probability: number
  readonly expectedCloseAt: string
  readonly createdAt: string
  readonly wonAt: string | null
}

/**
 * Demo pipeline stages; the last one is the won stage.
 *
 * `labelKey` names a key in the product's own `deals` namespace, so the demo
 * says exactly what the product says. Real tenants keep their own vocabulary
 * (`orgStageVocabulary`) — this is the sample's, and it is never written
 * into a tenant.
 */
export const DEMO_DEAL_STAGES = [
  { key: "qualified", labelKey: "stageQualified", probability: 20 },
  { key: "proposal", labelKey: "stageProposal", probability: 45 },
  { key: "negotiation", labelKey: "stageNegotiation", probability: 70 },
  { key: "won", labelKey: "stageWon", probability: 100 },
] as const

export interface DemoQuoteLine {
  readonly id: string
  readonly product: string
  readonly quantity: number
  readonly unitPrice: number
}

export interface DemoQuoteRecord {
  readonly id: string
  readonly quoteNumber: string
  readonly status: "draft" | "sent" | "viewed" | "accepted"
  readonly lines: readonly DemoQuoteLine[]
  readonly vatPercent: number
  readonly validUntil: string
  readonly createdAt: string
  readonly sentAt: string | null
  readonly viewedAt: string | null
  readonly acceptedAt: string | null
}

export interface DemoJourneyRecords {
  readonly campaign: DemoCampaignRecord
  readonly conversation: DemoConversationRecord
  readonly lead: DemoLeadRecord | null
  readonly task: DemoTaskRecord | null
  readonly deal: DemoDealRecord | null
  readonly quote: DemoQuoteRecord | null
}

const CHANNEL_CAMPAIGN: Readonly<Record<DemoSourceChannel, { name: string; sourceDetail: string }>> = {
  website: { name: "Veb-sayt: demo forması", sourceDetail: "leaddrive.az / demo" },
  instagram: { name: "Instagram: CRM tanıtımı", sourceDetail: "Instagram reklamı" },
  whatsapp: { name: "WhatsApp: müraciət xətti", sourceDetail: "WhatsApp Business" },
  referral: { name: "Tövsiyə proqramı", sourceDetail: "Tərəfdaş tövsiyəsi" },
  event: { name: "Tədbir: CRM seminarı", sourceDetail: "Bakı, seminar" },
}

export const DEMO_CHANNEL_LABELS: Readonly<Record<DemoSourceChannel, string>> = {
  website: "Veb-çat",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  referral: "E-poçt",
  event: "E-poçt",
}

function iso(base: Date, offsetMinutes: number): string {
  return new Date(base.getTime() + offsetMinutes * 60_000).toISOString()
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/** What the prospect sets on «Mövqelər və cəm»; the draft starts two below it. */
export const DEMO_QUOTE_LICENCES = 10

/** What each ending of the AI call leaves on the lead. */
export const DEMO_CALL_OUTCOME_COPY: Partial<Record<DemoJourneyState, { subject: string; note: string; title: string; subtitle: string; duration: string }>> = {
  CALL_RESULT_RECORDED: {
    subject: "AI zəngi — cavab verildi (2 dəq 04 san)",
    note: "Müştəri demo üçün sabah saat 11:00-ı seçdi. Nəticə: maraqlıdır.",
    title: "AI zəngi: cavab verildi, 2 dəq",
    subtitle: "Nəticə: maraqlıdır",
    duration: "2 dəq 04 san",
  },
  CALL_NO_ANSWER: { subject: "AI zəngi — cavab verilmədi", note: "Zəngə cavab verilmədi. Növbəti cəhd menecerin tapşırığındadır.", title: "AI zəngi: cavab verilmədi", subtitle: "Yenidən cəhd tapşırıqdadır", duration: "—" },
  CALL_BUSY: { subject: "AI zəngi — nömrə məşğul", note: "Nömrə məşğul idi; zəng təkrarlanacaq.", title: "AI zəngi: nömrə məşğul", subtitle: "Təkrar cəhd", duration: "—" },
  CALL_FAILED: { subject: "AI zəngi — texniki xəta", note: "Zəng texniki səbəbdən alınmadı.", title: "AI zəngi: alınmadı", subtitle: "Texniki xəta", duration: "—" },
  CALL_ATTENTION_REQUIRED: { subject: "AI zəngi — nəticə dəqiqləşdirilir", note: "Zəngin nəticəsi hələ gəlməyib; menecer yoxlayacaq.", title: "AI zəngi: nəticə gözlənilir", subtitle: "Menecer yoxlayır", duration: "—" },
  CALL_DECLINED: { subject: "AI zəngi — müştəri imtina etdi", note: "Müştəri zəngdən imtina etdi; hekayə zəngsiz davam edir.", title: "AI zəngi: müştəri imtina etdi", subtitle: "Zəngsiz davam", duration: "—" },
  CALL_BLOCKED: { subject: "AI zəngi — yoxlama keçmədi", note: "Nömrə təsdiqlənmədiyi üçün zəng edilmədi.", title: "AI zəngi: yoxlama keçmədi", subtitle: "Nömrə təsdiqlənməyib", duration: "—" },
  CALL_SKIPPED: { subject: "AI zəngi — bu sessiyada edilmədi", note: "Bu demo sessiyasında zəng edilmədi.", title: "AI zəngi bu sessiyada edilmədi", subtitle: "Zəngsiz davam", duration: "—" },
}

export function quoteTotals(quote: Pick<DemoQuoteRecord, "lines" | "vatPercent">): { net: number; vat: number; gross: number } {
  const net = quote.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  const vat = Math.round(net * quote.vatPercent) / 100
  return { net, vat, gross: net + vat }
}

export function createJourneyRecords(identity: DemoProspectIdentity, now: Date): DemoJourneyRecords {
  const campaignMeta = CHANNEL_CAMPAIGN[identity.sourceChannel]
  return {
    campaign: {
      id: "cmp-demo-1",
      name: campaignMeta.name,
      channel: identity.sourceChannel,
      status: "sent",
      audience: 1240,
      sent: 1240,
      opened: 468,
      clicked: 97,
      sentAt: iso(now, -3 * 24 * 60),
      budget: 2400,
      leads: 37,
      deals: 6,
      wonDeals: 2,
      revenue: 9600,
    },
    conversation: {
      id: "conv-demo-1",
      channel: identity.sourceChannel,
      contactName: identity.name,
      companyName: identity.company,
      status: "opened",
      assignedTo: DEMO_MANAGER_NAME,
      unread: 1,
      messages: [
        {
          id: "msg-1",
          direction: "inbound",
          author: identity.name,
          text: `Salam! ${identity.company} üçün satış komandasına CRM axtarırıq. Lidləri və sövdələşmələri bir yerdə görmək istəyirik. Demo mümkündür?`,
          at: iso(now, -42),
          ai: false,
          delivery: "received",
        },
      ],
      aiDraft: {
        text: `Salam, ${firstName(identity.name)}! Təşəkkür edirik. LeadDrive-da lidlər, sövdələşmələr və bütün yazışmalar bir kartda toplanır. Sizə uyğun vaxtda 20 dəqiqəlik demo göstərə bilərik — sabah 11:00 və ya 15:00 münasibdir?`,
        quality: 86,
        reason: "drafts_only",
        createdAt: iso(now, -40),
      },
    },
    lead: null,
    task: null,
    deal: null,
    quote: null,
  }
}

/**
 * Rebuilds the records a journey would hold at `state`, from the identity
 * alone.
 *
 * The server uses this so it never has to trust a snapshot posted by the
 * browser: the client may say which state it reached, but every string in
 * the result comes from the database or from this file. Walking the happy
 * path is enough because each effect is idempotent and keyed to its own
 * target state.
 */
export function rebuildRecordsAtState(
  identity: DemoProspectIdentity,
  state: DemoJourneyState,
  now: Date,
  happyPath: readonly DemoJourneyState[],
): DemoJourneyRecords {
  let records = createJourneyRecords(identity, now)
  for (const step of happyPath) {
    records = applyTransitionEffects(records, step, identity, now)
    if (step === state) break
  }
  // Alternative call outcomes are not on the happy path; apply the one asked
  // for so a declined or failed call still reads correctly.
  if (state.startsWith("CALL_") && !happyPath.includes(state)) {
    records = applyTransitionEffects(records, state, identity, now)
  }
  return records
}

/**
 * Applies the record-level consequence of entering `to`. Idempotent per
 * target state: applying the same transition twice yields the same records,
 * which is what makes refresh and retry safe.
 */
export function applyTransitionEffects(
  records: DemoJourneyRecords,
  to: DemoJourneyState,
  identity: DemoProspectIdentity,
  now: Date,
): DemoJourneyRecords {
  const at = now.toISOString()
  switch (to) {
    case "CONVERSATION_OPENED":
      return { ...records, conversation: { ...records.conversation, unread: 0 } }

    case "AI_REPLIED": {
      const draft = records.conversation.aiDraft
      if (!draft || records.conversation.messages.some((message) => message.id === "msg-ai-1")) return records
      return {
        ...records,
        conversation: {
          ...records.conversation,
          aiDraft: null,
          messages: [
            ...records.conversation.messages,
            { id: "msg-ai-1", direction: "outbound", author: DEMO_MANAGER_NAME, text: draft.text, at, ai: true, delivery: "simulated" },
          ],
        },
      }
    }

    case "LEAD_CREATED": {
      if (records.lead) return records
      const campaignMeta = CHANNEL_CAMPAIGN[identity.sourceChannel]
      const inbound = records.conversation.messages[0]
      return {
        ...records,
        // The prospect is now one of this campaign's leads — that link
        // (Lead.campaignId) is what the campaign ROI screen counts.
        campaign: { ...records.campaign, leads: records.campaign.leads + 1 },
        lead: {
          id: "lead-demo-1",
          contactName: identity.name,
          companyName: identity.company,
          jobTitle: identity.jobTitle,
          email: identity.emailMasked,
          phone: identity.phoneMasked,
          source: identity.sourceChannel,
          sourceDetail: campaignMeta.sourceDetail,
          status: "new",
          priority: "high",
          score: 72,
          scoreDetails: {
            reasoning: "Müraciət konkretdir (satış komandası üçün CRM), şirkət və vəzifə doldurulub, ilk cavab 2 dəqiqə ərzində verilib. Demo istəyi — yüksək niyyət siqnalıdır.",
            factors: { engagement: 82, fit: 74, intent: 88, recency: 95 },
          },
          estimatedValue: 4_800,
          currency: "AZN",
          assignedToName: DEMO_MANAGER_NAME,
          createdAt: at,
          convertedAt: null,
          activities: [
            {
              id: "act-1",
              type: "message",
              subject: "Gələn müraciət",
              description: inbound?.text ?? "",
              createdAt: inbound?.at ?? at,
              createdByName: identity.name,
            },
            {
              id: "act-2",
              type: "email",
              subject: "AI cavabı göndərildi (simulyasiya)",
              description: records.conversation.messages.find((message) => message.ai)?.text ?? "",
              createdAt: at,
              createdByName: DEMO_MANAGER_NAME,
            },
          ],
          timeline: [
            { id: "tl-1", kind: "message", title: "Gələn müraciət", subtitle: DEMO_CHANNEL_LABELS[identity.sourceChannel], date: inbound?.at ?? at, channel: identity.sourceChannel },
            { id: "tl-2", kind: "email", title: "AI cavabı (simulyasiya)", subtitle: DEMO_MANAGER_NAME, date: at },
            { id: "tl-3", kind: "activity", title: "Lid kartı yaradıldı", subtitle: `Mənbə: ${campaignMeta.name}`, date: at },
          ],
        },
      }
    }

    case "LEAD_QUALIFIED": {
      if (!records.lead || records.lead.status === "qualified") return records
      return {
        ...records,
        lead: {
          ...records.lead,
          status: "qualified",
          timeline: [...records.lead.timeline, { id: "tl-4", kind: "activity", title: "Status: Kvalifikasiya edildi", subtitle: DEMO_MANAGER_NAME, date: at }],
        },
      }
    }

    // However a call ends, the card and the timeline say the same thing:
    // how long it took, how it ended, what the assistant noted.
    case "CALL_RESULT_RECORDED":
    case "CALL_NO_ANSWER":
    case "CALL_BUSY":
    case "CALL_FAILED":
    case "CALL_ATTENTION_REQUIRED":
    case "CALL_SKIPPED":
    case "CALL_DECLINED":
    case "CALL_BLOCKED": {
      if (!records.lead || records.lead.timeline.some((entry) => entry.id === "tl-call")) return records
      const outcome = DEMO_CALL_OUTCOME_COPY[to] ?? DEMO_CALL_OUTCOME_COPY.CALL_RESULT_RECORDED
      return {
        ...records,
        lead: {
          ...records.lead,
          activities: [
            ...records.lead.activities,
            { id: "act-call", type: "call", subject: outcome.subject, description: outcome.note, createdAt: at, createdByName: DEMO_MANAGER_NAME },
          ],
          timeline: [...records.lead.timeline, { id: "tl-call", kind: "call", title: outcome.title, subtitle: outcome.subtitle, date: at }],
        },
      }
    }

    case "TASK_CREATED": {
      if (records.task || !records.lead) return records
      return {
        ...records,
        task: {
          id: "task-demo-1",
          title: `İzləmə: ${identity.name} (${identity.company}) — demo vaxtını razılaşdır`,
          status: "todo",
          priority: "high",
          dueAt: iso(now, 24 * 60),
          assigneeName: DEMO_MANAGER_NAME,
          relatedLeadId: records.lead.id,
          createdAt: at,
          comments: [
            { id: "cmt-1", author: "LeadDrive", text: "Tapşırıq kvalifikasiyadan sonra avtomatik yaradıldı.", at },
          ],
        },
        lead: {
          ...records.lead,
          timeline: [...records.lead.timeline, { id: "tl-task", kind: "task", title: "İzləmə tapşırığı yaradıldı", subtitle: "Son tarix: sabah", date: at }],
        },
      }
    }

    case "DEAL_CREATED": {
      if (records.deal || !records.lead) return records
      return {
        ...records,
        campaign: { ...records.campaign, deals: records.campaign.deals + 1 },
        deal: {
          id: "deal-demo-1",
          title: `${identity.company} — LeadDrive CRM`,
          stageIndex: 0,
          amount: records.lead.estimatedValue,
          currency: "AZN",
          probability: DEMO_DEAL_STAGES[0].probability,
          expectedCloseAt: iso(now, 14 * 24 * 60),
          createdAt: at,
          wonAt: null,
        },
        lead: {
          ...records.lead,
          status: "converted",
          convertedAt: at,
          timeline: [...records.lead.timeline, { id: "tl-deal", kind: "deal", title: "Sövdələşməyə çevrildi", subtitle: `${identity.company} — LeadDrive CRM`, date: at }],
        },
      }
    }

    case "DEAL_ADVANCED": {
      if (!records.deal || records.deal.stageIndex >= 1) return records
      return { ...records, deal: { ...records.deal, stageIndex: 1, probability: DEMO_DEAL_STAGES[1].probability } }
    }

    case "QUOTE_CREATED": {
      if (records.quote) return records
      return {
        ...records,
        quote: {
          id: "quote-demo-1",
          quoteNumber: "KT-2026-0418",
          status: "draft",
          // The prospect corrects the licence count on the «Mövqelər və cəm»
          // step (8 → 10), and the total lands next to the lead's estimate
          // (4 800 ₼) instead of a third of it.
          lines: [
            { id: "ql-1", product: "LeadDrive CRM · istifadəçi lisenziyası (illik)", quantity: 8, unitPrice: 349 },
            { id: "ql-2", product: "Omni-Channel modulu", quantity: 1, unitPrice: 590 },
          ],
          vatPercent: 18,
          validUntil: iso(now, 14 * 24 * 60),
          createdAt: at,
          sentAt: null,
          viewedAt: null,
          acceptedAt: null,
        },
      }
    }

    case "QUOTE_SENT": {
      if (!records.quote || records.quote.status !== "draft") return records
      // The licence count the prospect corrected on the previous step.
      const lines = records.quote.lines.map((line) => (line.id === "ql-1" ? { ...line, quantity: DEMO_QUOTE_LICENCES } : line))
      return { ...records, quote: { ...records.quote, lines, status: "sent", sentAt: at } }
    }

    case "QUOTE_ACCEPTED": {
      if (!records.quote || records.quote.status === "accepted") return records
      return { ...records, quote: { ...records.quote, status: "accepted", viewedAt: records.quote.viewedAt ?? at, acceptedAt: at } }
    }

    case "CLOSED_WON": {
      if (!records.deal || records.deal.wonAt) return records
      const wonIndex = DEMO_DEAL_STAGES.length - 1
      const gross = records.quote ? quoteTotals(records.quote).gross : records.deal.amount
      return {
        ...records,
        // Won money is attributed to the campaign the deal came from, so the
        // campaign's ROI moves with this one deal.
        campaign: { ...records.campaign, wonDeals: records.campaign.wonDeals + 1, revenue: records.campaign.revenue + gross },
        deal: { ...records.deal, stageIndex: wonIndex, probability: 100, amount: gross, wonAt: at },
        lead: records.lead
          ? { ...records.lead, timeline: [...records.lead.timeline, { id: "tl-won", kind: "deal", title: "Sövdələşmə qazanıldı", subtitle: `Mənbə: ${records.campaign.name}`, date: at }] }
          : records.lead,
      }
    }

    default:
      return records
  }
}
