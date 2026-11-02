/**
 * The Contracts module's invented service company: its customer contracts,
 * the draft that an accepted quote created, the approval chain it goes
 * through, its signer, and the renewal reminders the CRM keeps.
 *
 * Built from the product's own rules: the draft is `buildSpawnedContractData`
 * (what accepting a quote writes), the list's figures are `contractListStats`,
 * the renewal reminders are `scheduleRenewalAlerts` shaped by
 * `buildLifecycleView`, and the bell's words are `renewalAlertText`.
 *
 * Left out because the product does not do it or not for everyone: renewal
 * or termination as a workflow (no status ever moves there by itself), the
 * AI clause extraction, risk score, redline and drafting (off by default),
 * DocuSign (not wired), revenue recognition and invoices (Finance).
 *
 * Every name, company, number and amount is made up. The day is the other
 * modules' demo day (the latest Thursday), at 10:30 Baku time.
 */
import { buildSpawnedContractData } from "@/lib/cpq/spawn-contract"
import { contractListStats } from "@/lib/contract-lifecycle/list-stats"
import { buildLifecycleView, type LifecycleAlertRow, type LifecycleStageRow } from "@/lib/contract-lifecycle/lifecycle-view"
import { scheduleRenewalAlerts } from "@/lib/contract-lifecycle/renewal-alert-scheduler"
import { renewalAlertText, renewalAlertType } from "@/lib/contract-lifecycle/notification-text"
import { addDays, mtmDemoAt } from "./mtm-demo-data"

export const CONTRACTS_DEMO_CLOCK = "10:30"
const CURRENCY = "AZN"
const DAY_MS = 24 * 60 * 60 * 1000

export function contractsDemoNow(today: string): string {
  return mtmDemoAt(today, CONTRACTS_DEMO_CLOCK)
}

const dateOf = (today: string, offset: number) => `${addDays(today, offset)}T00:00:00.000Z`

export interface ContractsDemoRow {
  id: string
  contractNumber: string
  title: string
  company: { name: string }
  type: string
  status: string
  valueAmount: number | null
  currency: string
  startDate: string
  endDate: string | null
  createdAt: string
  spawnedFromQuote: boolean
}

/** The quote the customer accepted, and the draft that acceptance wrote. */
export const CONTRACTS_DEMO_QUOTE = { id: "cdemoquote8f3k2a", quoteNumber: "Q-2026-031", company: "Xəzər Tikinti MMC", total: 48000 } as const
export const CONTRACTS_DEMO_DRAFT_ID = "contract-demo-draft"

/** The customer's director who signs it. */
export const CONTRACTS_DEMO_SIGNER = { fullName: "Elnur Məmmədov", email: "elnur@xezertikinti.az" } as const

/**
 * The approval chain the seller sets when sending the draft: legal first,
 * then the finance director — each must approve before the next is asked.
 */
export const CONTRACTS_DEMO_STAGES = [
  { order: 1, label: "Hüquq yoxlaması", assigneeRole: "manager", slaHours: 24 },
  { order: 2, label: "Maliyyə direktoru", assigneeRole: "admin", slaHours: 48 },
] as const

/** What the customer reads on the signing page — written in the editor. */
export const CONTRACTS_DEMO_BODY = [
  "1. Müqavilənin predmeti. İcraçı Sifarişçinin tikinti avadanlığına illik texniki xidmət göstərir: aylıq profilaktik baxış, nasazlıq zamanı 24 saat ərzində gəliş və ehtiyat hissələrin dəyişdirilməsi.",
  "2. Müddət. Müqavilə imzalandığı gündən 12 ay qüvvədədir.",
  "3. Dəyər və ödəniş. İllik dəyər 48 000 AZN-dir; ödəniş hər rübün əvvəlində dörd bərabər hissə ilə edilir.",
  "4. Tərəflərin öhdəlikləri. İcraçı xidməti cədvələ uyğun göstərir; Sifarişçi avadanlığa giriş təmin edir.",
].join("\n\n")

/** The draft as accepting the quote writes it, then given an end date and a text by the seller. */
export function contractsDemoDraft(today: string): ContractsDemoRow {
  const spawned = buildSpawnedContractData({
    organizationId: "demo",
    quote: { id: CONTRACTS_DEMO_QUOTE.id, quoteNumber: CONTRACTS_DEMO_QUOTE.quoteNumber, currency: CURRENCY, dealId: "deal-demo" },
    rolledTotalAmount: String(CONTRACTS_DEMO_QUOTE.total),
    dealCompanyId: "company-demo",
    createdByUserId: "user-demo",
    now: new Date(mtmDemoAt(today, "09:40")),
    locale: "az",
  })
  return {
    id: CONTRACTS_DEMO_DRAFT_ID,
    contractNumber: spawned.contractNumber!,
    title: spawned.title,
    company: { name: CONTRACTS_DEMO_QUOTE.company },
    type: spawned.type ?? "service_agreement",
    status: spawned.status ?? "draft",
    valueAmount: Number(spawned.valueAmount),
    currency: spawned.currency ?? CURRENCY,
    startDate: dateOf(today, 0),
    endDate: dateOf(today, 365),
    createdAt: mtmDemoAt(today, "09:40"),
    spawnedFromQuote: true,
  }
}

const PORTFOLIO: ReadonlyArray<{ id: string; number: string; title: string; company: string; type: string; status: string; value: number | null; start: number; end: number | null; created: number }> = [
  { id: "c-94", number: "CTR-0094", title: "Texniki xidmət — 2026", company: "Aqua Təchizat ASC", type: "maintenance", status: "active", value: 18000, start: -290, end: 75, created: -295 },
  { id: "c-88", number: "CTR-0088", title: "Proqram lisenziyası", company: "Bakı Logistika MMC", type: "license", status: "active", value: 9600, start: -345, end: 20, created: -347 },
  { id: "c-86", number: "CTR-0086", title: "Ofis avadanlığının icarəsi", company: "Abşeron Ofis MMC", type: "service_agreement", status: "active", value: 7200, start: -351, end: 14, created: -353 },
  { id: "c-91", number: "CTR-0091", title: "SLA dəstək paketi", company: "Gəncə Aqro MMC", type: "sla", status: "active", value: 24000, start: -245, end: 120, created: -250 },
  { id: "c-82", number: "CTR-0082", title: "Konsaltinq xidməti", company: "Sumqayıt Kimya MMC", type: "service_agreement", status: "active", value: 30000, start: -160, end: 200, created: -165 },
  { id: "c-79", number: "CTR-0079", title: "Xidmət müqaviləsi", company: "Şirvan Enerji ASC", type: "service_agreement", status: "active", value: 60000, start: -110, end: 250, created: -112 },
  { id: "c-85", number: "CTR-0085", title: "Məxfilik razılaşması", company: "Nar Media MMC", type: "nda", status: "active", value: null, start: -40, end: 690, created: -41 },
  { id: "c-96", number: "CTR-0096", title: "Avadanlıq xidməti", company: "Lənkəran Qida MMC", type: "maintenance", status: "pending_approval", value: 14400, start: 5, end: 370, created: -3 },
  { id: "c-97", number: "CTR-0097", title: "İllik dəstək", company: "Quba Turizm MMC", type: "service_agreement", status: "approved", value: 12000, start: 7, end: 372, created: -6 },
  { id: "c-90", number: "CTR-0090", title: "Təlim xidməti", company: "Mingəçevir Tekstil MMC", type: "other", status: "draft", value: 6000, start: 14, end: 104, created: -1 },
]

/** The company's contracts, newest first, with the quote's draft on top. */
export function contractsDemoList(today: string): ContractsDemoRow[] {
  const rows: ContractsDemoRow[] = PORTFOLIO.map((row) => ({
    id: row.id,
    contractNumber: row.number,
    title: row.title,
    company: { name: row.company },
    type: row.type,
    status: row.status,
    valueAmount: row.value,
    currency: CURRENCY,
    startDate: dateOf(today, row.start),
    endDate: row.end === null ? null : dateOf(today, row.end),
    createdAt: mtmDemoAt(addDays(today, row.created), "11:00"),
    spawnedFromQuote: false,
  }))
  return [contractsDemoDraft(today), ...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/** The list's six figures, by the page's own arithmetic. */
export function contractsDemoStats(today: string, rows: readonly ContractsDemoRow[]) {
  return contractListStats(rows, Date.parse(contractsDemoNow(today)))
}

/**
 * «Müqavilə həyat dövrü»: each live contract's renewal reminders as the
 * product schedules them when the end date is set (90/60/30/14/7 days
 * before), still pending — a reminder that came due was delivered by the
 * morning job and left the page — and the contract waiting at «Hüquq
 * yoxlaması».
 */
export function contractsDemoLifecycle(today: string) {
  const now = new Date(contractsDemoNow(today))
  const rows = contractsDemoList(today)
  const alerts: LifecycleAlertRow[] = []
  for (const row of rows) {
    if (!["active", "renewing"].includes(row.status) || !row.endDate) continue
    const planned = scheduleRenewalAlerts({ contractId: row.id, endDate: new Date(row.endDate), asOf: new Date(row.createdAt) })
    for (const alert of planned.alerts) {
      if (alert.dueAt <= now || alert.dueAt.getTime() > now.getTime() + 90 * DAY_MS) continue
      alerts.push({
        id: `${row.id}-${alert.daysBeforeExpiry}`,
        contractId: row.id,
        dueAt: alert.dueAt,
        daysBeforeExpiry: alert.daysBeforeExpiry,
        contract: { contractNumber: row.contractNumber, title: row.title, endDate: new Date(row.endDate), valueAmount: row.valueAmount, currency: row.currency, status: row.status, company: row.company },
      })
    }
  }
  alerts.sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
  const stages: LifecycleStageRow[] = rows
    .filter((row) => row.status === "pending_approval")
    .map((row) => ({
      id: `${row.id}-stage-1`,
      contractId: row.id,
      order: 1,
      label: CONTRACTS_DEMO_STAGES[0].label,
      assigneeUserId: null,
      assigneeRole: CONTRACTS_DEMO_STAGES[0].assigneeRole,
      createdAt: new Date(row.createdAt),
      contract: { contractNumber: row.contractNumber, title: row.title, valueAmount: row.valueAmount, currency: row.currency, company: row.company },
    }))
  return buildLifecycleView(alerts, stages, now)
}

/**
 * This morning's reminder in a manager's bell: the one that fell due today,
 * delivered by the morning job — and so no longer on the lifecycle page,
 * which lists the reminders still to come.
 */
export function contractsDemoBell(today: string) {
  const now = new Date(contractsDemoNow(today))
  for (const row of contractsDemoList(today)) {
    if (!["active", "renewing"].includes(row.status) || !row.endDate) continue
    const planned = scheduleRenewalAlerts({ contractId: row.id, endDate: new Date(row.endDate), asOf: new Date(row.createdAt) })
    const due = planned.alerts.find((alert) => alert.dueAt <= now && alert.dueAt.getTime() > now.getTime() - DAY_MS)
    if (!due) continue
    const text = renewalAlertText("az", {
      contractNumber: row.contractNumber,
      title: row.title,
      company: row.company.name,
      endDate: new Date(row.endDate),
      daysBeforeExpiry: due.daysBeforeExpiry,
    })
    return { ...text, type: renewalAlertType(due.daysBeforeExpiry), deliveredAt: mtmDemoAt(today, "09:05") }
  }
  return null
}
