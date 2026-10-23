"use client"

/**
 * The invoice a customer opens from its link — e-mail, WhatsApp, or the
 * reminder chain's `{{invoice_pdf_url}}`. Shows what is owed and, when the
 * seller takes card payments, a button to the bank's payment page.
 *
 * After the bank, the customer lands back here with `?payment=paid|failed|pending`
 * (set by /api/v1/public/invoices/[token]/kapital-return after it has asked
 * the bank itself).
 */
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useParams, useSearchParams } from "next/navigation"
import { CheckCircle2, CircleAlert, Clock, CreditCard, Loader2, Lock, RefreshCw, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PublicInvoice {
  sellerName: string
  invoiceNumber: string
  title: string
  status: string
  issueDate: string
  dueDate: string | null
  paidAt: string | null
  recipientName: string | null
  currency: string
  subtotal: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
  paidAmount: number
  balanceDue: number
  items: { name: string; description: string | null; quantity: number; unitPrice: number; total: number }[]
  onlinePayment: { available: true; amount: number; currency: string } | { available: false; reason: string }
}

const INTL_LOCALE: Record<string, string> = { az: "az-AZ", ru: "ru-RU", en: "en-US" }

export default function PublicInvoicePage() {
  return (
    <Suspense fallback={null}>
      <PublicInvoice />
    </Suspense>
  )
}

function PublicInvoice() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const search = useSearchParams()
  const returned = search.get("payment")
  const t = useTranslations("onlinePayment")
  const locale = INTL_LOCALE[useLocale()] ?? "az-AZ"
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/v1/public/invoices/${encodeURIComponent(token)}`, { cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) {
        setMissing(true)
        return
      }
      setMissing(false)
      setInvoice(body.data)
    } catch {
      setMissing(true)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function pay() {
    if (paying) return
    setPaying(true)
    setPayError("")
    try {
      const response = await fetch(`/api/v1/public/invoices/${encodeURIComponent(token)}/checkout`, { method: "POST" })
      const body = await response.json().catch(() => ({}))
      if (response.ok && body.success && typeof body.data?.url === "string") {
        window.location.assign(body.data.url)
        return
      }
      setPayError(response.status === 502 ? t("bankError") : t("noOnlinePayment"))
      setPaying(false)
      void load()
    } catch {
      setPayError(t("bankError"))
      setPaying(false)
    }
  }

  const money = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const date = (value: string | null) => (value ? new Date(value).toLocaleDateString(locale) : "—")

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12">
      <section className="mx-auto w-full max-w-xl rounded-xl border bg-card p-5 shadow-sm sm:p-7" aria-labelledby="invoice-title">
        {loading && !invoice ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" aria-busy="true">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t("pageLoading")}
          </div>
        ) : missing || !invoice ? (
          <div className="py-6 text-center" role="alert">
            <CircleAlert className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <h1 id="invoice-title" className="mt-3 text-xl font-semibold">{t("notFoundTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("notFoundDesc")}</p>
          </div>
        ) : (
          <InvoiceBody
            invoice={invoice}
            returned={returned}
            paying={paying}
            payError={payError}
            money={money}
            date={date}
            onPay={() => void pay()}
            onRefresh={() => void load()}
          />
        )}
      </section>
    </main>
  )
}

function InvoiceBody({
  invoice, returned, paying, payError, money, date, onPay, onRefresh,
}: {
  invoice: PublicInvoice
  returned: string | null
  paying: boolean
  payError: string
  money: (value: number) => string
  date: (value: string | null) => string
  onPay: () => void
  onRefresh: () => void
}) {
  const t = useTranslations("onlinePayment")
  const isPaid = invoice.status === "paid" || invoice.balanceDue <= 0
  const isCancelled = invoice.status === "cancelled" || invoice.status === "refunded"

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{invoice.sellerName}</p>
        <h1 id="invoice-title" className="text-2xl font-bold tracking-tight">{t("invoiceNumber", { number: invoice.invoiceNumber })}</h1>
        {invoice.title ? <p className="text-sm text-muted-foreground">{invoice.title}</p> : null}
      </header>

      {/* A paid invoice says so in its own block below; these are for the rest. */}
      {returned === "failed" && !isPaid ? (
        <Notice tone="error" icon={<XCircle className="h-5 w-5" aria-hidden="true" />}>{t("paymentFailed")}</Notice>
      ) : (returned === "pending" || returned === "paid") && !isPaid ? (
        <Notice tone="warning" icon={<Clock className="h-5 w-5" aria-hidden="true" />}>
          <span>{t("paymentPending")}</span>
          <Button variant="outline" size="sm" className="mt-2" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />{t("refresh")}
          </Button>
        </Notice>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        {invoice.recipientName ? (
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-muted-foreground">{t("billedTo")}</dt>
            <dd className="font-medium">{invoice.recipientName}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground">{t("issueDate")}</dt>
          <dd className="font-medium">{date(invoice.issueDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("dueDate")}</dt>
          <dd className="font-medium">{date(invoice.dueDate)}</dd>
        </div>
      </dl>

      {invoice.items.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">{t("colItem")}</th>
              <th className="py-2 text-right font-medium">{t("colQty")}</th>
              <th className="py-2 text-right font-medium">{t("colAmount")}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, index) => (
              <tr key={index} className="border-b last:border-0 align-top">
                <td className="py-2 pr-3">
                  <div className="font-medium">{item.name}</div>
                  {item.description ? <div className="text-xs text-muted-foreground">{item.description}</div> : null}
                </td>
                <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                <td className="py-2 text-right tabular-nums">{money(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <dl className="space-y-1.5 text-sm">
        {invoice.discountAmount > 0 ? <Row label={t("discount")} value={`−${money(invoice.discountAmount)}`} /> : null}
        {invoice.taxAmount > 0 ? <Row label={t("tax")} value={money(invoice.taxAmount)} /> : null}
        <Row label={t("total")} value={`${money(invoice.totalAmount)} ${invoice.currency}`} strong />
        {invoice.paidAmount > 0 ? <Row label={t("paid")} value={`${money(invoice.paidAmount)} ${invoice.currency}`} /> : null}
      </dl>

      {isCancelled ? (
        <Notice tone="neutral" icon={<CircleAlert className="h-5 w-5" aria-hidden="true" />}>{t("cancelledTitle")}</Notice>
      ) : isPaid ? (
        <div className="rounded-lg border border-emerald-200 p-4 text-center dark:border-emerald-900">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" aria-hidden="true" />
          <p className="mt-2 text-lg font-semibold">{t("paidTitle")}</p>
          {invoice.paidAt ? <p className="text-sm text-muted-foreground">{t("paidOn", { date: date(invoice.paidAt) })}</p> : null}
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted-foreground">{t("balanceDue")}</span>
            <span className="text-2xl font-bold tabular-nums">{money(invoice.balanceDue)} {invoice.currency}</span>
          </div>
          {invoice.onlinePayment.available ? (
            <>
              <Button className="min-h-12 w-full text-base" onClick={onPay} disabled={paying}>
                {paying
                  ? <><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("paying")}</>
                  : <><CreditCard className="h-5 w-5" aria-hidden="true" />{t("payButton", { amount: money(invoice.onlinePayment.amount), currency: invoice.onlinePayment.currency })}</>}
              </Button>
              {payError ? <p className="text-sm text-destructive" role="alert">{payError}</p> : null}
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("secureNote", { seller: invoice.sellerName })}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{payError || t("noOnlinePayment")}</p>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "text-base font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function Notice({ tone, icon, children }: { tone: "success" | "error" | "warning" | "neutral"; icon: ReactNode; children: ReactNode }) {
  const edge = {
    success: "border-l-emerald-500 text-emerald-700 dark:text-emerald-400",
    error: "border-l-red-500 text-red-700 dark:text-red-400",
    warning: "border-l-amber-500 text-amber-700 dark:text-amber-400",
    neutral: "border-l-muted-foreground text-muted-foreground",
  }[tone]
  return (
    <div className={`flex gap-3 rounded-lg border border-l-4 p-3 text-sm ${edge}`} role="status">
      <span className="shrink-0">{icon}</span>
      <div className="flex flex-col items-start text-foreground">{children}</div>
    </div>
  )
}
