/**
 * The Call Center module's invented sales team on the company's own PBX —
 * the Asterisk station production runs on (owner, 2026-10-17: «сейчас у меня
 * свой пбх»; Twilio is not used) — and only what every seller has (owner,
 * 2026-10-17: «только то, что у всех»): calls placed from a CRM card, the
 * calls the station writes to the log, the outcome of a call, and the
 * callback a customer asked for — a task for the seller, a reminder when it
 * falls due and the managers' alert 45 minutes later.
 *
 * Left out: the missed-calls queue, the browser softphone, transcripts,
 * conversation insights and every AI call. A recording stays on the
 * station's disk, never in the CRM, so the log shows none.
 *
 * Every name, company, number and minute is made up. The day is the other
 * modules' demo day (the latest Thursday), at 15:10 Baku time; the summary,
 * the promises and the alerts are worked out by the product's own rules.
 */
import { CALLBACK_TASK_TITLES } from "@/lib/calls/callback-task-titles"
import type { CallDisposition } from "@/lib/calls/disposition"
import { settleCallback, summarizeLateCallbacks } from "@/lib/commitments/late-callback-summary"
import { COMMITMENT_ALERT_TITLES, MANAGER_GRACE_MINUTES, nextEscalationStep } from "@/lib/commitments/escalation"
import type { LateCallbacksReport } from "@/components/leads/late-callbacks-panel"
import { addDays, mtmDemoAt } from "./mtm-demo-data"

export const CALLS_DEMO_CLOCK = "15:10"
/** The tenant's telephony, as the call button's service picker names it. */
export const CALLS_DEMO_PROVIDER = { id: "provider-asterisk", label: "Asterisk VoIP" } as const
/** The seller who calls from the lead card, and whose promise it becomes. */
export const CALLS_DEMO_SELLER = "Kamran Səfərov"
/** What the callback task is called for an Azerbaijani-speaking seller. */
export const CALLS_DEMO_TASK_TITLE = CALLBACK_TASK_TITLES.az
/** How long the demo call lasts once «Bitir» ends it. */
export const CALLS_DEMO_TALK_SECONDS = 167

/** The lead the seller calls from its card. */
export const CALLS_DEMO_LEAD = {
  contactName: "Fərid Hacıyev",
  companyName: "Xəzər Tikinti MMC",
  email: "farid@xezertikinti.az",
  phone: "+994 12 555 01 34",
} as const

export function callsDemoNow(today: string): string {
  return mtmDemoAt(today, CALLS_DEMO_CLOCK)
}

/** When he asks to be called back: tomorrow at 11:00. */
export function callsDemoCallbackAt(today: string): string {
  return mtmDemoAt(addDays(today, 1), "11:00")
}

export interface CallsDemoCall {
  readonly id: string
  readonly direction: "inbound" | "outbound"
  readonly fromNumber: string
  readonly toNumber: string
  readonly contactName: string | null
  readonly createdAt: string
  /** Seconds; null when nobody answered. */
  readonly duration: number | null
  readonly status: "completed" | "no-answer" | "busy"
  readonly disposition: CallDisposition | null
}

const OFFICE = "+994 12 555 00 00"
const PEOPLE: ReadonlyArray<{ name: string; phone: string }> = [
  { name: "Leyla Məmmədova", phone: "+994 12 555 02 11" },
  { name: "Elşən Rəhimov", phone: "+994 12 555 03 27" },
  { name: "Günay Əsədova", phone: "+994 12 555 04 52" },
  { name: "Ramil Qurbanov", phone: "+994 12 555 05 16" },
  { name: "Səbinə Hüseynova", phone: "+994 12 555 06 73" },
  { name: "Tofiq Babayev", phone: "+994 12 555 07 08" },
]
const PERSON = Object.fromEntries(PEOPLE.map((person) => [person.name, person]))
const OUTCOMES: ReadonlyArray<CallDisposition | null> = ["interested", null, "callback", "not_interested", null, "interested", "voicemail", null]

/**
 * The past week's promises, each made on a call and kept (or not) by a later
 * call to the same customer. Day offsets are from the demo Thursday, so every
 * call falls on a working day.
 */
const PROMISES: ReadonlyArray<{ id: string; lead: string; seller: string; madeAt: [number, string]; promisedFor: [number, string]; calledBack: [number, string] | null }> = [
  { id: "cb-1", lead: "Elşən Rəhimov", seller: "Aysel Quliyeva", madeAt: [-3, "16:20"], promisedFor: [-2, "11:00"], calledBack: [-2, "13:05"] },
  { id: "cb-2", lead: "Günay Əsədova", seller: "Murad Kərimov", madeAt: [-2, "12:10"], promisedFor: [-1, "16:00"], calledBack: null },
  { id: "cb-3", lead: "Ramil Qurbanov", seller: "Murad Kərimov", madeAt: [-6, "15:00"], promisedFor: [-3, "10:30"], calledBack: [-3, "11:15"] },
  { id: "cb-4", lead: "Leyla Məmmədova", seller: CALLS_DEMO_SELLER, madeAt: [-2, "10:00"], promisedFor: [-1, "12:00"], calledBack: [-1, "11:52"] },
  { id: "cb-5", lead: "Tofiq Babayev", seller: "Aysel Quliyeva", madeAt: [-7, "11:00"], promisedFor: [-6, "15:00"], calledBack: [-6, "14:40"] },
  { id: "cb-6", lead: "Səbinə Hüseynova", seller: CALLS_DEMO_SELLER, madeAt: [-3, "09:40"], promisedFor: [-2, "17:00"], calledBack: [-2, "16:58"] },
]

function spread(seed: string, modulo: number): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0
  return hash % modulo
}

/**
 * The last thirty days of the team's calls, newest first, as the station
 * writes them: calls placed from a card, calls to and from the office
 * line — and the callbacks of the week's promises among them.
 */
export function callsDemoLog(today: string): CallsDemoCall[] {
  const now = callsDemoNow(today)
  const calls: CallsDemoCall[] = []
  for (let back = 0; back < 30; back += 1) {
    const day = addDays(today, -back)
    const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay()
    if (weekday === 0 || weekday === 6) continue
    const count = 5 + spread(`${day}:n`, 4)
    for (let index = 0; index < count; index += 1) {
      const seed = `${day}:${index}`
      const hour = 9 + Math.floor((index * 8) / count)
      const minute = 5 + spread(`${seed}:m`, 50)
      const createdAt = mtmDemoAt(day, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)
      if (createdAt >= now) continue
      const person = PEOPLE[spread(seed, PEOPLE.length)]
      const inbound = spread(`${seed}:dir`, 5) < 2
      const missed = inbound && spread(`${seed}:miss`, 9) === 0
      const unanswered = !inbound && spread(`${seed}:na`, 7) === 0
      calls.push({
        id: `call-${seed}`,
        direction: inbound ? "inbound" : "outbound",
        fromNumber: inbound ? person.phone : OFFICE,
        toNumber: inbound ? OFFICE : person.phone,
        contactName: spread(`${seed}:known`, 6) === 0 ? null : person.name,
        createdAt,
        duration: missed || unanswered ? null : 40 + spread(`${seed}:d`, 300),
        status: missed ? "no-answer" : unanswered ? (spread(`${seed}:busy`, 2) ? "busy" : "no-answer") : "completed",
        disposition: inbound || missed || unanswered ? null : OUTCOMES[spread(`${seed}:o`, OUTCOMES.length)],
      })
    }
  }
  // A customer's call nobody picked up, half an hour ago: the log's red row.
  calls.push({
    id: "call-missed-today",
    direction: "inbound",
    fromNumber: PERSON["Tofiq Babayev"].phone,
    toNumber: OFFICE,
    contactName: "Tofiq Babayev",
    createdAt: mtmDemoAt(today, "14:38"),
    duration: null,
    status: "no-answer",
    disposition: null,
  })
  for (const promise of PROMISES) {
    const person = PERSON[promise.lead]
    calls.push({
      id: `call-${promise.id}-made`,
      direction: "outbound",
      fromNumber: OFFICE,
      toNumber: person.phone,
      contactName: person.name,
      createdAt: mtmDemoAt(addDays(today, promise.madeAt[0]), promise.madeAt[1]),
      duration: 95 + spread(`${promise.id}:made`, 120),
      status: "completed",
      disposition: "callback",
    })
    if (!promise.calledBack) continue
    calls.push({
      id: `call-${promise.id}-back`,
      direction: "outbound",
      fromNumber: OFFICE,
      toNumber: person.phone,
      contactName: person.name,
      createdAt: mtmDemoAt(addDays(today, promise.calledBack[0]), promise.calledBack[1]),
      duration: 120 + spread(`${promise.id}:back`, 180),
      status: "completed",
      disposition: "interested",
    })
  }
  return calls.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/**
 * «Zəng xülasəsi» by the call log's own rules (the calls route's summary),
 * over the same filtered calls as the list: missed is an inbound call nobody
 * answered (no answer, busy, failed); the average is over the calls that have
 * a duration.
 */
export function callsDemoSummary(calls: readonly CallsDemoCall[]) {
  const timed = calls.filter((call) => (call.duration ?? 0) > 0)
  return {
    total: calls.length,
    inbound: calls.filter((call) => call.direction === "inbound").length,
    outbound: calls.filter((call) => call.direction === "outbound").length,
    missed: calls.filter((call) => call.direction === "inbound" && ["no-answer", "busy", "failed"].includes(call.status)).length,
    averageDurationSeconds: timed.length ? Math.round(timed.reduce((sum, call) => sum + (call.duration ?? 0), 0) / timed.length) : null,
    durationSample: timed.length,
  }
}

/**
 * «Müştərilərə gecikmiş zənglər» for the last seven days: every promise
 * settled by the report's own `settleCallback` against the calls made to
 * that customer afterwards, and summed by its `summarizeLateCallbacks`.
 */
export function callsDemoLateCallbacks(today: string): LateCallbacksReport {
  const at = ([offset, hhmm]: [number, string]) => mtmDemoAt(addDays(today, offset), hhmm)
  const rows = PROMISES.map((promise) => {
    const settled = settleCallback({
      promisedFor: new Date(at(promise.promisedFor)),
      madeAt: new Date(at(promise.madeAt)),
      touches: promise.calledBack ? [new Date(at(promise.calledBack))] : [],
    })
    return {
      taskId: promise.id,
      leadName: promise.lead,
      leadPhone: PERSON[promise.lead].phone,
      sellerId: promise.seller,
      sellerName: promise.seller,
      promisedFor: at(promise.promisedFor),
      contactedAt: settled.contactedAt?.toISOString() ?? null,
      status: settled.status,
      lateByMinutes: settled.lateByMinutes,
    }
  })
  return { rows, ...summarizeLateCallbacks(rows) }
}

/**
 * Who hears about Fərid's callback if it is still open, and when — the
 * escalation job's own ladder: the seller at the promised time, the managers
 * once the grace period is over. A ticked task stops both.
 */
export function callsDemoAlerts(callbackAt: string) {
  const due = new Date(callbackAt)
  const graceOver = new Date(due.getTime() + MANAGER_GRACE_MINUTES * 60_000)
  const open = { dueDate: due, overdueNotifiedAt: null, escalatedAt: null, completedAt: null }
  return [
    { id: "assignee", type: "warning" as const, title: COMMITMENT_ALERT_TITLES.assignee, message: CALLS_DEMO_TASK_TITLE, createdAt: due.toISOString(), step: nextEscalationStep(open, due) },
    { id: "manager", type: "error" as const, title: COMMITMENT_ALERT_TITLES.manager, message: CALLS_DEMO_TASK_TITLE, createdAt: graceOver.toISOString(), step: nextEscalationStep({ ...open, overdueNotifiedAt: due }, graceOver) },
  ]
}
