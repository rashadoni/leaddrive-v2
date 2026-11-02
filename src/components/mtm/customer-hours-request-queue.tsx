"use client"

/**
 * «Часы не те?» for the people who decide (owner, 2026-11-02, mockup «MTM:
 * часы приёма клиентов»): what agents sent from the spot about places whose
 * «часы приёма» are wrong — the place's week now beside the agent's, the days
 * that differ marked — and «Принять» / «Оставить как было».
 */
import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { Clock3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { cn } from "@/lib/utils"
import { createDateFormatter } from "@/lib/format-date"
import { MTM_WEEKDAYS, type MtmWorkingHours } from "@/lib/mtm/customer-hours"
import { useDayHoursText } from "@/components/mtm/customer-hours"

type HoursRequestRow = {
  id: string
  submittedAt: string
  comment: string | null
  agent: { id: string; name: string }
  customer: { id: string; name: string; address: string | null; city: string | null }
  currentHours: MtmWorkingHours | null
  proposedHours: MtmWorkingHours | null
  hoursChangedSince: boolean
  canDecide: boolean
}

export function MtmCustomerHoursRequestQueue({ orgId, onChanged }: { orgId?: string; onChanged: () => void }) {
  // Named `t` so that the catalog gate (lib-i18n-keys.test.ts) follows every key below.
  const t = useTranslations("mtmRoutesPage")
  const days = useTranslations("mtmCustomers.hours")
  const dayText = useDayHoursText()
  const locale = useLocale()
  const [requests, setRequests] = useState<HoursRequestRow[]>([])
  const [comments, setComments] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const headers = orgId ? { "x-organization-id": orgId } : undefined
  const when = createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" })

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/mtm/customer-hours-requests", { headers, cache: "no-store" })
      const result = await response.json()
      if (!response.ok) throw new Error("load")
      setRequests(result.data?.requests ?? [])
    } catch {
      toast.error(t("hoursLoadFailed"))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, t])

  useEffect(() => { void load() }, [load])

  async function decide(request: HoursRequestRow, decision: "APPROVED" | "REJECTED") {
    if (busy) return
    if (decision === "APPROVED" && request.hoursChangedSince && !window.confirm(t("hoursConfirmChanged"))) return
    setBusy(request.id)
    try {
      const response = await fetch(`/api/v1/mtm/customer-hours-requests/${request.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify({
          decision,
          comment: decision === "REJECTED" ? comments[request.id]?.trim() || undefined : undefined,
          ...(decision === "APPROVED" && request.hoursChangedSince ? { confirmHoursChanged: true } : {}),
        }),
      })
      const result = await response.json().catch(() => null) as { code?: string } | null
      if (!response.ok) {
        if (result?.code === "MTM_HOURS_REQUEST_CUSTOMER_CHANGED") {
          setRequests((current) => current.map((row) => (row.id === request.id ? { ...row, hoursChangedSince: true } : row)))
          toast.error(t("hoursChanged"))
          return
        }
        toast.error(t("hoursDecisionFailed"))
        void load()
        onChanged()
        return
      }
      toast.success(decision === "APPROVED" ? t("hoursApproved") : t("hoursRejected"))
      setRequests((current) => current.filter((row) => row.id !== request.id))
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  if (requests.length === 0) return null
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="mtm-customer-hours-requests">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Clock3 className="h-4 w-4" />{t("hoursTitle", { count: requests.length })}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("hoursDescription")}</p>
      <div className="mt-3 grid gap-3">
        {requests.map((request) => (
          <article key={request.id} className="rounded-xl border border-border p-3" data-testid={`mtm-customer-hours-request-${request.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">{request.customer.name}</h3>
              <span className="text-xs text-muted-foreground">{t("hoursFrom", { name: request.agent.name, when: when.format(new Date(request.submittedAt)) })}</span>
            </div>
            {request.comment ? <p className="mt-1 text-sm">«{request.comment}»</p> : null}
            {request.hoursChangedSince ? (
              <p role="status" className="mt-2 rounded-md border border-l-4 border-border border-l-amber-500 bg-card p-2 text-xs">{t("hoursChanged")}</p>
            ) : null}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2 font-semibold"><span className="sr-only">{days("dialog.day")}</span></th>
                    <th className="py-1 pr-2 font-semibold">{t("hoursNow")}</th>
                    <th className="py-1 font-semibold">{t("hoursProposed")}</th>
                  </tr>
                </thead>
                <tbody>
                  {MTM_WEEKDAYS.map((day) => {
                    const now = request.currentHours ? dayText(request.currentHours[day]) : null
                    const proposed = request.proposedHours ? dayText(request.proposedHours[day]) : null
                    const differs = now !== proposed
                    return (
                      <tr key={day} className="border-t border-border">
                        <td className="py-1 pr-2 text-xs text-muted-foreground">{days(`weekdaysShort.${day}`)}</td>
                        <td className="py-1 pr-2 text-muted-foreground">{now ?? t("hoursNone")}</td>
                        <td className={cn("py-1", differs && "font-semibold text-blue-700 dark:text-blue-400")}>{proposed ?? "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {request.canDecide ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Hint text={t("hoursApproveHint")}>
                  <Button disabled={busy === request.id} onClick={() => void decide(request, "APPROVED")} data-testid={`mtm-customer-hours-approve-${request.id}`}>{t("hoursApprove")}</Button>
                </Hint>
                <input
                  aria-label={t("hoursRejectComment")}
                  placeholder={t("hoursRejectComment")}
                  value={comments[request.id] ?? ""}
                  onChange={(event) => setComments((current) => ({ ...current, [request.id]: event.target.value }))}
                  className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                />
                <Button variant="outline" disabled={busy === request.id} onClick={() => void decide(request, "REJECTED")}>{t("hoursReject")}</Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
