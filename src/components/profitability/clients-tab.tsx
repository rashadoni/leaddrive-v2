"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ArrowUpDown, Search, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { useCostModelAnalytics } from "@/lib/cost-model/hooks"
import { fmtAmountDecimal } from "@/lib/utils"
import type { ClientMargin } from "@/lib/cost-model/types"

const STATUS_STYLES: Record<string, { labelKey: string; className: string }> = {
  good: { labelKey: "statusGood", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
  low: { labelKey: "statusLow", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" },
  loss: { labelKey: "statusLoss", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
  no_revenue: { labelKey: "statusNoRevenue", className: "bg-muted text-foreground" },
}

type SortField = "name" | "userCount" | "totalRevenue" | "helpdeskRevenue" | "primaryRevenue" | "totalCost" | "primaryMargin" | "margin" | "marginPct"

function getFieldValue(client: ClientMargin & { primaryRevenue: number; primaryMargin: number }, field: SortField): string | number {
  switch (field) {
    case "name": return client.name
    case "userCount": return client.userCount
    case "totalRevenue": return client.totalRevenue
    case "helpdeskRevenue": return client.helpdeskRevenue || 0
    case "primaryRevenue": return client.primaryRevenue
    case "totalCost": return client.totalCost
    case "primaryMargin": return client.primaryMargin
    case "margin": return client.margin
    case "marginPct": return client.marginPct
  }
}

function fmt(n: number): string {
  return fmtAmountDecimal(n)
}

export function ClientsTab() {
  const t = useTranslations("profitability")
  const { data, isLoading, error } = useCostModelAnalytics()
  const clients = data?.clients || []

  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("margin")
  const [sortAsc, setSortAsc] = useState(true)

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(field === "name")
    }
  }

  const enriched = useMemo(() =>
    clients.map(c => ({
      ...c,
      helpdeskRevenue: c.helpdeskRevenue || 0,
      primaryRevenue: c.totalRevenue - (c.helpdeskRevenue || 0),
      primaryMargin: c.margin + (c.helpdeskRevenue || 0),
    })),
    [clients]
  )

  const filtered = useMemo(() =>
    enriched
      .filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.costCode || "").toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => {
        const va = getFieldValue(a, sortField)
        const vb = getFieldValue(b, sortField)
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)
        return sortAsc ? cmp : -cmp
      }),
    [enriched, search, sortField, sortAsc]
  )

  const totalCost = clients.reduce((s, c) => s + c.totalCost, 0)
  const totalRevenue = clients.reduce((s, c) => s + c.totalRevenue, 0)
  const totalBalance = totalRevenue - totalCost
  const profitable = clients.filter(c => c.status === "good" || c.status === "low").length
  const lossCount = clients.filter(c => c.status === "loss").length

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button variant="ghost" size="sm" className="h-auto p-0 font-normal text-muted-foreground hover:text-foreground" onClick={() => toggleSort(field)}>
      {children} <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">{t("loading")}</span>
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-red-600">
          {t("errorOccurred")}: {(error as Error).message}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("totalCost")}</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold tabular-nums tracking-tight">{fmt(totalCost)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("totalRevenue")}</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold tabular-nums tracking-tight">{fmt(totalRevenue)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("totalBalance")}</CardTitle></CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold tabular-nums tracking-tight ${totalBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
              {fmt(totalBalance)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("clients")}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums tracking-tight">{clients.length}</p>
            <p className="text-xs text-muted-foreground">
              <span className="text-green-600">{t("profitableLabel")}: {profitable}</span> / <span className="text-red-600">{t("lossLabel")}: {lossCount}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Client table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("clientProfitability")}</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder={t("searchByNameOrCode")} value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4"><SortHeader field="name">Müştəri</SortHeader></th>
                  <th className="pb-2 pr-4 text-right"><SortHeader field="userCount">İst.</SortHeader></th>
                  <th className="pb-2 pr-4 text-right"><SortHeader field="totalRevenue">Qiymət</SortHeader></th>
                  <th className="pb-2 pr-4 text-right"><SortHeader field="helpdeskRevenue">HelpDesk</SortHeader></th>
                  <th className="pb-2 pr-4 text-right"><SortHeader field="primaryRevenue">Əsas Gəlir</SortHeader></th>
                  <th className="pb-2 pr-4 text-right"><SortHeader field="totalCost">Maya</SortHeader></th>
                  <th className="pb-2 pr-4 text-right"><SortHeader field="primaryMargin">Əsas Marja</SortHeader></th>
                  <th className="pb-2 pr-4 text-right"><SortHeader field="margin">Tam Marja</SortHeader></th>
                  <th className="pb-2 pr-4 text-right"><SortHeader field="marginPct">%</SortHeader></th>
                  <th className="pb-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-muted-foreground">
                      {search ? t("noResults") : t("noClientData")}
                    </td>
                  </tr>
                ) : (
                  filtered.map(client => {
                    const style = STATUS_STYLES[client.status] || STATUS_STYLES.no_revenue
                    const hd = client.helpdeskRevenue
                    const primaryRev = client.primaryRevenue
                    const primaryMargin = client.primaryMargin
                    return (
                      <tr key={String(client.id)} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2.5 pr-4">
                          <div>
                            <a href={`/dashboard/profitability/clients/${client.id}`} className="font-medium hover:underline">
                              {client.name}
                            </a>
                            {client.costCode && (
                              <p className="text-xs text-muted-foreground">{client.costCode}</p>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono">{client.userCount.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-right font-mono">{fmt(client.totalRevenue)}</td>
                        <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">{fmt(hd)}</td>
                        <td className="py-2.5 pr-4 text-right font-mono">{fmt(primaryRev)}</td>
                        <td className="py-2.5 pr-4 text-right font-mono">{fmt(client.totalCost)}</td>
                        <td className={`py-2.5 pr-4 text-right font-mono font-medium ${primaryMargin >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {primaryMargin >= 0 ? "+" : ""}{fmt(primaryMargin)}
                        </td>
                        <td className={`py-2.5 pr-4 text-right font-mono font-medium ${client.margin >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {client.margin >= 0 ? "+" : ""}{fmt(client.margin)}
                        </td>
                        <td className={`py-2.5 pr-4 text-right font-mono font-medium ${client.marginPct >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {client.marginPct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge className={style.className}>{t(style.labelKey)}</Badge>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
