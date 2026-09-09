"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Save, TrendingUp, Download, Upload } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

interface Department {
  id: string
  key: string
  label: string
  hasRevenue: boolean
  sortOrder: number
  isActive: boolean
}

interface ForecastEntry {
  id: string
  departmentId: string
  month: number
  amount: number
  budgetDept: { id: string; key: string; label: string }
}

const VAT_RATE = 0.18

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export default function SalesForecastPage() {
  const { data: session } = useSession()
  const ts = useTranslations("settings")
  const locale = useLocale()
  useAutoTour("salesForecastSettings")
  const orgId = session?.user?.organizationId

  const MONTHS = useMemo(
    () => Array.from({ length: 12 }, (_, i) =>
      new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(2000, i, 1))
    ),
    [locale]
  )

  const [departments, setDepartments] = useState<Department[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [grid, setGrid] = useState<Record<string, Record<number, number>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showVat, setShowVat] = useState(false) // toggle: show with/without VAT

  const headers = useMemo<Record<string, string>>(
    () => {
      const nextHeaders: Record<string, string> = { "Content-Type": "application/json" }
      if (orgId) nextHeaders["x-organization-id"] = String(orgId)
      return nextHeaders
    },
    [orgId]
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [deptRes, fcRes] = await Promise.all([
        fetch("/api/budgeting/departments?includeInactive=false", { headers }),
        fetch(`/api/budgeting/sales-forecast?year=${year}`, { headers }),
      ])

      if (deptRes.ok) {
        const deptData = (await deptRes.json()).data || []
        setDepartments(deptData.filter((d: Department) => d.hasRevenue && d.isActive))
      }

      const newGrid: Record<string, Record<number, number>> = {}
      if (fcRes.ok) {
        const entries: ForecastEntry[] = (await fcRes.json()).data || []
        for (const e of entries) {
          if (!newGrid[e.departmentId]) newGrid[e.departmentId] = {}
          newGrid[e.departmentId][e.month] = e.amount
        }
      }
      setGrid(newGrid)
    } catch (err) {
      console.error("Failed to load forecast data:", err)
    } finally {
      setLoading(false)
    }
  }, [year, headers])

  useEffect(() => {
    if (session) fetchData()
  }, [session, fetchData])

  // Grid values are always stored WITHOUT VAT. Display multiplier applied if showVat=true.
  const getVal = (deptId: string, month: number): number => {
    const base = grid[deptId]?.[month] || 0
    return showVat ? base * (1 + VAT_RATE) : base
  }

  const setCell = (deptId: string, month: number, displayValue: number) => {
    // Convert back to excl. VAT for storage
    const storeValue = showVat ? displayValue / (1 + VAT_RATE) : displayValue
    setGrid((prev) => ({
      ...prev,
      [deptId]: { ...(prev[deptId] || {}), [month]: storeValue },
    }))
    setSaved(false)
  }

  const rowTotal = (deptId: string): number => {
    const row = grid[deptId] || {}
    const base = Object.values(row).reduce((s, v) => s + (v || 0), 0)
    return showVat ? base * (1 + VAT_RATE) : base
  }

  const colTotal = (month: number): number => {
    return departments.reduce((s, d) => s + getVal(d.id, month), 0)
  }

  const grandTotal = (): number => {
    return departments.reduce((s, d) => s + rowTotal(d.id), 0)
  }

  // VAT amount for a row (total VAT = rowTotal_with_vat - rowTotal_without_vat)
  const rowVat = (deptId: string): number => {
    const row = grid[deptId] || {}
    const base = Object.values(row).reduce((s, v) => s + (v || 0), 0)
    return base * VAT_RATE
  }

  const colVat = (month: number): number => {
    return departments.reduce((s, d) => s + (grid[d.id]?.[month] || 0) * VAT_RATE, 0)
  }

  const grandVat = (): number => {
    return departments.reduce((s, d) => s + rowVat(d.id), 0)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const entries: Array<{ departmentId: string; month: number; amount: number }> = []
      for (const dept of departments) {
        for (let m = 1; m <= 12; m++) {
          const amount = grid[dept.id]?.[m] || 0
          entries.push({ departmentId: dept.id, month: m, amount })
        }
      }

      const res = await fetch("/api/budgeting/sales-forecast", {
        method: "POST",
        headers,
        body: JSON.stringify({ year, entries }),
      })

      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (err) {
      console.error("Failed to save forecast:", err)
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    try {
      const res = await fetch(`/api/budgeting/sales-forecast/export?year=${year}`, { headers })
      if (!res.ok) throw new Error("Export failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `sales-forecast-${year}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export error:", err)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append("file", file)
    formData.append("year", String(year))
    try {
      const res = await fetch("/api/budgeting/sales-forecast/import", {
        method: "POST",
        headers: { "x-organization-id": orgId || "" },
        body: formData,
      })
      if (res.ok) {
        await fetchData()
      }
    } catch (err) {
      console.error("Import error:", err)
    }
    e.target.value = ""
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1" data-tour-id="sales-forecast-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            <h1 className="text-xl font-bold flex items-center gap-2">
              {ts("sfTitle")}
              <HelpButton slug="sales-forecast-settings" variant="label" />
              <TourReplayButton tourId="salesForecastSettings" />
            </h1>
            <p className="text-sm text-muted-foreground">{ts("hintSalesForecast")}</p>
          </div>
          <div className="flex items-center gap-2" data-tour-id="sales-forecast-controls">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-muted-foreground">
              <input
                type="checkbox"
                checked={showVat}
                onChange={(e) => setShowVat(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-zinc-200 dark:border-zinc-700"
              />
              {ts("sfWithVat")}
            </label>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleExport} title={ts("sfExport")}>
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => document.getElementById("forecast-import")?.click()} title={ts("sfImport")}>
              <Upload className="h-4 w-4" />
            </Button>
            <input id="forecast-import" type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
            <Button onClick={handleSave} disabled={saving} size="sm" className="h-8" data-tour-id="sales-forecast-save">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              {saved ? ts("sfSaved") : ts("sfSave")}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground ml-6">
          {ts("sfHintVat")}
        </p>
      </div>

      {/* Grid */}
      <Card data-tour-id="sales-forecast-grid">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {ts("sfYearLabel", { year, count: departments.length })}
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {showVat ? ts("sfVatOn") : ts("sfVatOff")}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left p-2 border font-medium sticky left-0 bg-muted/50 min-w-[140px] z-10">
                    {ts("sfColService")}
                  </th>
                  {MONTHS.map((m, i) => (
                    <th key={i} className="text-right p-2 border font-medium min-w-[95px]">
                      {m}
                    </th>
                  ))}
                  <th className="text-right p-2 border font-semibold min-w-[110px] bg-blue-50 dark:bg-blue-950">
                    {ts("sfColTotal")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {departments.map((dept) => (
                  <tr key={dept.id} className="hover:bg-muted/30">
                    <td className="p-2 border font-medium sticky left-0 bg-background z-10">
                      {dept.label}
                    </td>
                    {MONTHS.map((_, mi) => {
                      const month = mi + 1
                      const displayVal = getVal(dept.id, month)
                      return (
                        <td key={mi} className="p-1 border border-zinc-200 dark:border-zinc-700">
                          <Input
                            type="number"
                            className="h-8 text-right text-xs tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            value={displayVal ? Math.round(displayVal) : ""}
                            placeholder="0"
                            onChange={(e) => setCell(dept.id, month, Number(e.target.value) || 0)}
                          />
                        </td>
                      )
                    })}
                    <td className="p-2 border border-zinc-200 dark:border-zinc-700 text-right font-semibold tabular-nums bg-blue-50 dark:bg-blue-950">
                      {fmt(rowTotal(dept.id))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {/* VAT row */}
                <tr className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs">
                  <td className="p-2 border sticky left-0 bg-amber-50 dark:bg-amber-950/30 z-10 font-medium">
                    {ts("sfVatRow")}
                  </td>
                  {MONTHS.map((_, mi) => (
                    <td key={mi} className="p-2 border border-zinc-200 dark:border-zinc-700 text-right tabular-nums">
                      {fmt(colVat(mi + 1))}
                    </td>
                  ))}
                  <td className="p-2 border border-zinc-200 dark:border-zinc-700 text-right tabular-nums font-medium bg-amber-100 dark:bg-amber-900/30">
                    {fmt(grandVat())}
                  </td>
                </tr>
                {/* Total row */}
                <tr className="bg-muted/70 font-semibold">
                  <td className="p-2 border sticky left-0 bg-muted/70 z-10">
                    {ts("sfGrandTotal", { vat: showVat ? ts("sfGrandTotalWithVat") : ts("sfGrandTotalNoVat") })}
                  </td>
                  {MONTHS.map((_, mi) => (
                    <td key={mi} className="p-2 border border-zinc-200 dark:border-zinc-700 text-right tabular-nums">
                      {fmt(colTotal(mi + 1))}
                    </td>
                  ))}
                  <td className="p-2 border border-zinc-200 dark:border-zinc-700 text-right tabular-nums bg-blue-100 dark:bg-blue-900">
                    {fmt(grandTotal())}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
