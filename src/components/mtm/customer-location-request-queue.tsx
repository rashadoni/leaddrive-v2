"use client"

import { Hint, HintValue } from "@/components/hint"
import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Check, Clock3, Loader2, MapPin, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { createDateFormatter } from "@/lib/format-date"

type Point = { latitude: number; longitude: number }

export type CustomerLocationRequestRow = {
  id: string
  status: string
  submittedAt: string
  comment: string | null
  agent: { id: string; name: string }
  customer: { id: string; name: string; address: string | null; city: string | null }
  previous: Point | null
  proposed: Point
  agentFix: Point & { accuracyMeters: number; at: string }
  movedMeters: number | null
  agentToProposedMeters: number
  /** Visits the agent has already checked in from the place he reported. */
  visits?: Array<{ id: string; checkInAt: string }>
  pinMovedSince: boolean
  outOfZoneAlerts: number
  canDecide: boolean
}

const RequestMap = dynamic(() => import("./customer-location-request-map"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-muted/60" />,
})

interface CustomerLocationRequestQueueProps {
  active: boolean
  orgId?: string
  onChanged: () => void
}

/**
 * «Клиент здесь», the manager's side: what agents sent from the spot about
 * customers whose pin is in the wrong place. Each request is one card — the
 * map with where the pin stands and where the agent says the customer is,
 * what the agent's phone knew, and two worded buttons: accept the new place
 * or leave the old one. Accepting moves the customer's pin; nothing else on
 * the customer changes.
 *
 * A pin that somebody moved after the agent asked cannot be accepted (the
 * server refuses it): the card says so and leaves «Оставить как было».
 */
export function MtmCustomerLocationRequestQueue({ active, orgId, onChanged }: CustomerLocationRequestQueueProps) {
  // Named `t` so that the catalog gate (lib-i18n-keys.test.ts) follows every key below.
  const t = useTranslations("mtmRoutesPage")
  const locale = useLocale()
  const [requests, setRequests] = useState<CustomerLocationRequestRow[]>([])
  const [evidenceDays, setEvidenceDays] = useState(90)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<{ id: string; decision: "APPROVED" | "REJECTED" } | null>(null)

  const load = useCallback(async () => {
    if (!active) return
    setLoading(true)
    try {
      const response = await fetch("/api/v1/mtm/customer-location-requests", { headers: orgId ? { "x-organization-id": orgId } : {}, cache: "no-store" })
      const result = await response.json()
      if (!response.ok) throw new Error(t("locationLoadFailed"))
      setRequests(result.data?.requests ?? [])
      if (typeof result.data?.outOfZoneEvidenceDays === "number") setEvidenceDays(result.data.outOfZoneEvidenceDays)
    } catch {
      toast.error(t("locationLoadFailed"))
    } finally {
      setLoading(false)
    }
  }, [active, orgId, t])

  useEffect(() => { void load() }, [load])

  // «Подтвердить» on a request whose pin was moved after the agent asked: one
  // question first, then the answer is sent as confirmed over that change.
  const [confirmMoved, setConfirmMoved] = useState<CustomerLocationRequestRow | null>(null)

  async function decide(request: CustomerLocationRequestRow, decision: "APPROVED" | "REJECTED", confirmPinMoved = false) {
    if (busy) return
    if (decision === "APPROVED" && request.pinMovedSince && !confirmPinMoved) {
      setConfirmMoved(request)
      return
    }
    setBusy({ id: request.id, decision })
    try {
      const response = await fetch(`/api/v1/mtm/customer-location-requests/${request.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
        body: JSON.stringify({
          decision,
          comment: decision === "REJECTED" ? comments[request.id]?.trim() || undefined : undefined,
          ...(confirmPinMoved ? { confirmPinMoved: true } : {}),
        }),
      })
      const result = await response.json().catch(() => null) as { code?: string } | null
      if (!response.ok) {
        // Somebody moved the pin while the card was open: the card says so from now on.
        if (result?.code === "MTM_LOCATION_REQUEST_CUSTOMER_MOVED") {
          setRequests((current) => current.map((row) => (row.id === request.id ? { ...row, pinMovedSince: true } : row)))
          toast.error(t("locationPinMoved"))
          return
        }
        // Answered meanwhile by a colleague: it is no longer waiting.
        if (result?.code === "APPROVAL_ALREADY_DECIDED" || result?.code === "APPROVAL_CONFLICT") {
          toast.error(t("locationAlreadyDecided"))
          void load()
          onChanged()
          return
        }
        throw new Error("decision failed")
      }
      setRequests((current) => current.filter((row) => row.id !== request.id))
      toast.success(t(decision === "APPROVED" ? "locationAccepted" : "locationRejected"))
      onChanged()
    } catch {
      toast.error(t("decisionFailed"))
    } finally {
      setBusy(null)
    }
  }

  const distance = (meters: number) => (meters >= 1000
    ? t("locationKilometers", { km: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000) })
    : t("locationMeters", { meters }))
  const when = createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" })
  const clock = createDateFormatter(locale, { timeStyle: "short" })

  if (!loading && requests.length === 0) return null

  return (
    <section id="mtm-customer-location-queue" className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700" aria-labelledby="customer-location-heading" data-testid="mtm-customer-location-queue">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:px-5">
        <h2 id="customer-location-heading" className="flex items-center gap-2 text-base font-semibold">
          <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("locationQueueTitle")}
        </h2>
        {!loading && requests.length > 0 ? <span className="text-sm font-medium text-muted-foreground">· {t("pendingApprovalsCount", { count: requests.length })}</span> : null}
      </header>

      {loading ? (
        <div className="p-4 sm:p-5" aria-label={t("locationLoading")}>
          <div className="h-64 animate-pulse rounded-lg bg-muted/60" />
        </div>
      ) : null}

      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {requests.map((request) => {
          const deciding = busy?.id === request.id ? busy.decision : null
          const facts: Array<[string, string]> = [
            // A customer that had no pin: nothing «moves», it gets its first one.
            request.movedMeters === null
              ? [t("locationFactPinBefore"), t("locationNoPinBefore")]
              : [t("locationFactMoved"), distance(request.movedMeters)],
            [t("locationFactAccuracy"), t("locationAccuracyValue", { meters: request.agentFix.accuracyMeters })],
            [t("locationFactAgentDistance"), request.agentToProposedMeters <= 5 ? t("locationAgentOnPoint") : distance(request.agentToProposedMeters)],
            [t("locationFactOutOfZone", { days: evidenceDays }), request.outOfZoneAlerts > 0 ? String(request.outOfZoneAlerts) : t("locationOutOfZoneNone")],
          ]
          return (
            <article key={request.id} className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2" data-testid={`mtm-customer-location-request-${request.id}`}>
              <div className="relative isolate h-64 overflow-hidden rounded-lg border border-zinc-200 bg-muted dark:border-zinc-700 xl:h-full xl:min-h-72">
                <RequestMap
                  previous={request.previous}
                  proposed={request.proposed}
                  agentFix={request.agentFix}
                  labels={{ previous: t("locationMapPrevious"), proposed: t("locationMapProposed") }}
                />
              </div>

              <div className="flex min-w-0 flex-col gap-3">
                <div>
                  <h3 className="text-lg font-semibold leading-tight text-balance" data-testid="mtm-customer-location-headline">
                    {request.previous
                      ? t("locationHeadline", { customer: request.customer.name })
                      : t("locationHeadlineNoPin", { customer: request.customer.name })}
                  </h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("locationSentBy", { agent: request.agent.name, when: when.format(new Date(request.submittedAt)) })}
                  </p>
                  {request.customer.address || request.customer.city ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("locationAddress", { address: [request.customer.address, request.customer.city].filter(Boolean).join(", ") })}
                    </p>
                  ) : null}
                </div>

                <dl className="grid grid-cols-2 gap-2">
                  {facts.map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-zinc-200 bg-card px-3 py-2 dark:border-zinc-700">
                      <dt className="text-[11px] text-muted-foreground"><HintValue text={t("hint.locationFacts")}>{label}</HintValue></dt>
                      <dd className="text-sm font-semibold text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>

                {request.comment ? (
                  <p className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                    <span className="block text-[11px] text-muted-foreground">{t("locationAgentComment")}</span>
                    {request.comment}
                  </p>
                ) : null}

                {/* «Адрес на проверке»: he was let in from this place, and the visit waits for this answer too. */}
                {request.visits && request.visits.length > 0 ? (
                  <p className="rounded-lg border border-l-4 border-zinc-200 border-l-amber-500 bg-card px-3 py-2 text-sm text-foreground dark:border-zinc-700 dark:border-l-amber-500" data-testid="mtm-customer-location-visits">
                    {t("locationVisitsNote", { count: request.visits.length, time: clock.format(new Date(request.visits[0].checkInAt)) })}
                  </p>
                ) : null}

                {request.pinMovedSince ? (
                  <p role="status" className="flex items-start gap-2 rounded-lg border border-l-4 border-zinc-200 border-l-amber-500 bg-card px-3 py-2 text-sm text-foreground dark:border-zinc-700 dark:border-l-amber-500" data-testid="mtm-customer-location-pin-moved">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {t("locationPinMoved")}
                  </p>
                ) : null}

                {request.canDecide ? (
                  <div className="mt-auto space-y-2">
                    <Textarea
                      value={comments[request.id] ?? ""}
                      onChange={(event) => setComments((current) => ({ ...current, [request.id]: event.target.value }))}
                      placeholder={t("locationRejectComment")}
                      aria-label={t("locationRejectComment")}
                      maxLength={500}
                      rows={2}
                    />
                    {/* Owner, 2026-10-16: «тут должно быть либо подтверждаю, либо
                        отклоняю» — both, always; a moved pin asks once more. */}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Hint wrap text={t(request.pinMovedSince ? "hint.locationAcceptMoved" : "hint.locationAccept")}>
                          <Button
                            type="button"
                            onClick={() => { void decide(request, "APPROVED") }}
                            disabled={busy != null}
                            data-testid={`mtm-customer-location-accept-${request.id}`}
                          >
                            {deciding === "APPROVED" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
                            {t("locationAccept")}
                          </Button>
                        </Hint>
                      <Hint wrap text={t("hint.locationReject")}>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => { void decide(request, "REJECTED") }}
                          disabled={busy != null}
                          data-testid={`mtm-customer-location-reject-${request.id}`}
                        >
                          {deciding === "REJECTED" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="mr-2 h-4 w-4" aria-hidden="true" />}
                          {t("locationReject")}
                        </Button>
                      </Hint>
                    </div>
                  </div>
                ) : (
                  <p className="mt-auto text-sm text-muted-foreground" data-testid="mtm-customer-location-cannot-decide">{t("locationCannotDecide")}</p>
                )}
              </div>
            </article>
          )
        })}
      </div>
      <ConfirmDialog
        open={confirmMoved != null}
        onOpenChange={(open) => { if (!open) setConfirmMoved(null) }}
        onConfirm={async () => {
          const request = confirmMoved
          setConfirmMoved(null)
          if (request) await decide(request, "APPROVED", true)
        }}
        title={t("locationMovedConfirmTitle")}
        description={t("locationMovedConfirmBody")}
        confirmLabel={t("locationMovedConfirm")}
        confirmVariant="default"
        icon={<AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />}
      />
    </section>
  )
}
