"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

type Delivery = { id: string; recipientPhone: string; status: string; errorCode: string | null }
const statuses = ["pending", "sending", "accepted", "delivered", "read", "failed", "unknown", "skipped"] as const

export function WhatsAppCampaignDeliveries({ campaignId, orgId }: { campaignId: string; orgId?: string }) {
  const t = useTranslations("campaigns")
  const tc = useTranslations("common")
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("")
  const [data, setData] = useState<{ deliveries: Delivery[]; total: number } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let controller: AbortController | undefined
    let active = true
    setData(null)
    const load = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const response = await fetch(`/api/v1/campaigns/${campaignId}/deliveries?page=${page}&status=${status}`, {
          headers: orgId ? { "x-organization-id": orgId } : {}, signal: controller.signal,
        })
        if (!response.ok) throw new Error("Delivery history unavailable")
        const result = await response.json()
        if (active) { setData(result.data); setError(false) }
      } catch (e) { if (active && !(e instanceof DOMException && e.name === "AbortError")) setError(true) }
    }
    void load()
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load() }, 15_000)
    return () => { active = false; controller?.abort(); clearInterval(timer) }
  }, [campaignId, orgId, page, status])
  return <div className="space-y-3 pt-3 border-t">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">{t("deliveryRecipients")}</h3>
      <select aria-label={t("deliveryStatusFilter")} value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} className="rounded-md border bg-background px-2 py-1 text-sm">
        <option value="">{t("deliveryAllStatuses")}</option>
        {statuses.map(value => <option key={value} value={value}>{t(`delivery_${value}`)}</option>)}
      </select>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{tc("errorGeneric")}</p>}
    {!data && !error && <p className="text-sm text-muted-foreground">{tc("loading")}</p>}
    {data && <>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">{t("deliveryRecipient")}</th><th className="py-2 font-medium">{t("deliveryStatusFilter")}</th></tr></thead>
        <tbody>{data.deliveries.map(row => <tr key={row.id} className="border-b last:border-0"><td className="py-2 tabular-nums">{row.recipientPhone}</td><td className="py-2">{statuses.includes(row.status as typeof statuses[number]) ? t(`delivery_${row.status}`) : row.status}{row.errorCode && <div className="text-xs text-muted-foreground">{row.errorCode === "recipient_opted_out" ? t("socialReasonOptedOut") : row.errorCode === "outside_window_no_template" ? t("socialReasonOutsideWindowNoTemplate") : row.errorCode === "campaign_cancelled" || row.errorCode === "campaign_inactive" ? t("statusCancelled") : row.status === "unknown" ? t("delivery_unknown") : t("deliveryProviderIssue")}</div>}</td></tr>)}</tbody>
      </table></div>
      {data.deliveries.length === 0 && <p className="text-sm text-muted-foreground">{tc("noData")}</p>}
      <div className="flex items-center justify-end gap-3"><Button aria-label={tc("previousPage")} size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>←</Button><span className="text-xs tabular-nums">{page} / {Math.max(1, Math.ceil(data.total / 50))}</span><Button aria-label={tc("nextPage")} size="sm" variant="outline" disabled={page * 50 >= data.total} onClick={() => setPage(value => value + 1)}>→</Button></div>
    </>}
  </div>
}
