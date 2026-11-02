"use client"

/** The customer's cancel link from the booking confirmation. */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useParams } from "next/navigation"
import { CalendarX, CircleAlert, Loader2 } from "lucide-react"
import { ThemeProvider } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { BookingSummary, useBookingFormat, type PublicBookingPage } from "@/components/booking/booking-scheduler"

interface CancelView {
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

export default function CancelBookingPage() {
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
            <CancelBody view={view} busy={busy} error={error} onCancel={() => void cancel()} />
          )}
        </section>
      </main>
    </ThemeProvider>
  )
}

function CancelBody({ view, busy, error, onCancel }: { view: CancelView; busy: boolean; error: string; onCancel: () => void }) {
  const t = useTranslations("booking")
  const format = useBookingFormat(view.page.timezone)
  const when = `${format.longDay(view.startsAt)}, ${format.time(view.startsAt)}–${format.time(view.endsAt)}`
  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <BookingSummary page={view.page} />
      <div className="space-y-4">
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
