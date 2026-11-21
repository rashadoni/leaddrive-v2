/**
 * What the deal page says at a glance (owner, 2026-11-21: «раздел сделки
 * перегружен… раздели так, чтоб при желании детали раскрывались… но и чтоб не
 * теряло свою значимость»; the clickable prototype was approved with «Давай»).
 *
 * The page keeps one fact in one place: the tiles carry the numbers, «What to
 * do now» carries what is wrong and what the next stage asks for, the sections
 * carry the details. This module is the part of that which can be wrong —
 * which invoice is a debt, which rule of the next stage is not met, how long
 * the deal stood on each stage — and it is pure, so it is tested as it is.
 */

const DAY_MS = 86_400_000

// ── Stages ────────────────────────────────────────────────────────────────

export interface StageLike {
  name: string
  isWon?: boolean | null
  isLost?: boolean | null
}

export type StageKind = "open" | "won" | "lost"

/**
 * What a stage means, not how it is spelled: an organization names its stages
 * itself, so the flags of its pipeline decide; the spelling is the fallback for
 * a deal with no pipeline loaded.
 */
export function stageKind(stage: StageLike | undefined | null, name?: string): StageKind {
  const key = (stage?.name ?? name ?? "").toUpperCase()
  if (stage?.isLost || key === "LOST") return "lost"
  if (stage?.isWon || key === "WON") return "won"
  return "open"
}

/** «Lost» is an outcome, not a step after «Won»: it leaves the track. */
export function splitStages<T extends StageLike>(stages: readonly T[]): { track: T[]; lost: T[] } {
  return {
    track: stages.filter((stage) => stageKind(stage) !== "lost"),
    lost: stages.filter((stage) => stageKind(stage) === "lost"),
  }
}

/** The stage an open deal moves to next; none for a closed deal or the last stage. */
export function nextStage<T extends StageLike>(stages: readonly T[], current: string): T | null {
  const { track } = splitStages(stages)
  const index = track.findIndex((stage) => stage.name === current)
  if (index === -1 || stageKind(track[index]) !== "open") return null
  return track[index + 1] ?? null
}

// ── Rules of a stage ──────────────────────────────────────────────────────

export interface StageRule {
  fieldName: string
  ruleType: string
  ruleValue?: string | null
  errorMessage: string
}

/**
 * The rules of the target stage this deal does not meet — the same reading as
 * the server's (`updateDealCommand`), which stays the authority: the page only
 * says in advance what the server would refuse.
 */
export function unmetRules(deal: Record<string, unknown>, rules: readonly StageRule[], completedTasks: number): StageRule[] {
  return rules.filter((rule) => {
    const value = deal[rule.fieldName]
    switch (rule.ruleType) {
      case "required":
        return !value && value !== 0
      case "min_value":
        return typeof value === "number" && Boolean(rule.ruleValue) && value < parseFloat(String(rule.ruleValue))
      case "task_completed":
        return completedTasks === 0
      default:
        return false
    }
  })
}

// ── Invoices ──────────────────────────────────────────────────────────────

export interface InvoiceLike {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: number
  paidAmount: number
  balanceDue: number
  currency: string
  dueDate?: string | null
}

/** A draft is not yet a claim on the customer; a cancelled or refunded one no longer is. */
const NOT_BILLED = new Set(["draft", "cancelled", "refunded"])

export function billedInvoices<T extends InvoiceLike>(invoices: readonly T[]): T[] {
  return invoices.filter((invoice) => !NOT_BILLED.has(invoice.status))
}

/** Whole days past the due date; 0 while it is not due. Day borders are the viewer's. */
export function daysOverdue(invoice: InvoiceLike, now: Date): number {
  if (!(invoice.balanceDue > 0) || !invoice.dueDate) return 0
  const due = new Date(invoice.dueDate)
  if (Number.isNaN(due.getTime())) return 0
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.max(0, Math.round((today - dueDay) / DAY_MS))
}

export function isOverdue(invoice: InvoiceLike, now: Date): boolean {
  return invoice.balanceDue > 0 && (invoice.status === "overdue" || daysOverdue(invoice, now) > 0)
}

export interface PaymentSummary {
  /** Billed invoices of the deal. */
  count: number
  /** One line per currency: amounts in different currencies are never added. */
  byCurrency: Array<{ currency: string; total: number; paid: number; due: number }>
  overdueCount: number
}

export function paymentSummary(invoices: readonly InvoiceLike[], now: Date): PaymentSummary {
  const billed = billedInvoices(invoices)
  const rows = new Map<string, { currency: string; total: number; paid: number; due: number }>()
  for (const invoice of billed) {
    const row = rows.get(invoice.currency) ?? { currency: invoice.currency, total: 0, paid: 0, due: 0 }
    row.total += invoice.totalAmount
    row.paid += invoice.paidAmount
    row.due += Math.max(0, invoice.balanceDue)
    rows.set(invoice.currency, row)
  }
  return {
    count: billed.length,
    byCurrency: [...rows.values()],
    overdueCount: billed.filter((invoice) => isOverdue(invoice, now)).length,
  }
}

// ── What to do now ────────────────────────────────────────────────────────

export type NextStep =
  | { id: string; kind: "pay"; done: false; urgent: boolean; invoice: InvoiceLike; overdueDays: number }
  | { id: "paid"; kind: "paid"; done: true; urgent: false }
  | { id: "owner"; kind: "owner"; done: boolean; urgent: false }
  | { id: "contact"; kind: "contact"; done: boolean; urgent: false }
  | { id: string; kind: "rule"; done: boolean; urgent: false; rule: StageRule }

/** How many unpaid invoices get a row of their own; the rest are counted. */
export const MAX_PAY_STEPS = 3

/** A rule about one of these fields is already a step of its own. */
const OWN_STEP_FIELDS = new Set(["assignedTo", "contactId"])

export interface NextStepsInput {
  deal: Record<string, unknown> & { assignedTo?: string | null; contactId?: string | null }
  kind: StageKind
  invoices: readonly InvoiceLike[]
  /** Rules of the stage the deal moves to next; empty for a closed deal. */
  nextStageRules: readonly StageRule[]
  completedTasks: number
  now: Date
}

export interface NextSteps {
  steps: NextStep[]
  /** Unpaid invoices beyond `MAX_PAY_STEPS`. */
  morePayments: number
  done: number
  left: number
}

/**
 * The steps of a deal, in the order they are shown: money owed first (overdue
 * before the rest), then who answers for the deal and whom to talk to, then
 * what the next stage asks for. A lost deal has none: there is nothing to do
 * on it but to take it back to work.
 */
export function buildNextSteps(input: NextStepsInput): NextSteps {
  if (input.kind === "lost") return { steps: [], morePayments: 0, done: 0, left: 0 }
  const steps: NextStep[] = []

  const billed = billedInvoices(input.invoices)
  const unpaid = billed
    .filter((invoice) => invoice.balanceDue > 0)
    .sort((a, b) => daysOverdue(b, input.now) - daysOverdue(a, input.now))
  for (const invoice of unpaid.slice(0, MAX_PAY_STEPS)) {
    steps.push({
      id: `pay:${invoice.id}`,
      kind: "pay",
      done: false,
      urgent: isOverdue(invoice, input.now),
      invoice,
      overdueDays: daysOverdue(invoice, input.now),
    })
  }
  if (billed.length > 0 && unpaid.length === 0) steps.push({ id: "paid", kind: "paid", done: true, urgent: false })

  steps.push({ id: "owner", kind: "owner", done: Boolean(input.deal.assignedTo), urgent: false })
  steps.push({ id: "contact", kind: "contact", done: Boolean(input.deal.contactId), urgent: false })

  if (input.kind === "open") {
    const unmet = new Set(unmetRules(input.deal, input.nextStageRules, input.completedTasks))
    input.nextStageRules.forEach((rule, index) => {
      if (OWN_STEP_FIELDS.has(rule.fieldName)) return
      steps.push({ id: `rule:${index}`, kind: "rule", done: !unmet.has(rule), urgent: false, rule })
    })
  }

  const done = steps.filter((step) => step.done).length
  return { steps, morePayments: Math.max(0, unpaid.length - MAX_PAY_STEPS), done, left: steps.length - done }
}

// ── History of stages ─────────────────────────────────────────────────────

export interface AuditEntryLike {
  action?: string
  oldValue?: unknown
  newValue?: unknown
  createdAt: string
}

export interface StageChange {
  at: string
  from: string | null
  to: string
}

const stageOf = (value: unknown): string | null => {
  const stage = value && typeof value === "object" ? (value as { stage?: unknown }).stage : null
  return typeof stage === "string" && stage ? stage : null
}

/** The stage moves the journal recorded, oldest first. */
export function stageChanges(entries: readonly AuditEntryLike[]): StageChange[] {
  const changes: StageChange[] = []
  for (const entry of entries) {
    const to = stageOf(entry.newValue)
    const from = stageOf(entry.oldValue)
    if (!to || to === from || Number.isNaN(Date.parse(entry.createdAt))) continue
    changes.push({ at: entry.createdAt, from, to })
  }
  return changes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

export interface StageSegment {
  /** `null`: the journal does not say which stage the deal was created on. */
  stage: string | null
  from: string
  /** `null`: the deal stands here now. */
  to: string | null
  days: number
}

/**
 * How long the deal stood on each stage. With no recorded move the deal is
 * shown on its current stage since it was created — the journal knows nothing
 * else, and the page says so rather than inventing dates.
 */
export function stageSegments(createdAt: string, currentStage: string, changes: readonly StageChange[], now: Date): StageSegment[] {
  // Calendar days, as a person counts them: a clock change must not turn nine days into eight.
  const dayOf = (time: number) => { const d = new Date(time); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
  const days = (from: string, to: number) => Math.max(0, Math.round((dayOf(to) - dayOf(Date.parse(from))) / DAY_MS))
  if (changes.length === 0) return [{ stage: currentStage, from: createdAt, to: null, days: days(createdAt, now.getTime()) }]
  const segments: StageSegment[] = [{ stage: changes[0].from, from: createdAt, to: changes[0].at, days: days(createdAt, Date.parse(changes[0].at)) }]
  changes.forEach((change, index) => {
    const end = changes[index + 1]?.at ?? null
    segments.push({ stage: change.to, from: change.at, to: end, days: days(change.at, end ? Date.parse(end) : now.getTime()) })
  })
  return segments
}

// ── Planned ───────────────────────────────────────────────────────────────

/** Days from today to the day of `iso`: negative when it has passed. */
export function daysUntil(iso: string, now: Date): number {
  const date = new Date(iso)
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((day - today) / DAY_MS)
}
