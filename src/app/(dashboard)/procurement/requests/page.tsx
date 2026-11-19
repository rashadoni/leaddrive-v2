"use client"

/**
 * Purchase requests (docs/sales-procurement/README.md, task 3.1): what sales
 * asked purchasing to buy. A request from a deal is raised on the deal's
 * «Purchasing» tab; one without a deal is added here.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { ClipboardList, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { RequestStatusBadge } from "@/components/procurement/status-badge"
import { RequestCreateDialog } from "@/components/procurement/request-create-dialog"
import { formatDay } from "@/components/procurement/format"
import { checkPermission, type Role } from "@/lib/permissions"
import { StatusTabs } from "@/components/procurement/status-tabs"
import { HelpButton } from "@/components/help/help-button"

interface RequestRow {
  id: string
  number: string
  title: string
  status: string
  neededBy: string | null
  createdAt: string
  dealChangedAt: string | null
  deal: { id: string; name: string } | null
  _count: { items: number; quotes: number; orders: number }
}

const TABS = ["open", "draft", "ordered", "closed", "all"] as const
type Tab = (typeof TABS)[number]

export default function PurchaseRequestsPage() {
  const t = useTranslations("procurement.requests")
  const tc = useTranslations("procurement.common")
  const ts = useTranslations("procurement.common.requestStatus")
  const locale = useLocale()
  const router = useRouter()
  const { data: session } = useSession()
  const role = ((session?.user as { role?: string } | undefined)?.role || "viewer") as Role
  const canCreate = checkPermission(role, "purchase-requests", "write")

  const [rows, setRows] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("open")
  const [createOpen, setCreateOpen] = useState(false)
  const reads = useRef(0)

  const load = useCallback(async () => {
    const read = ++reads.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (tab !== "all") params.set("status", tab)
      const res = await fetch(`/api/v1/procurement/requests?${params}`)
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      if (read === reads.current) setRows(body.data?.requests ?? [])
    } catch {
      if (read === reads.current) { toast.error(tc("loadFailed")); setRows([]) }
    } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [tab, tc])

  useEffect(() => { void load() }, [load])

  const tabLabel = (value: Tab) => (value === "open" ? tc("open") : value === "all" ? tc("all") : ts(value))

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-7 w-7 text-orange-600" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <HelpButton slug="procurement-requests" variant="label" /></h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />{t("new")}</Button>
        )}
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
                <th className="px-4 py-2 font-medium">{t("titleField")}</th>
                <th className="px-4 py-2 font-medium">{tc("deal")}</th>
                <th className="px-4 py-2 font-medium">{tc("status")}</th>
                <th className="px-4 py-2 font-medium">{tc("neededBy")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("quotes")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("orders")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => router.push(`/procurement/requests/${row.id}`)}>
                  <td className="px-4 py-2 font-medium tabular-nums">
                    <Link href={`/procurement/requests/${row.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{row.number}</Link>
                  </td>
                  <td className="px-4 py-2">
                    {row.title}
                    <div className="text-xs text-muted-foreground">{t("lines", { count: row._count.items })}</div>
                    {row.dealChangedAt && <div className="text-xs text-red-600">{tc("dealChanged")}</div>}
                  </td>
                  <td className="px-4 py-2">{row.deal ? <Link href={`/deals/${row.deal.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.deal.name}</Link> : "—"}</td>
                  <td className="px-4 py-2"><RequestStatusBadge status={row.status} /></td>
                  <td className="px-4 py-2">{formatDay(row.neededBy, locale)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row._count.quotes}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row._count.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RequestCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => router.push(`/procurement/requests/${id}`)}
      />
    </div>
  )
}
