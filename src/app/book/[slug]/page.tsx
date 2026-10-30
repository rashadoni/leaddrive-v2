"use client"

/** The public booking link: a customer picks a free time (src/components/booking/booking-scheduler.tsx). */
import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useParams } from "next/navigation"
import { CircleAlert, Loader2 } from "lucide-react"
import { ThemeProvider } from "@/components/theme-provider"
import { BookingScheduler, type BookResult, type BookingRequest, type PublicBookingPage } from "@/components/booking/booking-scheduler"
import type { DaySlots } from "@/lib/booking/availability"
import { bookingRequestIdentity, completeBookingRequest } from "@/lib/booking/client-identity"
import { collectAdAttribution } from "@/lib/ad-conversions/collect"

async function fetchBookingPage(slug: string): Promise<{ page: PublicBookingPage; days: DaySlots[] } | null> {
  const response = await fetch(`/api/v1/public/booking/${encodeURIComponent(slug)}`, { cache: "no-store" })
  if (response.status === 404) return null
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error("booking availability unavailable")
  return body.data

}

export default function PublicBookingPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const t = useTranslations("booking")
  const locale = useLocale()
  const [data, setData] = useState<{ page: PublicBookingPage; days: DaySlots[] } | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading")

  const load = useCallback(() => {
    void fetchBookingPage(slug).then((result) => {
      if (result) {
        setData(result)
        setState("ready")
      } else {
        setState("missing")
      }
    }).catch(() => setState("error"))
  }, [slug])

  useEffect(load, [load])

  async function book(request: BookingRequest): Promise<BookResult> {
    try {
      const identity = await bookingRequestIdentity(`public:${slug}`, request)
      const response = await fetch(`/api/v1/public/booking/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, ...identity, locale, attribution: collectAdAttribution() }),
      })
      const body = await response.json().catch(() => ({}))
      if (response.ok && body.success) { completeBookingRequest(`public:${slug}`); return { ok: true, booking: body.data } }
      if (body.code === "CALENDAR_UNAVAILABLE") return { ok: false, reason: "calendar" }
      if (body.code === "CONFIRMATION_EXPIRED") return { ok: false, reason: "expired" }
      if (response.status === 409 && !["IDEMPOTENCY_CONFLICT", "AVAILABILITY_CHANGED"].includes(body.code)) {
        load()
        return { ok: false, reason: "taken" }
      }
      return { ok: false, reason: response.status === 400 ? "invalid" : "error" }
    } catch {
      return { ok: false, reason: "error" }
    }
  }

  return (
    <ThemeProvider>
      <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12">
        <section className="mx-auto w-full max-w-4xl rounded-xl border bg-card p-5 shadow-sm sm:p-7" aria-labelledby="booking-title">
          {state === "loading" ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("pageLoading")}
            </div>
          ) : state === "error" ? <div role="alert" className="space-y-3 py-8 text-center"><p>{t("bookingLoadError")}</p><button type="button" className="min-h-11 rounded-lg border px-4 text-sm" onClick={() => { setState("loading"); load() }}>{t("retry")}</button></div> : state === "missing" || !data ? (
            <div className="py-6 text-center" role="alert">
              <CircleAlert className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <h1 id="booking-title" className="mt-3 text-xl font-semibold">{t("notFoundTitle")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t("notFoundDesc")}</p>
            </div>
          ) : (
            <BookingScheduler page={data.page} days={data.days} onBook={book} />
          )}
        </section>
      </main>
    </ThemeProvider>
  )
}
