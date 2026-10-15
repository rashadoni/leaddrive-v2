"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { BellRing, Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format-date"
import { mtmVisitOpenFor, mtmVisitOpenMinutes, mtmVisitReminderMessage } from "@/lib/mtm/visit-left-open"

/**
 * A visit the agent opened and did not close (src/lib/mtm/visit-left-open.ts):
 * since when and for how long, and a reminder to the agent. The office does
 * not close it for him (owner, 2026-09-25); it reminds him.
 */

/** The clock a screen reads «open for» from, moved on every minute. */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** «3 дня», «5 ч», «40 мин». */
export function useOpenForText() {
  const t = useTranslations("mtmVisitsPage")
  return (checkInAt: string, now: Date) => {
    const { unit, value } = mtmVisitOpenFor(mtmVisitOpenMinutes(checkInAt, now))
    return t(unit === "days" ? "openForDays" : unit === "hours" ? "openForHours" : "openForMinutes", { count: value })
  }
}

/** «12 окт., 21:21» on the tenant's clock. */
export function useLeftOpenSince(timezone: string) {
  const locale = useLocale()
  return (checkInAt: string) => formatDateTime(checkInAt, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone }) || "—"
}

/**
 * «Напомнить агенту»: a direct message of «Связь с командой», which the app
 * shows with a push — in the agent's language.
 */
export function RemindAgentButton({ agentId, customerName, checkInAt, timezone, orgId, testId }: {
  agentId: string
  customerName: string
  checkInAt: string
  timezone: string
  orgId?: string
  testId?: string
}) {
  const t = useTranslations("mtmVisitsPage")
  const locale = useLocale()
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle")

  const send = async () => {
    setState("sending")
    try {
      const { body, localizations } = mtmVisitReminderMessage({ customerName, checkInAt, timezone, senderLocale: locale })
      const response = await fetch("/api/v1/mtm/operations/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
        body: JSON.stringify({ type: "DIRECT", agentIds: [agentId], body, localizations }),
      })
      if (!response.ok) throw new Error()
      setState("sent")
      toast.success(t("reminded"))
    } catch {
      setState("idle")
      toast.error(t("remindFailed"))
    }
  }

  return (
    <Hint wrap={state === "sent"} text={state === "sent" ? t("hint.remindedAgent") : t("hint.remindAgent")}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid={testId}
        disabled={state !== "idle"}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); void send() }}
        className="min-h-9 shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-50 dark:border-amber-700 dark:bg-transparent dark:text-amber-200"
      >
        {state === "sending" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : state === "sent" ? <Check aria-hidden="true" /> : <BellRing aria-hidden="true" />}
        {state === "sent" ? t("reminded") : t("remindAgent")}
      </Button>
    </Hint>
  )
}
