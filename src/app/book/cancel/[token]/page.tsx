"use client"

/** The customer's cancel link from the booking confirmation. */
import { Suspense, useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useParams, useSearchParams } from "next/navigation"
import { CalendarX, CircleAlert, CreditCard, Loader2 } from "lucide-react"
import { ThemeProvider } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { BookingSummary, useBookingFormat, type PublicBookingPage } from "@/components/booking/booking-scheduler"
import { servicePriceLabel } from "@/lib/booking/service"

interface CancelView {
  /** Null unless this visit was asked for a deposit. */
  deposit: { amount: string; currency: string; status: string; payable: boolean } | null
  status: "confirmed" | "cancelled" | "completed" | "no_show"
  startsAt: string
  endsAt: string
  hostName: string
  past: boolean
  bookAgainUrl: string
  page: PublicBookingPage
}

async function fetchCancelView(token: string): Promise<CancelView | null> {
  const response = await fetch(`/api/v1/public/booking/cancel/${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null)
  const body = await response?.json().catch(() => null)
  return response?.ok && body?.success ? body.data : null
}

/**
 * `useSearchParams` below (the «did the card go through» notice) makes
 * everything under it bail out of prerendering unless a Suspense boundary
 * stands above it. The build is where that bites, and PR checks do not build
 * the app — so the boundary is here, not left to be discovered on deploy.
 */
export default function CancelBookingPage() {
  return <Suspense fallback={null}><CancelBookingView /></Suspense>
}

function CancelBookingView() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const t = useTranslations("booking")
  const [view, setView] = useState<CancelView | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(() => {
    void fetchCancelView(token).then((result) => {
      if (result) {
        setView(result)
        setState("ready")
      } else {
        setState("missing")
      }
    })
  }, [token])

  useEffect(load, [load])

  async function cancel() {
    setBusy(true)
    setError("")
    const response = await fetch(`/api/v1/public/booking/cancel/${encodeURIComponent(token)}`, { method: "POST" }).catch(() => null)
    setBusy(false)
    if (response?.ok) {
      load()
      return
    }
    setError(response?.status === 409 ? t("cancelTooLate") : t("errGeneric"))
  }

  return (
    <ThemeProvider>
      <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12">
        <section className="mx-auto w-full max-w-3xl rounded-xl border bg-card p-5 shadow-sm sm:p-7">
          {state === "loading" ? (
            <div className="flex min-h-40 items-center justify-center text-muted-foreground" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
          ) : state === "missing" || !view ? (
            <div className="py-6 text-center" role="alert">
              <CircleAlert className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <h1 className="mt-3 text-xl font-semibold">{t("notFoundTitle")}</h1>
            </div>
          ) : (
            <CancelBody view={view} token={token} busy={busy} error={error} onCancel={() => void cancel()} />
          )}
        </section>
      </main>
    </ThemeProvider>
  )
}

/**
 * The deposit, on the customer's own page.
 *
 * It is here and not only in the confirmation message because this is the
 * link they keep: «pay the deposit» has to be somewhere they can come back
 * to. The amount is never sent from the browser — the page asks the server to
 * open an order, and the server reads what this visit owes.
 */
function DepositBlock({ view, token }: { view: CancelView; token: string }) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const outcome = useSearchParams().get("deposit")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const deposit = view.deposit
  if (!deposit) return null
  const amount = servicePriceLabel({ price: deposit.amount, priceCurrency: deposit.currency }, locale) ?? deposit.amount

  async function pay() {
    setBusy(true); setError("")
    const response = await fetch(`/api/v1/public/booking/deposit/${encodeURIComponent(token)}`, { method: "POST" }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (response?.ok && body?.success && typeof body.data?.url === "string") {
      // Leaving for the bank; the button stays busy so a second press on a
      // slow connection does not open a second order.
      window.location.href = body.data.url
      return
    }
    setBusy(false)
    setError(t("depositPayUnavailable"))
  }

  if (deposit.status !== "awaiting") {
    return deposit.status === "paid"
      ? <p className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{t("depositPaidThanks")}</p>
      : null
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5">
      <p className="text-sm font-semibold">{t("depositDue", { amount })}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("depositPayHint")}</p>
      {outcome === "pending" ? <p className="mt-2 text-sm" role="status">{t("depositPaymentPending")}</p> : null}
      {outcome === "failed" ? <p className="mt-2 text-sm text-destructive" role="alert">{t("depositPaymentFailed")}</p> : null}
      {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
      {deposit.payable ? (
        <Button className="mt-3 h-auto w-full whitespace-normal py-2.5 sm:w-auto" disabled={busy} onClick={() => void pay()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}{t("depositPayNow")}
        </Button>
      ) : null}
    </div>
  )
}

function CancelBody({ view, token, busy, error, onCancel }: { view: CancelView; token: string; busy: boolean; error: string; onCancel: () => void }) {
  const t = useTranslations("booking")
  const format = useBookingFormat(view.page.timezone)
  const when = `${format.longDay(view.startsAt)}, ${format.time(view.startsAt)}–${format.time(view.endsAt)}`
  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <BookingSummary page={view.page} />
      <div className="space-y-4">
        {view.status === "confirmed" && !view.past ? <DepositBlock view={view} token={token} /> : null}
        {view.status === "cancelled" ? (
          <>
            <CalendarX className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-xl font-semibold">{t("cancelledTitle")}</h2>
            <p className="text-sm text-muted-foreground line-through">{when}</p>
            <p className="text-sm">{t("cancelledDesc")}</p>
            <Button asChild variant="outline"><a href={view.bookAgainUrl}>{t("bookAgain")}</a></Button>
          </>
        ) : view.past ? (
          <>
            <h2 className="text-xl font-semibold">{when}</h2>
            <p className="text-sm text-muted-foreground">{t("cancelTooLate")}</p>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold">{t("cancelTitle")}</h2>
            <p className="text-lg">{when}</p>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <Button variant="destructive" onClick={onCancel} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t("cancelConfirm")}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
