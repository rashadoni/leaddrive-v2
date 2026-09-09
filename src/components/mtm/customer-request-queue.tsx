"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Hash,
  Loader2,
  MapPin,
  Phone,
  Route,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { createDateFormatter } from "@/lib/format-date"

type Candidate = {
  id: string
  name: string
  code?: string | null
  phone?: string | null
  exact: boolean
  score: number
  reasons: string[]
}

type CustomerRequest = {
  id: string
  name: string
  objectType: string
  externalCode?: string | null
  phone?: string | null
  address?: string | null
  reason: string
  agentComment?: string | null
  submittedAt: string
  requestedByAgent?: { id: string; name: string }
  route?: { id: string; name?: string | null; status: string } | null
  duplicateCandidates?: Candidate[]
}

interface CustomerRequestQueueProps {
  active: boolean
  orgId?: string
  onChanged: () => void
}

function ValueLine({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm text-foreground">{value}</dd>
      </div>
    </div>
  )
}

export function MtmCustomerRequestQueue({ active, orgId, onChanged }: CustomerRequestQueueProps) {
  const t = useTranslations("mtmRoutesPage")
  const statusT = useTranslations("mtmStatus")
  const locale = useLocale()
  const [requests, setRequests] = useState<CustomerRequest[]>([])
  const [comments, setComments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!active) return
    setLoading(true)
    try {
      const response = await fetch("/api/v1/mtm/customer-create-requests", { headers: orgId ? { "x-organization-id": orgId } : {} })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? t("customerRequestLoadFailed"))
      setRequests(result.data?.requests ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("customerRequestLoadFailed"))
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
      const response = await fetch(`/api/v1/mtm/customer-create-requests/${id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
        body: JSON.stringify({ decision, comment: comment || undefined }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? t("decisionFailed"))
      setRequests((current) => current.filter((request) => request.id !== id))
      setComments((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      toast.success(t(`customerDecisionSaved.${decision}`))
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("decisionFailed"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section id="mtm-customer-approval-queue" className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700" aria-labelledby="customer-approval-heading">
      <header className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="customer-approval-heading" className="flex items-center gap-2 text-base font-semibold">
              <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("customerApprovalQueue")}
            </h2>
            {!loading && requests.length > 0 ? <Badge variant="warning">{t("pendingApprovalsCount", { count: requests.length })}</Badge> : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("customerApprovalQueueSubtitleFriendly")}</p>
        </div>
      </header>

      {loading ? (
        <div className="space-y-3 p-4 sm:p-5" aria-label={t("customerApprovalsLoading")}>
          {[0, 1].map((item) => <div key={item} className="h-44 animate-pulse rounded-lg bg-muted/60" />)}
        </div>
      ) : null}

      {!loading && requests.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="text-sm font-semibold">{t("noCustomerApprovalsTitle")}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("noCustomerApprovalsDescription")}</p>
        </div>
      ) : null}

      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {requests.map((request) => {
          const candidates = request.duplicateCandidates ?? []
          const exact = candidates.filter((candidate) => candidate.exact)
          const blocked = exact.length > 0
          const comment = comments[request.id] ?? ""
          const busy = busyId === request.id
          return (
            <article key={request.id} className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-5 p-4 sm:p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t(`customerType.${request.objectType}`)}</Badge>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.submittedAt))}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold leading-tight text-balance">{request.name}</h3>
                </div>

                <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <ValueLine icon={UserRound} label={t("requestedBy")} value={request.requestedByAgent?.name} />
                  <ValueLine icon={Hash} label={t("externalCode")} value={request.externalCode} />
                  <ValueLine icon={Phone} label={t("phone")} value={request.phone} />
                  <ValueLine icon={MapPin} label={t("address")} value={request.address} />
                  <ValueLine icon={Route} label={t("linkedRoute")} value={request.route ? `${request.route.name || request.route.id} · ${mtmStatusLabel(statusT, "route", request.route.status)}` : null} />
                </dl>

                <div className="rounded-lg bg-muted/45 px-3.5 py-3">
                  <p className="text-xs font-medium text-muted-foreground">{t("requestReasonLabel")}</p>
                  <p className="mt-1 text-sm leading-relaxed">{request.reason}</p>
                  {request.agentComment ? <p className="mt-2 border-t border-zinc-200 pt-2 text-sm text-muted-foreground dark:border-zinc-700">{request.agentComment}</p> : null}
                </div>

                {candidates.length > 0 ? (
                  <section className={`rounded-lg border p-3.5 ${blocked ? "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20" : "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"}`} aria-label={t("duplicateCheckTitle")}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${blocked ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>
                        {blocked ? <ShieldAlert className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                      </span>
                      <div>
                        <h4 className="text-sm font-semibold">{blocked ? t("exactDuplicateTitle") : t("possibleDuplicateTitle")}</h4>
                        <p className="mt-0.5 text-sm text-muted-foreground">{blocked ? t("exactDuplicateDescription") : t("possibleDuplicateDescription")}</p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {candidates.map((candidate) => (
                        <div key={candidate.id} className="rounded-lg bg-card px-3 py-3 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium text-muted-foreground">{t("existingCustomer")}</p>
                              <p className="truncate text-sm font-semibold">{candidate.name}</p>
                            </div>
                            <Badge variant={candidate.exact ? "destructive" : "warning"}>{t("matchScore", { score: candidate.score })}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {candidate.code ? <span className="flex items-center gap-1"><Hash className="h-3 w-3" aria-hidden="true" />{candidate.code}</span> : null}
                            {candidate.phone ? <span className="flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden="true" />{candidate.phone}</span> : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground">{t("matchesBy")}</span>
                            {candidate.reasons.map((reason) => <Badge key={reason} variant="outline" className="bg-card text-[11px]">{t(`duplicateReason.${reason}`)}</Badge>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {t("noDuplicateCandidates")}
                  </div>
                )}
              </div>

              <aside className="border-t border-zinc-200 bg-muted/25 p-4 dark:border-zinc-700 xl:border-l xl:border-t-0 xl:p-5" aria-label={t("decisionTitle")}>
                <div className="xl:sticky xl:top-4">
                  <div className="flex items-center gap-2">
                    <CircleHelp className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h4 className="text-sm font-semibold">{t("decisionTitle")}</h4>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{blocked ? t("decisionBlockedHint") : t("decisionHint")}</p>

                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={`customer-decision-${request.id}`}>{t("decisionCommentLabel")}</Label>
                      <span className="text-[11px] text-muted-foreground">{t("decisionCommentRequirement")}</span>
                    </div>
                    <Textarea
                      id={`customer-decision-${request.id}`}
                      value={comment}
                      onChange={(event) => setComments((current) => ({ ...current, [request.id]: event.target.value }))}
                      placeholder={t("decisionCommentPlaceholder")}
                      rows={4}
                      className="mt-1.5 resize-y bg-card"
                      disabled={busy}
                    />
                  </div>

                  <div className="mt-4 space-y-2" aria-live="polite">
                    <Button className="w-full" onClick={() => decide(request.id, "APPROVED")} disabled={busy || blocked}>
                      {busy ? <Loader2 className="animate-spin" /> : <Check />}
                      {t("approveCreateCustomer")}
                    </Button>
                    <Button className="w-full justify-between" variant="outline" onClick={() => decide(request.id, "NEEDS_INFO")} disabled={busy || !comment.trim()}>
                      <span className="flex items-center gap-2"><CircleHelp />{t("requestCustomerDetails")}</span>
                      <ArrowRight />
                    </Button>
                    <Button className="w-full justify-between text-destructive hover:text-destructive" variant="outline" onClick={() => decide(request.id, "REJECTED")} disabled={busy || !comment.trim()}>
                      <span className="flex items-center gap-2"><X />{t("rejectCustomerRequest")}</span>
                      <ArrowRight />
                    </Button>
                  </div>
                </div>
              </aside>
            </article>
          )
        })}
      </div>
    </section>
  )
}
