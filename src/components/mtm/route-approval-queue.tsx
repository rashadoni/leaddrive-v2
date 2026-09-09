"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, Check, ClipboardCheck, HelpCircle, MapPin, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/format-date"

interface RouteApprovalQueueProps {
  orgId?: string
  active: boolean
  onChanged: () => void
}

interface RouteChangeRequest {
  id: string
  changeType: "REMOVE_STOP" | "ADD_STOP" | "CONFLICT_OVERRIDE"
  payload?: { customerId?: string }
  submittedAt: string
  reason: string
  requestedByAgent?: { id: string; name: string }
  route?: { id: string; name?: string | null }
  routePoint?: { customer?: { id: string; name: string } }
  legacySnapshot?: boolean
  evidence?: {
    before: {
      route: { version: number; totalPoints: number }
      routePoint: { orderIndex: number } | null
    }
    outcomes: Array<{
      after: {
        route: { version: number; totalPoints: number }
        routePoint: { orderIndex: number } | null
      }
      rescheduled: { date: string } | null
    }>
  } | null
}

export function MtmRouteApprovalQueue({ orgId, active, onChanged }: RouteApprovalQueueProps) {
  const t = useTranslations("mtmRoutesPage")
  const locale = useLocale()
  const [requests, setRequests] = useState<RouteChangeRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!active) return
    setLoading(true)
    try {
      const response = await fetch("/api/v1/mtm/route-change-requests", {
        headers: orgId ? { "x-organization-id": orgId } : {},
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? t("decisionFailed"))
      setRequests(result.data?.requests ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("decisionFailed"))
    } finally {
      setLoading(false)
    }
  }, [active, orgId, t])

  useEffect(() => { void load() }, [load])

  async function decide(id: string, decision: "APPROVED" | "REJECTED" | "NEEDS_INFO") {
    const comment = comments[id]?.trim()
    if (decision !== "APPROVED" && !comment) return
    setBusyId(id)
    try {
      const response = await fetch(`/api/v1/mtm/route-change-requests/${id}/decision`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({ decision, comment: comment || undefined }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? t("decisionFailed"))
      setRequests((current) => current.filter((request) => request.id !== id))
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("decisionFailed"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section id="mtm-route-approval-queue" className="border-y border-zinc-200 bg-card dark:border-zinc-700">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t("approvalQueue")}</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("approvalQueueSubtitle")}</p>
      </div>

      {loading ? <div className="h-32 animate-pulse bg-muted/30" /> : null}
      {!loading && requests.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Check className="h-5 w-5" /> {t("noApprovals")}
        </div>
      ) : null}

      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {requests.map((request) => {
          const needsComment = !comments[request.id]?.trim()
          const latestOutcome = request.evidence?.outcomes.at(-1) ?? null
          return (
            <article key={request.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    {request.changeType === "REMOVE_STOP" ? t("requestRemoval") : request.changeType === "ADD_STOP" ? t("requestAddition") : request.changeType}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(new Date(request.submittedAt), locale)}</span>
                </div>
                <h3 className="mt-2 text-sm font-semibold">{request.route?.name || request.requestedByAgent?.name}</h3>
                <p className="mt-1 text-sm">{request.reason}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{request.requestedByAgent?.name}</span>
                  {request.routePoint?.customer?.name ? (
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{request.routePoint.customer.name}</span>
                  ) : null}
                </div>
                {request.evidence ? (
                  <div className="mt-3 rounded-md border border-zinc-200 bg-muted/30 p-2 text-xs dark:border-zinc-700">
                    <div className="font-medium text-foreground">{t("changeEvidenceTitle")}</div>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      <div>
                        <span className="text-muted-foreground">{t("changeEvidenceBefore")}: </span>
                        {t("changeEvidenceRouteVersion", {
                          version: request.evidence.before.route.version,
                          count: request.evidence.before.route.totalPoints,
                        })}
                        {request.evidence.before.routePoint ? ` · ${t("changeEvidencePoint", { order: request.evidence.before.routePoint.orderIndex + 1 })}` : ""}
                      </div>
                      {latestOutcome ? (
                        <div>
                          <span className="text-muted-foreground">{t("changeEvidenceAfter")}: </span>
                          {t("changeEvidenceRouteVersion", {
                            version: latestOutcome.after.route.version,
                            count: latestOutcome.after.route.totalPoints,
                          })}
                          {latestOutcome.rescheduled ? ` · ${t("changeEvidenceRescheduled", { date: latestOutcome.rescheduled.date })}` : ""}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : request.legacySnapshot ? (
                  <p className="mt-3 text-xs text-muted-foreground">{t("changeEvidenceLegacy")}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Textarea
                  value={comments[request.id] ?? ""}
                  onChange={(event) => setComments((current) => ({ ...current, [request.id]: event.target.value }))}
                  placeholder={t("decisionComment")}
                  rows={2}
                />
                <div className="grid grid-cols-3 gap-2">
                  <Button size="sm" onClick={() => decide(request.id, "APPROVED")} disabled={busyId === request.id}>
                    <Check className="mr-1 h-4 w-4" />{t("approve")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decide(request.id, "NEEDS_INFO")} disabled={busyId === request.id || needsComment}>
                    <HelpCircle className="mr-1 h-4 w-4" />{t("needsInfo")}
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => decide(request.id, "REJECTED")} disabled={busyId === request.id || needsComment}>
                    <X className="mr-1 h-4 w-4" />{t("reject")}
                  </Button>
                </div>
                {needsComment ? (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><AlertCircle className="h-3 w-3" />{t("decisionComment")}</p>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
