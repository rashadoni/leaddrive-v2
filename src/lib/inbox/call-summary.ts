/**
 * A call in the inbox, in words a manager reads: «Gedən · cavab verdi 14:47 · 14 san · bitdi».
 *
 * The call card printed the call's technical journal instead — Meta's webhook events, in English,
 * with UTC timestamps and words like `providerStatus=200` — and the bare status `completed` /
 * `failed` (owner, 2026-11-10: «и что это за информация?», then «Да, замени»). The journal stays
 * for whoever debugs a call, folded away; the card leads with this line.
 */

import { whatsappCallAuditLines } from "@/lib/whatsapp-call-audit"

type Locale = "en" | "ru" | "az"

const COPY = {
  en: { outbound: "Outgoing", inbound: "Incoming", answered: "answered {time}", seconds: "{seconds} s" },
  ru: { outbound: "Исходящий", inbound: "Входящий", answered: "ответил в {time}", seconds: "{seconds} с" },
  az: { outbound: "Gedən", inbound: "Gələn", answered: "cavab verdi {time}", seconds: "{seconds} san" },
} as const

const STATUS: Record<Locale, Record<string, string>> = {
  en: {
    initiated: "calling", ringing: "ringing", "in-progress": "in progress", completed: "ended",
    failed: "did not connect", "no-answer": "no answer", busy: "busy", missed: "missed",
    canceled: "cancelled", cancelled: "cancelled",
  },
  ru: {
    initiated: "набор", ringing: "звонит", "in-progress": "идёт", completed: "завершён",
    failed: "не состоялся", "no-answer": "без ответа", busy: "занято", missed: "пропущен",
    canceled: "отменён", cancelled: "отменён",
  },
  az: {
    initiated: "yığılır", ringing: "zəng çalır", "in-progress": "davam edir", completed: "bitdi",
    failed: "baş tutmadı", "no-answer": "cavabsız", busy: "məşğul", missed: "buraxılıb",
    canceled: "ləğv edildi", cancelled: "ləğv edildi",
  },
}

function localeOf(locale: string): Locale {
  return locale === "ru" || locale === "az" ? locale : "en"
}

/** The call's status in the reader's language; an unknown one stays as the provider wrote it. */
export function callStatusWord(status: string | null | undefined, locale: string): string {
  const raw = (status ?? "").trim()
  return STATUS[localeOf(locale)][raw.toLowerCase()] ?? raw
}

const AUDIT_LINE = /^\[WhatsApp Calling\] (\S+) (.*)$/

/**
 * When the customer picked up, read from the call's own journal: Meta's `ACCEPTED` status. Nothing
 * else in the call row records it — `startedAt` is when we asked Meta to ring.
 */
export function whatsappCallAnsweredAt(notes: string | null | undefined): Date | null {
  for (const line of whatsappCallAuditLines(notes)) {
    const match = AUDIT_LINE.exec(line)
    if (!match) continue
    if (!/raw=ACCEPTED\b/.test(match[2])) continue
    const at = new Date(match[1])
    if (Number.isFinite(at.getTime())) return at
  }
  return null
}

export type CallSummaryInput = {
  direction: string
  status: string
  duration?: number | null
  provider?: string | null
  notes?: string | null
}

/** «Gedən · cavab verdi 14:47 · 14 san · bitdi» — time in the reader's own clock, as `formatTime` gives it. */
export function callSummaryLine(
  call: CallSummaryInput,
  locale: string,
  formatTime: (at: Date) => string,
  options: { withDirection?: boolean } = {},
): string {
  const copy = COPY[localeOf(locale)]
  const parts: string[] = options.withDirection === false ? [] : [call.direction === "inbound" ? copy.inbound : copy.outbound]
  const answeredAt = call.provider === "whatsapp" ? whatsappCallAnsweredAt(call.notes) : null
  if (answeredAt) parts.push(copy.answered.replace("{time}", formatTime(answeredAt)))
  if (typeof call.duration === "number" && call.duration > 0) parts.push(copy.seconds.replace("{seconds}", String(call.duration)))
  const status = callStatusWord(call.status, locale)
  if (status) parts.push(status)
  return parts.join(" · ")
}
