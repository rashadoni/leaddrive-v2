"use client"

import type { ComponentProps } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { ArrowRight, CheckCircle2, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format-date"

export type TicketClosureStatus = "pending" | "confirmed" | "rejected" | "expired" | "canceled"

export type TicketClosureRequest = {
  id: string
  status: TicketClosureStatus
  dueAt: string
  ticket: {
    ticketNumber: string | null
    subject: string
    status: string
  }
}

/**
 * The customer's answer to «is it solved?» — what the link in the resolve
 * message opens (src/app/ticket-closure/[token]/page.tsx loads and saves it).
 * Props in, the choice out: the guided demo's Service Desk shows the same
 * view on the customer's side.
 */
export function TicketClosureRequestView({
  request,
  submitting,
  message,
  error,
  onSubmit,
  confirmButtonProps,
  timeZone,
}: {
  request: TicketClosureRequest
  submitting: "confirm" | "reject" | null
  message: string
  error: string
  onSubmit: (action: "confirm" | "reject") => void
  /** Extra attributes for «Müraciəti bağla» — the demo points its guide at it. */
  confirmButtonProps?: Partial<ComponentProps<typeof Button>> & Record<`data-${string}`, string | undefined>
  /** The clock to show the auto-close time on; the page leaves it to the customer's own. */
  timeZone?: string
}) {
  const t = useTranslations("portal")
  const locale = useLocale()
  const isPending = request.status === "pending"
  const statusLabel = t(`closureStatus.${request.status}`)

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-muted-foreground">{request.ticket.ticketNumber || t("ticketFallback")}</p>
        <h1 id="closure-title" className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{t("closureTitle")}</h1>
        <p className="mt-2 max-w-[65ch] text-sm leading-6 text-muted-foreground">{request.ticket.subject}</p>
      </header>

      <dl className="divide-y rounded-md border text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <dt className="text-muted-foreground">{t("closureRequestStatus")}</dt>
          <dd className="font-medium">{statusLabel}</dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <dt className="text-muted-foreground">{t("closureAutoClose")}</dt>
          <dd className="font-medium"><time dateTime={request.dueAt}>{formatDateTime(request.dueAt, locale, { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) })}</time></dd>
        </div>
      </dl>

      {message && <p data-testid="ticket-closure-success" className="rounded-md border px-3 py-2.5 text-sm" role="status" aria-live="polite">{message}</p>}
      {error && <p data-testid="ticket-closure-save-error" className="rounded-md border px-3 py-2.5 text-sm" role="alert">{error}</p>}

      {isPending ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button data-testid="ticket-closure-confirm" className="min-h-11 sm:flex-1" onClick={() => onSubmit("confirm")} disabled={Boolean(submitting)} {...confirmButtonProps}>
            {submitting === "confirm" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            {t("closureConfirm")}
          </Button>
          <Button data-testid="ticket-closure-reject" variant="outline" className="min-h-11 sm:flex-1" onClick={() => onSubmit("reject")} disabled={Boolean(submitting)}>
            {submitting === "reject" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
            {t("closureReject")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p data-testid="ticket-closure-outcome" className="text-sm leading-6 text-muted-foreground" role="status">{t(`closureOutcome.${request.status}`)}</p>
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/portal/login" data-testid="ticket-closure-portal-link">
              {t("closureReturnToPortal")}<ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
