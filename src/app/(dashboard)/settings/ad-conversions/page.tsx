"use client"

/**
 * Settings → «Reklam konversiyaları»: where new leads and won deals are sent
 * (Meta, Google Analytics 4), and what was sent lately.
 */
import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { Megaphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Hint } from "@/components/hint"
import { MetaDestinationCard, type DestinationSave, type DestinationView } from "@/components/ad-conversions/destination-card"
import { Ga4DestinationCard, type Ga4Save } from "@/components/ad-conversions/ga4-destination-card"
import { formatDateTime } from "@/lib/format-date"

export interface RecentEvent {
  id: string
  platform: "meta" | "ga4"
  eventName: "lead" | "purchase"
  recordLabel: string
  status: "sent" | "pending" | "failed" | "skipped"
  reason: string | null
  at: string
}

interface AdConversionsData {
  destinations: { meta: DestinationView | null; ga4: DestinationView | null }
  recent: RecentEvent[]
}

const STATUS_TONE: Record<RecentEvent["status"], string> = {
  sent: "text-emerald-700 dark:text-emerald-400",
  pending: "text-muted-foreground",
  failed: "text-destructive",
  skipped: "text-amber-700 dark:text-amber-400",
}

async function fetchAdConversions(): Promise<AdConversionsData | null> {
  const response = await fetch("/api/v1/ad-conversions", { cache: "no-store" }).catch(() => null)
  const body = await response?.json().catch(() => null)
  return body?.success ? body.data : null
}

export default function AdConversionsPage() {
  const t = useTranslations("adConversions")
  const [data, setData] = useState<AdConversionsData | null>(null)

  const load = useCallback(() => {
    void fetchAdConversions().then((result) => setData(result ?? { destinations: { meta: null, ga4: null }, recent: [] }))
  }, [])

  useEffect(load, [load])

  async function save(input: DestinationSave) {
    const response = await fetch("/api/v1/ad-conversions/meta", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (!response?.ok || !body?.success) return { ok: false as const, code: body?.code as string | undefined, reason: body?.reason as string | undefined }
    return { ok: true as const, view: body.data as DestinationView }
  }

  async function saveGa4(input: Ga4Save) {
    const response = await fetch("/api/v1/ad-conversions/ga4", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (!response?.ok || !body?.success) return { ok: false as const, code: body?.code as string | undefined, reason: body?.reason as string | undefined }
    return { ok: true as const, view: body.data as DestinationView }
  }

  async function testGa4() {
    const response = await fetch("/api/v1/ad-conversions/ga4/test", { method: "POST" }).catch(() => null)
    const body = await response?.json().catch(() => null)
    return { ok: Boolean(response?.ok && body?.success), reason: body?.reason as string | undefined }
  }

  async function test() {
    const response = await fetch("/api/v1/ad-conversions/meta/test", { method: "POST" }).catch(() => null)
    const body = await response?.json().catch(() => null)
    load()
    return { ok: Boolean(response?.ok && body?.success), code: body?.code as string | undefined, reason: body?.reason as string | undefined }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Megaphone className="h-6 w-6 text-muted-foreground" aria-hidden="true" />{t("title")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("desc")}</p>
      </div>

      {data ? <MetaDestinationCard view={data.destinations.meta} onSave={save} onTest={test} /> : null}
      {data ? <Ga4DestinationCard view={data.destinations.ga4} onSave={saveGa4} onTest={testGa4} /> : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("snippetTitle")}</CardTitle>
              <CardDescription className="mt-1 max-w-3xl">{t("snippetDesc")}</CardDescription>
            </div>
            <Button variant="outline" asChild><Link href="/settings/web-to-lead">{t("openWebToLead")}</Link></Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("recentTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.recent.length > 0 ? <RecentTable rows={data.recent} /> : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("recentEmpty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function RecentTable({ rows }: { rows: RecentEvent[] }) {
  const t = useTranslations("adConversions")
  const locale = useLocale()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{t("colTime")}</th>
            <th className="py-2 pr-3 font-medium">{t("colEvent")}</th>
            <th className="py-2 pr-3 font-medium">{t("colRecord")}</th>
            <th className="py-2 pr-3 font-medium">{t("colWhere")}</th>
            <th className="py-2 font-medium">{t("colStatus")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-0">
              <td className="py-2 pr-3 tabular-nums text-muted-foreground">{formatDateTime(row.at, locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
              <td className="py-2 pr-3">{t(`event_${row.eventName}`)}</td>
              <td className="py-2 pr-3">{row.recordLabel}</td>
              <td className="py-2 pr-3">{row.platform === "ga4" ? "GA4" : "Meta"}</td>
              <td className={`py-2 font-medium ${STATUS_TONE[row.status]}`}>
                {row.reason ? (
                  <Hint text={row.reason.startsWith("skip_") ? t(row.reason) : row.reason}>
                    <span className="cursor-help underline decoration-dotted underline-offset-4">{t(`status_${row.status}`)}</span>
                  </Hint>
                ) : t(`status_${row.status}`)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
