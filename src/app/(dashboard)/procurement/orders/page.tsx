"use client"

/** Purchase orders (docs/sales-procurement/README.md, tasks 3.3–3.6). */
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, PackageCheck } from "lucide-react"
import { toast } from "sonner"
import { OrderStatusBadge, LateBadge } from "@/components/procurement/status-badge"
import { formatDay, formatMoney } from "@/components/procurement/format"
import { checkPermission, type Role } from "@/lib/permissions"
import { StatusTabs } from "@/components/procurement/status-tabs"
import { HelpButton } from "@/components/help/help-button"

interface OrderRow {
  id: string
  number: string
  status: string
  currency: string
  totalAmount: string | null
  expectedDeliveryAt: string | null
  late: boolean
  dealChangedAt: string | null
  supplier: { id: string; name: string }
  deal: { id: string; name: string } | null
  request: { id: string; number: string } | null
}

const TABS = ["open", "pending_approval", "late", "received", "cancelled", "all"] as const
type Tab = (typeof TABS)[number]

export default function PurchaseOrdersPage() {
  const t = useTranslations("procurement.orders")
  const tc = useTranslations("procurement.common")
  const ts = useTranslations("procurement.common.orderStatus")
  const locale = useLocale()
  const router = useRouter()
  const { data: session } = useSession()
  const role = ((session?.user as { role?: string } | undefined)?.role || "viewer") as Role
  const seesPrices = checkPermission(role, "procurement-costs", "read")

  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("open")
  const reads = useRef(0)

  const load = useCallback(async () => {
    const read = ++reads.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (tab === "late") params.set("late", "1")
      else if (tab !== "all") params.set("status", tab)
      const res = await fetch(`/api/v1/procurement/orders?${params}`)
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      if (read === reads.current) setRows(body.data?.orders ?? [])
    } catch {
      if (read === reads.current) { toast.error(tc("loadFailed")); setRows([]) }
    } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [tab, tc])

  useEffect(() => { void load() }, [load])

  const tabLabel = (value: Tab) => (value === "open" ? t("openOnly") : value === "late" ? t("lateOnly") : value === "all" ? tc("all") : ts(value))

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <PackageCheck className="h-7 w-7 text-orange-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <HelpButton slug="procurement-orders" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <StatusTabs tabs={TABS.map((value) => ({ id: value, label: tabLabel(value) }))} value={tab} onChange={setTab} />

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">{t("empty")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{tc("number")}</th>
                <th className="px-4 py-2 font-medium">{tc("supplier")}</th>
                <th className="px-4 py-2 font-medium">{tc("deal")}</th>
                <th className="px-4 py-2 font-medium">{tc("status")}</th>
                <th className="px-4 py-2 font-medium">{tc("expected")}</th>
                {seesPrices && <th className="px-4 py-2 text-right font-medium">{tc("total")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => router.push(`/procurement/orders/${row.id}`)}>
                  <td className="px-4 py-2 font-medium tabular-nums">
                    <Link href={`/procurement/orders/${row.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{row.number}</Link>
                    {row.request && <div className="text-xs text-muted-foreground">{row.request.number}</div>}
                  </td>
                  <td className="px-4 py-2">{row.supplier.name}</td>
                  <td className="px-4 py-2">
                    {row.deal ? <Link href={`/deals/${row.deal.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.deal.name}</Link> : "—"}
                    {row.dealChangedAt && <div className="text-xs text-red-600">{tc("dealChanged")}</div>}
                  </td>
                  <td className="px-4 py-2"><div className="flex flex-wrap items-center gap-1"><OrderStatusBadge status={row.status} />{row.late && <LateBadge />}</div></td>
                  <td className="px-4 py-2">{formatDay(row.expectedDeliveryAt, locale)}</td>
                  {seesPrices && <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.totalAmount, row.currency, locale)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
