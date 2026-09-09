"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Camera, Calendar, TrendingUp, TrendingDown, Loader2 } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts"
import { useSnapshots, useCreateSnapshot } from "@/lib/cost-model/hooks"
import { fmtAmountDecimal } from "@/lib/utils"
import { formatDate } from "@/lib/format-date"

interface SnapshotRow {
  id: string
  snapshotMonth: string
  totalCost: number
  totalRevenue: number
  margin: number
  marginPct: number
  overheadTotal: number
  employeeCost: number
  profitableClients: number
  lossClients: number
  createdAt: string
}

function formatMonth(month: string): string {
  const [year, m] = month.split("-")
  const months = ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"]
  return `${months[parseInt(m, 10) - 1]} ${year}`
}

function fmt(n: number): string {
  return fmtAmountDecimal(n)
}

export function SnapshotsTab() {
  const t = useTranslations("profitability")
  const locale = useLocale()
  const { data: rawSnapshots = [], isLoading, error } = useSnapshots()
  const createMutation = useCreateSnapshot()

  // Sort snapshots chronologically for display
  const snapshots: SnapshotRow[] = useMemo(() => {
    const arr = [...(rawSnapshots as SnapshotRow[])]
    arr.sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth))
    return arr
  }, [rawSnapshots])

  const [selectedMonth, setSelectedMonth] = useState<string>("")

  // Auto-select latest month when data loads
  const effectiveMonth = selectedMonth || (snapshots.length > 0 ? snapshots[snapshots.length - 1].snapshotMonth : "")
  const selectedIdx = snapshots.findIndex(s => s.snapshotMonth === effectiveMonth)
  const selected = selectedIdx >= 0 ? snapshots[selectedIdx] : null
  const prevSnapshot = selectedIdx > 0 ? snapshots[selectedIdx - 1] : null

  const trendData = useMemo(() =>
    snapshots.map(s => ({
      name: formatMonth(s.snapshotMonth),
      cost: Math.round(s.totalCost),
      revenue: Math.round(s.totalRevenue),
      margin: Math.round(s.margin),
    })),
    [snapshots]
  )

  const calcChange = (current: number, prev: number | undefined): { value: string; positive: boolean } | null => {
    if (prev === undefined || prev === null) return null
    const diff = current - prev
    const pct = prev !== 0 ? (diff / prev * 100).toFixed(1) : "0"
    return { value: `${diff >= 0 ? "+" : ""}${pct}%`, positive: diff >= 0 }
  }

  const handleCreateSnapshot = () => {
    createMutation.mutate()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Yüklənir...</span>
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-red-600">
          Xəta baş verdi: {(error as Error).message}
        </CardContent>
      </Card>
    )
  }

  if (snapshots.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={handleCreateSnapshot} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Camera className="h-4 w-4 mr-1" />
            )}
            {t("snapSave")}
          </Button>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("snapNoData")}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with month selector and save button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <select
            value={effectiveMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-3 text-sm"
          >
            {snapshots.map(s => (
              <option key={s.snapshotMonth} value={s.snapshotMonth}>{formatMonth(s.snapshotMonth)}</option>
            ))}
          </select>
          {selected && (
            <span className="text-xs text-muted-foreground">
              {t("snapSavedAt")}: {formatDate(selected.createdAt, locale)}
            </span>
          )}
        </div>
        <Button size="sm" onClick={handleCreateSnapshot} disabled={createMutation.isPending}>
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Camera className="h-4 w-4 mr-1" />
          )}
          {t("snapSave")}
        </Button>
      </div>

      {selected && (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Ümumi Maya (Grand Total G)</CardTitle></CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{fmt(selected.totalCost)}</p>
                {prevSnapshot && (
                  <p className={`text-xs ${calcChange(selected.totalCost, prevSnapshot.totalCost)?.positive ? "text-red-600" : "text-green-600"}`}>
                    {calcChange(selected.totalCost, prevSnapshot.totalCost)?.value} vs əvvəlki
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Gəlir</CardTitle></CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{fmt(selected.totalRevenue)}</p>
                {prevSnapshot && (
                  <p className={`text-xs ${calcChange(selected.totalRevenue, prevSnapshot.totalRevenue)?.positive ? "text-green-600" : "text-red-600"}`}>
                    {calcChange(selected.totalRevenue, prevSnapshot.totalRevenue)?.value} vs əvvəlki
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Marja</CardTitle></CardHeader>
              <CardContent>
                <p className={`text-xl font-bold ${selected.margin >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {fmt(selected.margin)}
                </p>
                <p className="text-xs text-muted-foreground">{selected.marginPct.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Müştərilər</CardTitle></CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{selected.profitableClients + selected.lossClients}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-green-600">Mənfəətli: {selected.profitableClients}</span>
                  {" / "}
                  <span className="text-red-600">Zərərli: {selected.lossClients}</span>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          {trendData.length > 1 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> {t("snapCostVsRevenueTrend")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip />
                      <Bar dataKey="cost" fill="hsl(var(--destructive))" name="Maya" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" name="Gəlir" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingDown className="h-4 w-4" /> {t("snapMarginTrend")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip />
                      <Line type="monotone" dataKey="margin" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} name="Marja" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Snapshot history table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("snapHistory")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Ay</th>
                      <th className="pb-2 pr-4 text-right">Ümumi Maya (G)</th>
                      <th className="pb-2 pr-4 text-right">Gəlir</th>
                      <th className="pb-2 pr-4 text-right">Marja</th>
                      <th className="pb-2 pr-4 text-right">Marja %</th>
                      <th className="pb-2 pr-4 text-right">Mənfəətli</th>
                      <th className="pb-2 pr-4 text-right">Zərərli</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...snapshots].reverse().map((s, idx) => {
                      const prevInList = snapshots[snapshots.indexOf(s) - 1]
                      const marginChange = prevInList
                        ? calcChange(s.marginPct, prevInList.marginPct)
                        : null
                      return (
                        <tr
                          key={s.id}
                          className={`border-b last:border-0 hover:bg-muted/50 cursor-pointer ${s.snapshotMonth === effectiveMonth ? "bg-muted/50" : ""}`}
                          onClick={() => setSelectedMonth(s.snapshotMonth)}
                        >
                          <td className="py-2.5 pr-4 font-medium">{formatMonth(s.snapshotMonth)}</td>
                          <td className="py-2.5 pr-4 text-right font-mono">{s.totalCost.toLocaleString("en", { minimumFractionDigits: 2 })}</td>
                          <td className="py-2.5 pr-4 text-right font-mono">{s.totalRevenue.toLocaleString("en", { minimumFractionDigits: 2 })}</td>
                          <td className={`py-2.5 pr-4 text-right font-mono ${s.margin >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {s.margin.toLocaleString("en", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            <Badge variant={s.margin >= 0 ? "default" : "destructive"}>
                              {s.marginPct.toFixed(1)}%
                            </Badge>
                            {marginChange && (
                              <span className={`ml-1 text-xs ${marginChange.positive ? "text-green-600" : "text-red-600"}`}>
                                {marginChange.value}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-mono text-green-600">{s.profitableClients}</td>
                          <td className="py-2.5 pr-4 text-right font-mono text-red-600">{s.lossClients}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
