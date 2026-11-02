/**
 * The Service Desk module's invented support team: a company that sells and
 * services shop and office equipment, its morning queue and a month of one
 * agent's tickets.
 *
 * No deadline is typed in. Every ticket carries the time it arrived and its
 * priority; the SLA dates come from the product's own working-hours clock
 * (`addSlaWorkingMilliseconds`) over the policies below, so a ticket that
 * arrived at 07:58 starts counting at 09:00 exactly as it would in the
 * product. The agent's figures are the product's own
 * `calculateAgentDesktopMetrics` over that month.
 *
 * Every name, company, phone and minute is made up. The day is the Route &
 * Field module's demo day (the latest Thursday), at 09:12 Baku time — the
 * morning shift has just begun.
 */
import { calculateAgentDesktopMetrics, type AgentDesktopMetricRow, type AgentDesktopMetrics } from "@/lib/ticketing/agent-desktop"
import { addSlaWorkingMilliseconds, type SlaBusinessCalendar } from "@/lib/ticketing/sla-business-calendar"
import { triggerTimeFromDeadline, type EscalationRule } from "@/lib/escalation-rules/presentation"
import { addDays, mtmDemoAt } from "./mtm-demo-data"

export const SUPPORT_DEMO_CLOCK = "09:12"
export const SUPPORT_DEMO_TIMEZONE = "Asia/Baku"

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

/** Monday to Friday, 09:00–18:00 in Baku: the calendar the policies were captured with. */
export const SUPPORT_DEMO_CALENDAR: SlaBusinessCalendar = {
  version: 1,
  sourceId: "demo-business-hours",
  capturedAt: "2026-09-01T06:00:00.000Z",
  sourceUpdatedAt: "2026-09-01T06:00:00.000Z",
  timezone: SUPPORT_DEMO_TIMEZONE,
  boundaryPolicy: "reject_ambiguous_or_missing",
  schedule: {
    mon: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
    tue: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
    wed: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
    thu: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
    fri: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
    sat: { enabled: false, intervals: [] },
    sun: { enabled: false, intervals: [] },
  },
  holidays: [],
}

export type SupportDemoPriority = "critical" | "high" | "medium" | "low"

export interface SupportDemoPolicy {
  readonly id: string
  readonly name: string
  readonly priority: SupportDemoPriority
  readonly firstResponseHours: number
  readonly resolutionHours: number
  readonly isActive: boolean
  readonly companies: number
  readonly entitlements: number
}

/** One active policy per priority, in working hours. */
export const SUPPORT_DEMO_POLICIES: readonly SupportDemoPolicy[] = [
  { id: "sla-critical", name: "Satış dayanıb", priority: "critical", firstResponseHours: 0.5, resolutionHours: 4, isActive: true, companies: 14, entitlements: 3 },
  { id: "sla-high", name: "İş çətinləşib", priority: "high", firstResponseHours: 1, resolutionHours: 8, isActive: true, companies: 14, entitlements: 3 },
  { id: "sla-medium", name: "Standart", priority: "medium", firstResponseHours: 4, resolutionHours: 16, isActive: true, companies: 14, entitlements: 0 },
  { id: "sla-low", name: "Sual və təklif", priority: "low", firstResponseHours: 8, resolutionHours: 40, isActive: true, companies: 14, entitlements: 0 },
]

const policyOf = (priority: SupportDemoPriority) => SUPPORT_DEMO_POLICIES.find((policy) => policy.priority === priority)!

function due(createdAt: string, hours: number): string {
  return addSlaWorkingMilliseconds(new Date(createdAt), hours * HOUR, SUPPORT_DEMO_CALENDAR).toISOString()
}

export type SupportDemoStatus = "new" | "open" | "in_progress" | "waiting" | "resolved" | "closed"
export type SupportDemoChannel = "whatsapp" | "email" | "portal"
export type SupportDemoCategory = "general" | "technical" | "billing" | "feature_request"

export interface SupportDemoTicket {
  readonly id: string
  readonly ticketNumber: string
  readonly subject: string
  readonly category: SupportDemoCategory
  readonly channel: SupportDemoChannel
  readonly priority: SupportDemoPriority
  readonly status: SupportDemoStatus
  readonly companyName: string
  readonly requesterName: string
  readonly requesterDetail: string
  readonly assigneeName: string | null
  readonly createdAt: string
  readonly firstResponseAt: string | null
  readonly slaFirstResponseDueAt: string
  readonly slaDueAt: string
  readonly resolvedAt: string | null
  readonly escalationLevel: number
}

export const SUPPORT_DEMO_TEAM_LEAD = "Kamran Abbasov"
export const SUPPORT_DEMO_AGENT = "Leyla Səfərova"
/** The ticket the morning starts with: the shop that cannot print a receipt.
 *  It came in on WhatsApp, so the product opened it by itself from the first
 *  message, numbered it with the WhatsApp prefix and gave it the default
 *  priority; the team lead shortened its subject at 09:06 (his note says so). */
export const SUPPORT_DEMO_TICKET_ID = "wa-0417"

interface Seed {
  id: string
  prefix: "TK" | "WA"
  number: number
  subject: string
  category: SupportDemoCategory
  channel: SupportDemoChannel
  priority: SupportDemoPriority
  status: SupportDemoStatus
  companyName: string
  requesterName: string
  requesterDetail: string
  assigneeName: string | null
  /** Baku wall-clock time and day offset from the demo day. */
  created: [string, number]
  /** Minutes from arrival to the first public answer, or none yet. */
  answeredAfter: number | null
  resolved?: [string, number]
  escalationLevel?: number
}

const SEEDS: readonly Seed[] = [
  { id: "tk-0419", prefix: "TK", number: 419, subject: "Anbar hesabatına yeni sütun əlavə etmək olarmı?", category: "feature_request", channel: "portal", priority: "low", status: "new", companyName: "Xəzri Optika", requesterName: "Aytən Quliyeva", requesterDetail: "ayten@xezrioptika.az", assigneeName: null, created: ["09:10", 0], answeredAfter: null },
  { id: "tk-0418", prefix: "TK", number: 418, subject: "Hesab-fakturada məbləğ iki dəfə yazılıb", category: "billing", channel: "email", priority: "medium", status: "new", companyName: "Atlas Klinika", requesterName: "Səbinə Qasımova", requesterDetail: "muhasibat@atlas-klinika.az", assigneeName: null, created: ["09:05", 0], answeredAfter: null },
  { id: SUPPORT_DEMO_TICKET_ID, prefix: "WA", number: 417, subject: "Kassa proqramı çeki çap etmir", category: "technical", channel: "whatsapp", priority: "medium", status: "open", companyName: "Sahil Market", requesterName: "Rauf Həsənov", requesterDetail: "+994 50 ••• •• 17", assigneeName: null, created: ["07:58", 0], answeredAfter: null },
  { id: "tk-0416", prefix: "TK", number: 416, subject: "Hesabat Excel-ə boş çıxır", category: "technical", channel: "portal", priority: "high", status: "open", companyName: "Nur Tekstil", requesterName: "Elçin Məmmədli", requesterDetail: "elcin@nurtekstil.az", assigneeName: SUPPORT_DEMO_TEAM_LEAD, created: ["15:20", -1], answeredAfter: 21 },
  { id: "tk-0415", prefix: "TK", number: 415, subject: "Parol bərpası linki gəlmir", category: "general", channel: "email", priority: "high", status: "resolved", companyName: "Dəniz Avto", requesterName: "Tural Nəsirov", requesterDetail: "tural@denizavto.az", assigneeName: SUPPORT_DEMO_AGENT, created: ["14:10", -1], answeredAfter: 18, resolved: ["17:10", -1] },
  { id: "tk-0414", prefix: "TK", number: 414, subject: "Mobil tətbiqdə sifariş tarixçəsi görünmür", category: "technical", channel: "email", priority: "medium", status: "in_progress", companyName: "Qafqaz Mebel", requesterName: "Nərgiz Abbaslı", requesterDetail: "satis@qafqazmebel.az", assigneeName: SUPPORT_DEMO_AGENT, created: ["12:40", -1], answeredAfter: 75 },
  { id: "tk-0413", prefix: "TK", number: 413, subject: "Terminal Wi-Fi-a qoşulmur", category: "technical", channel: "portal", priority: "high", status: "in_progress", companyName: "Ləman Kafe", requesterName: "Ləman Rüstəmova", requesterDetail: "leman@lemankafe.az", assigneeName: SUPPORT_DEMO_AGENT, created: ["10:05", -1], answeredAfter: 35, escalationLevel: 1 },
  { id: "tk-0412", prefix: "TK", number: 412, subject: "Hesabatda şirkət loqosunu dəyişmək olarmı?", category: "feature_request", channel: "portal", priority: "low", status: "open", companyName: "Bakı Tikinti Servis", requesterName: "Fuad İsmayılov", requesterDetail: "fuad@btservis.az", assigneeName: SUPPORT_DEMO_TEAM_LEAD, created: ["16:00", -2], answeredAfter: 30 },
  { id: "tk-0411", prefix: "TK", number: 411, subject: "Yeni filial üçün istifadəçi əlavə edin", category: "general", channel: "portal", priority: "medium", status: "waiting", companyName: "Günəş Aptek", requesterName: "Orxan Vəliyev", requesterDetail: "orxan@gunesaptek.az", assigneeName: SUPPORT_DEMO_TEAM_LEAD, created: ["11:30", -2], answeredAfter: 40 },
  { id: "tk-0410", prefix: "TK", number: 410, subject: "Yeni kassir üçün giriş", category: "general", channel: "portal", priority: "medium", status: "closed", companyName: "Sahil Market", requesterName: "Rauf Həsənov", requesterDetail: "rauf@sahilmarket.az", assigneeName: SUPPORT_DEMO_TEAM_LEAD, created: ["09:50", -2], answeredAfter: 25, resolved: ["13:30", -2] },
]

/** The morning queue, newest first, as the list shows it. */
export function supportDemoTickets(today: string): SupportDemoTicket[] {
  return SEEDS.map((seed) => {
    const createdAt = mtmDemoAt(today, seed.created[0], seed.created[1])
    const policy = policyOf(seed.priority)
    return {
      id: seed.id,
      ticketNumber: `${seed.prefix}-${String(seed.number).padStart(4, "0")}`,
      subject: seed.subject,
      category: seed.category,
      channel: seed.channel,
      priority: seed.priority,
      status: seed.status,
      companyName: seed.companyName,
      requesterName: seed.requesterName,
      requesterDetail: seed.requesterDetail,
      assigneeName: seed.assigneeName,
      createdAt,
      firstResponseAt: seed.answeredAfter === null ? null : new Date(Date.parse(createdAt) + seed.answeredAfter * MINUTE).toISOString(),
      slaFirstResponseDueAt: due(createdAt, policy.firstResponseHours),
      slaDueAt: due(createdAt, policy.resolutionHours),
      resolvedAt: seed.resolved ? mtmDemoAt(today, seed.resolved[0], seed.resolved[1]) : null,
      escalationLevel: seed.escalationLevel ?? 0,
    }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** The list page's own rule for «Növbəti prioritet» and the take-next claim:
 *  unassigned and still open, earliest SLA deadline first, then the oldest. */
export function supportDemoNextTicket(tickets: readonly SupportDemoTicket[]): SupportDemoTicket | null {
  return [...tickets]
    .filter((ticket) => !ticket.assigneeName && ticket.status !== "resolved" && ticket.status !== "closed")
    .sort((a, b) => a.slaDueAt.localeCompare(b.slaDueAt) || a.createdAt.localeCompare(b.createdAt))[0] ?? null
}

/** What the customer wrote on WhatsApp: the first message opened the ticket,
 *  the next one landed in it as a comment. */
export const SUPPORT_DEMO_CUSTOMER_MESSAGES = [
  { at: "07:58", text: "Salam, kassa proqramı çeki çap etmir, satış dayanıb. Printerin işığı yanır." },
  { at: "08:03", text: "Kağız var, kabel taxılıb. Proqramın parametrlərində printer siyahıda yoxdur." },
] as const

/** The knowledge-base article the reply draft is built from. */
export const SUPPORT_DEMO_ARTICLE = { title: "Printer siyahıda görünmür: drayveri yenidən seçmək", category: "Kassa proqramı" } as const

/** What «Da Vinci Cavab» puts into the reply box: steps from that article,
 *  for the agent to read and send. It names no time and promises no visit. */
export const SUPPORT_DEMO_DRAFT = [
  "Salam, Rauf bəy! Printer siyahıda görünmürsə, adətən proqram onun drayverini itirib. Zəhmət olmasa:",
  "1. Printeri söndürün və 10 saniyədən sonra yenidən yandırın.",
  "2. Kassa proqramında «Parametrlər → Printer» bölməsində «Yenilə» basın.",
  "3. Printer siyahıda görünəndə onu seçin və «Test çeki» basın.",
  "Test çeki çıxmasa, bu yazışmaya yazın — növbəti addımı birlikdə edərik.",
].join("\n")

/** The customer's answer on WhatsApp, which lands in the ticket by itself. */
/** The confirmation link in the resolve message: the product's shape (`/ticket-closure/<token>?lang=az`) on an invented domain. */
export const SUPPORT_DEMO_CLOSURE_LINK = "https://destek.servis-numune.az/ticket-closure/k7Qm2vX9?lang=az"
export const SUPPORT_DEMO_CUSTOMER_CONFIRMS = "Yenilə basdım, printer göründü, test çeki çıxdı. Satışa davam edirik, təşəkkürlər!"

/** Baku wall-clock times of the morning's moves on the ticket. */
export const SUPPORT_DEMO_TIMES = { reply: "09:14", customer: "09:21", resolved: "09:23" } as const

/** Already in the thread before the agent opens it: the team lead's note, never shown to the customer. */
export const SUPPORT_DEMO_INTERNAL_NOTE = { author: SUPPORT_DEMO_TEAM_LEAD, at: "09:06", text: "Mövzunu qısaltdım, kateqoriya — texniki. Sahil Market-də printer modeli köhnədir, bu ay ikinci müraciətdir; həll olunandan sonra dəyişdirməyi təklif edək." } as const

/** The month of the agent's own desk: tickets assigned to her and created in the last 30 days. */
export function supportDemoAgentRows(today: string): AgentDesktopMetricRow[] {
  const rows: AgentDesktopMetricRow[] = []
  for (let back = 30; back >= 0; back -= 1) {
    const day = addDays(today, -back)
    const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay()
    if (weekday === 0 || weekday === 6) continue
    for (let slot = 0; slot < 2; slot += 1) {
      const seed = `${day}:${slot}`
      const priority = (["high", "medium", "medium", "low", "critical", "medium"] as const)[spread(seed, 6)]
      const policy = policyOf(priority)
      // One ticket in the morning, one after lunch, inside working hours.
      const hour = slot === 0 ? 9 + spread(seed + "h", 2) : 13 + spread(seed + "h", 3)
      const createdAt = new Date(mtmDemoAt(day, `${String(hour).padStart(2, "0")}:${10 + spread(seed + "m", 40)}`))
      // Today's and yesterday's tickets are still open; the rest were worked.
      const open = back <= 1
      // Most answers land well inside the target; one in nine is slow — late
      // for an urgent ticket, still in time for an ordinary one.
      const slow = policy.firstResponseHours <= 1 ? policy.firstResponseHours * 60 + 25 : 70
      const answerMinutes = spread(seed + "late", 9) === 0 ? slow : 6 + spread(seed + "a", 30)
      const firstResponseAt = back === 0 && slot === 1 ? null : addSlaWorkingMilliseconds(createdAt, answerMinutes * MINUTE, SUPPORT_DEMO_CALENDAR)
      const workHours = spread(seed + "late2", 11) === 0 ? policy.resolutionHours + 2 : 1 + spread(seed + "r", Math.min(6, Math.round(policy.resolutionHours * 0.6)))
      const resolvedAt = open ? null : addSlaWorkingMilliseconds(createdAt, workHours * HOUR, SUPPORT_DEMO_CALENDAR)
      // About half of the customers rate the answer; most are pleased.
      const rated = !open && spread(seed + "rated", 2) === 0
      rows.push({
        createdAt,
        firstResponseAt,
        resolvedAt,
        slaFirstResponseDueAt: addSlaWorkingMilliseconds(createdAt, policy.firstResponseHours * HOUR, SUPPORT_DEMO_CALENDAR),
        slaDueAt: addSlaWorkingMilliseconds(createdAt, policy.resolutionHours * HOUR, SUPPORT_DEMO_CALENDAR),
        satisfactionRating: rated ? ([5, 5, 5, 4, 5, 4, 3, 5] as const)[spread(seed + "csat", 8)] : null,
      })
    }
  }
  return rows
}

export function supportDemoAgentMetrics(today: string): AgentDesktopMetrics {
  return calculateAgentDesktopMetrics(supportDemoAgentRows(today), new Date(mtmDemoAt(today, SUPPORT_DEMO_CLOCK)))
}

/** The team's escalation rules, in the product's own shape. */
export const SUPPORT_DEMO_ESCALATION_RULES: readonly EscalationRule[] = [
  { id: "esc-1", name: "Həll müddətinə 1 saat qalıb", triggerType: "resolution_warning", triggerMinutes: 60, level: 1, actions: [{ type: "notify", target: "manager" }], isActive: true, createdAt: "2026-09-01T06:00:00.000Z" },
  { id: "esc-2", name: "Həll müddəti keçib", triggerType: "resolution_breach", triggerMinutes: 15, level: 2, actions: [{ type: "increase_priority" }], isActive: true, createdAt: "2026-09-01T06:00:00.000Z" },
  { id: "esc-3", name: "Pozuntu uzanır", triggerType: "resolution_breach", triggerMinutes: 120, level: 3, actions: [{ type: "notify", target: "admin" }], isActive: true, createdAt: "2026-09-01T06:00:00.000Z" },
]

/** When each rule fires on a ticket, by the product's own `triggerTimeFromDeadline`. */
export function supportDemoEscalationTimes(ticket: Pick<SupportDemoTicket, "slaDueAt">): Array<{ rule: EscalationRule; at: string }> {
  return SUPPORT_DEMO_ESCALATION_RULES.map((rule) => ({ rule, at: triggerTimeFromDeadline(new Date(ticket.slaDueAt), rule.triggerType, rule.triggerMinutes).toISOString() }))
}

function spread(seed: string, modulo: number): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0
  return hash % modulo
}
