"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ColorStatCard } from "@/components/color-stat-card"
import {
  DollarSign, Download, Search, ChevronDown, ChevronRight,
  RotateCcw, Trash2, Loader2, Plus, Save, X, Trophy, ArrowRight, BarChart3, TrendingUp,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer,
} from "recharts"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { InfoHint } from "@/components/info-hint"
import { HelpButton } from "@/components/help/help-button"
import { PageDescription } from "@/components/page-description"
import { fmtAmountDecimal } from "@/lib/utils"
import { getCurrencySymbol } from "@/lib/constants"
import {
  GROUP_ORDER, BOARD_CATS, CATEGORY_MAP,
  catTotal, applyAdjustments, aggregateBoardCats, emptyAdjustments,
  type PricingData, type PricingAdjustments, type PricingCompany, type CategoryValue, type PricingCategory,
} from "@/lib/pricing"

// ─── Chart colors ───────────────────────────────────────────
const GROUP_COLORS = ["#1B2A4A", "#2D4A7A", "#4A6FA5", "#6B8FBF", "#8CB0D9", "#ADC8E6", "#96A3B0"]
const CAT_COLORS = ["#1B2A4A", "#4A6FA5", "#E91E63", "#FF9800", "#4CAF50", "#9C27B0", "#00BCD4", "#FF5722", "#795548", "#607D8B", "#3F51B5"]

// ─── Slider component ──────────────────────────────────────
function AdjSlider({ value, onChange, label, count, datePicker, dateValue, onDateChange }: {
  value: number
  onChange: (v: number) => void
  label: string
  count?: number
  datePicker?: boolean
  dateValue?: string
  onDateChange?: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">{label}{count !== undefined ? ` (${count})` : ""}</span>
        <span className={`text-sm font-mono font-bold ${value > 0 ? "text-green-600" : value < 0 ? "text-red-600" : "text-muted-foreground"}`}>{value}%</span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={-50}
          max={50}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-600"
          style={{ direction: "ltr" }}
        />
        <div className="absolute top-1/2 -translate-y-1/2 pointer-events-none" style={{ left: "50%" }}>
          <div className="w-0.5 h-4 bg-muted-foreground/50 rounded" />
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>-50%</span>
        <span>0%</span>
        <span>+50%</span>
      </div>
      {datePicker && (
        <input
          type="date"
          value={dateValue || ""}
          onChange={(e) => onDateChange?.(e.target.value)}
          className="w-full h-8 px-2 text-xs border border-zinc-200 dark:border-zinc-700 rounded mt-1"
          placeholder="dd.mm.yyyy"
        />
      )}
    </div>
  )
}

// ─── Collapsible section ────────────────────────────────────
function CollapsibleSection({ title, defaultOpen, children }: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 text-sm font-medium"
      >
        {title}
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

export default function PricingPage() {
  const { data: session } = useSession()
  const tp = useTranslations("pricing")
  const locale = useLocale()
  const orgId = session?.user?.organizationId
  useAutoTour("pricing")

  const [pricingData, setPricingData] = useState<PricingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"model" | "edit" | "sales">("model")
  const [adjustments, setAdj] = useState<PricingAdjustments>(emptyAdjustments())
  const [tableSearch, setTableSearch] = useState("")
  const [tableSortCol, setTableSortCol] = useState<string>("group")
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("asc")
  const [compSliderSearch, setCompSliderSearch] = useState("")
  const [exportLoading, setExportLoading] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportTemplate, setExportTemplate] = useState("1")
  const [exportDate, setExportDate] = useState("")

  // Edit tab state
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null)
  const [editSearch, setEditSearch] = useState("")
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // Sales tab state
  const [salesData, setSalesData] = useState<any[]>([])
  const [salesLoading, setSalesLoading] = useState(false)
  const [salesFilter, setSalesFilter] = useState<{ type: string; status: string }>({ type: "all", status: "all" })
  const [showAddSale, setShowAddSale] = useState(false)
  const [newSale, setNewSale] = useState({
    profileId: "", type: "recurring" as string, name: "", description: "",
    categoryName: "", unit: "Per Device", qty: 1, price: 0,
    effectiveDate: new Date().toISOString().split("T")[0], endDate: "",
  })
  const [salesSearch, setSalesSearch] = useState("")
  const [profilesList, setProfilesList] = useState<any[]>([])
  const [savingSale, setSavingSale] = useState(false)
  // Won deals state
  const [wonDeals, setWonDeals] = useState<any[]>([])
  const [wonDealsLoading, setWonDealsLoading] = useState(false)
  const [addingDealId, setAddingDealId] = useState<string | null>(null)

  const headers = orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/pricing/data", { headers: headers as any })
      const json = await res.json()
      if (json.success) setPricingData(json.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [orgId])

  const fetchSales = useCallback(async () => {
    setSalesLoading(true)
    try {
      const res = await fetch("/api/v1/pricing/additional-sales?limit=500", { headers: headers as any })
      const json = await res.json()
      if (json.success) setSalesData(json.data.sales || [])
    } catch { /* ignore */ }
    finally { setSalesLoading(false) }
  }, [orgId])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/pricing/profiles?all=true", { headers: headers as any })
      const json = await res.json()
      if (json.success) setProfilesList(json.data.profiles || [])
    } catch { /* ignore */ }
  }, [orgId])

  const fetchWonDeals = useCallback(async () => {
    setWonDealsLoading(true)
    try {
      const res = await fetch("/api/v1/deals?limit=500&stage=WON", { headers: headers as any })
      const json = await res.json()
      const deals = json.success ? (json.data?.deals || json.data || []) : []
      // Filter out deals already linked to additional sales
      const linkedDealIds = new Set(salesData.filter((s: any) => s.dealId).map((s: any) => s.dealId))
      setWonDeals(deals.filter((d: any) => !linkedDealIds.has(d.id)))
    } catch { /* ignore */ }
    finally { setWonDealsLoading(false) }
  }, [orgId, salesData])

  useEffect(() => { if (session) fetchData() }, [session])
  useEffect(() => { if (session && activeTab === "sales") { fetchSales(); fetchProfiles() } }, [session, activeTab])
  useEffect(() => { if (session && activeTab === "sales" && salesData.length >= 0) fetchWonDeals() }, [session, activeTab, salesData])

  // ─── Computed values ────────────────────────────────────
  const adjustedData = useMemo(() => {
    if (!pricingData) return null
    return applyAdjustments(pricingData, adjustments)
  }, [pricingData, adjustments])

  const baseTotal = useMemo(() => {
    if (!pricingData) return 0
    return Object.values(pricingData).reduce((s, c) => s + c.monthly, 0)
  }, [pricingData])

  const adjTotal = useMemo(() => {
    if (!adjustedData) return 0
    return Object.values(adjustedData).reduce((s, c) => s + c.monthly, 0)
  }, [adjustedData])

  const rawDiff = adjTotal - baseTotal
  const annualEffect = Math.abs(rawDiff) < 0.01 ? 0 : rawDiff * 12
  const avgChange = baseTotal > 0 && Math.abs(rawDiff) >= 0.01 ? (rawDiff / baseTotal) * 100 : 0

  // Group company counts
  const groupCounts = useMemo(() => {
    if (!pricingData) return {} as Record<string, number>
    const counts: Record<string, number> = {}
    for (const info of Object.values(pricingData)) {
      counts[info.group] = (counts[info.group] || 0) + 1
    }
    return counts
  }, [pricingData])

  // All categories
  const allCategories = useMemo(() => {
    if (!pricingData) return [] as string[]
    const cats = new Set<string>()
    for (const info of Object.values(pricingData)) {
      for (const cat of Object.keys(info.categories)) cats.add(cat)
    }
    return Array.from(cats).sort()
  }, [pricingData])

  // ─── Chart data ─────────────────────────────────────────
  const groupChartData = useMemo(() => {
    if (!pricingData || !adjustedData) return []
    return GROUP_ORDER.map((group) => {
      const baseRev = Object.values(pricingData)
        .filter((c) => c.group === group)
        .reduce((s, c) => s + c.monthly, 0)
      const adjRev = Object.values(adjustedData)
        .filter((c) => c.group === group)
        .reduce((s, c) => s + c.monthly, 0)
      return { name: group, base: Math.round(baseRev), new: Math.round(adjRev) }
    }).filter((d) => d.base > 0 || d.new > 0)
  }, [pricingData, adjustedData])

  const catChartData = useMemo(() => {
    if (!adjustedData) return []
    const totals: Record<string, number> = {}
    for (const info of Object.values(adjustedData)) {
      for (const [cat, val] of Object.entries(info.categories)) {
        totals[cat] = (totals[cat] || 0) + catTotal(val)
      }
    }
    return Object.entries(totals)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value: Math.round(value) }))
  }, [adjustedData])

  const topCompaniesData = useMemo(() => {
    if (!adjustedData) return []
    return Object.entries(adjustedData)
      .sort((a, b) => b[1].monthly - a[1].monthly)
      .slice(0, 15)
      .map(([name, info]) => ({ name, new: Math.round(info.monthly) }))
  }, [adjustedData])

  // ─── Table data ─────────────────────────────────────────
  const tableData = useMemo(() => {
    if (!pricingData || !adjustedData) return []
    let entries = Object.entries(adjustedData).map(([code, adj]) => {
      const base = pricingData[code]?.monthly || 0
      const newVal = adj.monthly
      const diff = newVal - base
      const pct = base > 0 ? (diff / base) * 100 : 0
      const compAdj = adjustments.companies[code] || 0
      return { code, group: adj.group, base, newVal, diff, pct, compAdj }
    })

    if (tableSearch) {
      const q = tableSearch.toLowerCase()
      entries = entries.filter((e) => e.code.toLowerCase().includes(q) || e.group.toLowerCase().includes(q))
    }

    entries.sort((a, b) => {
      let cmp = 0
      if (tableSortCol === "group") {
        const ai = GROUP_ORDER.indexOf(a.group)
        const bi = GROUP_ORDER.indexOf(b.group)
        cmp = (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        if (cmp === 0) cmp = a.code.localeCompare(b.code)
      } else if (tableSortCol === "code") cmp = a.code.localeCompare(b.code)
      else if (tableSortCol === "base") cmp = a.base - b.base
      else if (tableSortCol === "new") cmp = a.newVal - b.newVal
      else if (tableSortCol === "diff") cmp = a.diff - b.diff
      else if (tableSortCol === "pct") cmp = a.pct - b.pct
      return tableSortDir === "asc" ? cmp : -cmp
    })
    return entries
  }, [pricingData, adjustedData, tableSearch, tableSortCol, tableSortDir, adjustments])

  const toggleSort = (col: string) => {
    if (tableSortCol === col) setTableSortDir((d) => d === "asc" ? "desc" : "asc")
    else { setTableSortCol(col); setTableSortDir("asc") }
  }

  // ─── Adjustment helpers ─────────────────────────────────
  const updateAdj = (fn: (prev: PricingAdjustments) => PricingAdjustments) => {
    setAdj((prev) => fn({ ...prev }))
  }

  const resetAll = () => setAdj(emptyAdjustments())

  // ─── Export ─────────────────────────────────────────────
  const handleExport = async () => {
    setExportLoading(true)
    try {
      const res = await fetch("/api/v1/pricing/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers } as any,
        body: JSON.stringify({
          template: exportTemplate,
          adjustments,
          effective_date: exportDate || null,
        }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "export.xlsx"
        a.click()
        URL.revokeObjectURL(url)
        setExportOpen(false)
      }
    } catch { /* ignore */ }
    finally { setExportLoading(false) }
  }

  // ─── Edit tab: save company ─────────────────────────────
  const saveCompanyPricing = async (code: string, categories: Record<string, CategoryValue>) => {
    setSaving(true)
    try {
      await fetch(`/api/v1/pricing/company/${encodeURIComponent(code)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers } as any,
        body: JSON.stringify({ categories }),
      })
      await fetchData()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const deleteCompany = async (code: string) => {
    if (!confirm(tp("confirmDeleteCompany", { code }))) return
    await fetch(`/api/v1/pricing/delete/${encodeURIComponent(code)}`, {
      method: "DELETE",
      headers: headers as any,
    })
    setSelectedCompany(null)
    await fetchData()
  }

  // ─── Loading state ──────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <DollarSign className="h-6 w-6" /> {tp("title")}
        </h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  if (!pricingData || !adjustedData) {
    return <div className="text-center py-20 text-muted-foreground">{tp("noData")}</div>
  }

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 data-tour-id="pricing-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">{tp("title")} <TourReplayButton tourId="pricing" /><HelpButton slug="pricing" variant="label" /></h1>
          <PageDescription text={tp("pageDescription")} />
        </div>
        <div data-tour-id="pricing-tabs" className="flex gap-2">
          <Button
            variant={activeTab === "model" ? "default" : "outline"}
            onClick={() => setActiveTab("model")}
            className="gap-1"
          >
            {tp("tabModel")} <InfoHint text={tp("hintTabPricing")} size={12} />
          </Button>
          <Button
            variant={activeTab === "edit" ? "default" : "outline"}
            onClick={() => setActiveTab("edit")}
            className="gap-1"
          >
            {tp("tabEdit")} <InfoHint text={tp("hintTabEdit")} size={12} />
          </Button>
          <Button
            variant={activeTab === "sales" ? "default" : "outline"}
            onClick={() => setActiveTab("sales")}
            className="gap-1"
          >
            {tp("tabSales")} <InfoHint text={tp("hintTabSales")} size={12} />
          </Button>
          <div className="relative">
            <Button variant="outline" onClick={() => setExportOpen(!exportOpen)}>
              <Download className="h-4 w-4 mr-1" /> {tp("tabExport")}
            </Button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-2 z-50 bg-card border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-4 w-72 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{tp("templateLabel")}</label>
                  <select
                    value={exportTemplate}
                    onChange={(e) => setExportTemplate(e.target.value)}
                    className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                  >
                    <option value="1">Template 1 — SALES</option>
                    <option value="2">Template 2 — CFO Report</option>
                    <option value="budget">Budget P&L</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{tp("effectiveDate")}</label>
                  <input
                    type="date"
                    value={exportDate}
                    onChange={(e) => setExportDate(e.target.value)}
                    className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                  />
                </div>
                <Button onClick={handleExport} disabled={exportLoading} className="w-full">
                  {exportLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
                  {tp("download")}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB 1: PRICE MODEL
          ══════════════════════════════════════════════════════ */}
      {activeTab === "model" && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ColorStatCard
              label={tp("kpiTotalMonthly")}
              value={`${baseTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${getCurrencySymbol()}`}
              icon={<DollarSign className="h-4 w-4" />}
             
            />
            <ColorStatCard
              label={tp("kpiForecastMonthly")}
              value={`${adjTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${getCurrencySymbol()}`}
              icon={<TrendingUp className="h-4 w-4" />}
             
            />
            <ColorStatCard
              label={tp("kpiAnnualEffect")}
              value={`${annualEffect.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${getCurrencySymbol()}`}
              icon={<BarChart3 className="h-4 w-4" />}
            />
            <ColorStatCard
              label={tp("kpiAvgAdjustment")}
              value={`${avgChange.toFixed(2)}%`}
              icon={<ArrowRight className="h-4 w-4" />}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
            {/* Left column: Sliders */}
            <div className="space-y-4">
              {/* Global slider */}
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <AdjSlider
                    label={tp("globalAdjustment")}
                    value={adjustments.global}
                    onChange={(v) => updateAdj((a) => ({ ...a, global: v }))}
                  />
                  <Button variant="outline" size="sm" className="w-full" onClick={resetAll}>
                    <RotateCcw className="h-3 w-3 mr-1" /> {tp("reset")}
                  </Button>
                </CardContent>
              </Card>

              {/* Group sliders */}
              <CollapsibleSection title={`${tp("groupAdjustment")} (${Object.keys(groupCounts).length})`} defaultOpen>
                {GROUP_ORDER.filter((g) => groupCounts[g]).map((group) => (
                  <AdjSlider
                    key={group}
                    label={group}
                    count={groupCounts[group]}
                    value={adjustments.groups[group] || 0}
                    onChange={(v) => updateAdj((a) => ({
                      ...a,
                      groups: { ...a.groups, [group]: v },
                    }))}
                    datePicker
                    dateValue={adjustments.group_dates[group] || ""}
                    onDateChange={(d) => updateAdj((a) => ({
                      ...a,
                      group_dates: { ...a.group_dates, [group]: d },
                    }))}
                  />
                ))}
              </CollapsibleSection>

              {/* Category sliders */}
              <CollapsibleSection title={`${tp("categoryAdjustment")} (${allCategories.length})`}>
                {allCategories.map((cat) => (
                  <AdjSlider
                    key={cat}
                    label={cat}
                    value={adjustments.categories[cat] || 0}
                    onChange={(v) => updateAdj((a) => ({
                      ...a,
                      categories: { ...a.categories, [cat]: v },
                    }))}
                    datePicker
                    dateValue={adjustments.category_dates[cat] || ""}
                    onDateChange={(d) => updateAdj((a) => ({
                      ...a,
                      category_dates: { ...a.category_dates, [cat]: d },
                    }))}
                  />
                ))}
              </CollapsibleSection>

              {/* Company sliders */}
              <CollapsibleSection title={`${tp("companyAdjustment")} (${Object.keys(pricingData).length})`}>
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={tp("searchCompany")}
                    value={compSliderSearch}
                    onChange={(e) => setCompSliderSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
                {GROUP_ORDER.map((group) => {
                  const comps = Object.entries(pricingData)
                    .filter(([, info]) => info.group === group)
                    .filter(([code]) => !compSliderSearch || code.toLowerCase().includes(compSliderSearch.toLowerCase()))
                    .sort((a, b) => a[0].localeCompare(b[0]))
                  if (comps.length === 0) return null
                  return (
                    <div key={group} className="space-y-2">
                      <div className="text-xs font-semibold text-primary mt-2">{group} ({comps.length})</div>
                      {comps.map(([code]) => (
                        <AdjSlider
                          key={code}
                          label={code}
                          value={adjustments.companies[code] || 0}
                          onChange={(v) => updateAdj((a) => ({
                            ...a,
                            companies: { ...a.companies, [code]: v },
                          }))}
                          datePicker
                          dateValue={adjustments.company_dates[code] || ""}
                          onDateChange={(d) => updateAdj((a) => ({
                            ...a,
                            company_dates: { ...a.company_dates, [code]: d },
                          }))}
                        />
                      ))}
                    </div>
                  )
                })}
              </CollapsibleSection>
            </div>

            {/* Right column: Charts + Table */}
            <div className="space-y-6">
              {/* Charts row */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Revenue by group */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{tp("revenueByGroups")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={groupChartData} layout="vertical" margin={{ left: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                        <YAxis dataKey="name" type="category" width={75} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={((v: number) => `${v.toLocaleString()} ${getCurrencySymbol()}`) as any} />
                        <Legend />
                        <Bar dataKey="base" name={tp("chartBase")} fill="#8B95A5" barSize={12} />
                        <Bar dataKey="new" name={tp("chartNew")} fill="#2D4A7A" barSize={12} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Revenue by category */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{tp("revenueByCategories")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={catChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={85}
                          dataKey="value"
                          labelLine={false}
                        >
                          {catChartData.map((_, i) => (
                            <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={((v: number) => `${v.toLocaleString()} ${getCurrencySymbol()}`) as any} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
                      {catChartData.map((item, i) => {
                        const total = catChartData.reduce((s, c) => s + c.value, 0)
                        const pct = total > 0 ? ((item.value / total) * 100).toFixed(0) : "0"
                        return (
                          <div key={i} className="flex items-center gap-1.5 text-xs">
                            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                            <span className="text-muted-foreground">{item.name}</span>
                            <span className="ml-auto font-mono font-medium text-foreground">{pct}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Top 15 companies */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{tp("top15Companies")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={topCompaniesData} layout="vertical" margin={{ left: 100 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <YAxis dataKey="name" type="category" width={95} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={((v: number) => `${v.toLocaleString()} ${getCurrencySymbol()}`) as any} />
                      <Legend />
                      <Bar dataKey="new" name={tp("chartNew")} fill="#2D4A7A" barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Companies table */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base">{tp("companiesTable")}</CardTitle>
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={tp("search")}
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      className="pl-8 h-9"
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-2 w-8">#</th>
                          {[
                            { key: "code", label: tp("company") },
                            { key: "group", label: tp("group") },
                            { key: "base", label: `${tp("base")} ${getCurrencySymbol()}` },
                            { key: "new", label: `${tp("new")} ${getCurrencySymbol()}` },
                            { key: "diff", label: `${tp("difference")} ${getCurrencySymbol()}` },
                            { key: "pct", label: "%" },
                          ].map(({ key, label }) => (
                            <th
                              key={key}
                              className="pb-2 pr-4 cursor-pointer hover:text-foreground select-none"
                              onClick={() => toggleSort(key)}
                            >
                              {label} {tableSortCol === key ? (tableSortDir === "asc" ? "↑" : "↓") : ""}
                            </th>
                          ))}
                          <th className="pb-2 text-center w-40">{tp("companyTableAdjustment")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableData.map((row, i) => (
                          <tr key={row.code} className="border-b last:border-0 hover:bg-muted/50">
                            <td className="py-2 pr-2 text-muted-foreground">{i + 1}</td>
                            <td className="py-2 pr-4 font-medium">{row.code}</td>
                            <td className="py-2 pr-4">{row.group}</td>
                            <td className="py-2 pr-4 text-right font-mono">{row.base.toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}</td>
                            <td className="py-2 pr-4 text-right font-mono font-medium">{row.newVal.toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}</td>
                            <td className={`py-2 pr-4 text-right font-mono ${row.diff >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {row.diff >= 0 ? "+" : ""}{row.diff.toLocaleString(undefined, { maximumFractionDigits: 0 })} {getCurrencySymbol()}
                            </td>
                            <td className={`py-2 pr-4 text-right font-mono ${row.pct >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {row.pct.toFixed(1)}%
                            </td>
                            <td className="py-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min={-50}
                                  max={50}
                                  value={row.compAdj}
                                  onChange={(e) => {
                                    const v = parseInt(e.target.value)
                                    updateAdj((a) => ({
                                      ...a,
                                      companies: { ...a.companies, [row.code]: v },
                                    }))
                                  }}
                                  className="w-20 h-1.5 accent-purple-600"
                                />
                                <span className="text-xs font-mono w-10 text-right">{row.compAdj}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB 2: EDIT PRICES
          ══════════════════════════════════════════════════════ */}
      {activeTab === "edit" && (
        <div>
          <p className="text-sm text-muted-foreground mb-4">
            {tp("editDescription")}
          </p>
          <div className="grid grid-cols-[280px_1fr] gap-6">
            {/* Company list */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tp("searchCompany")}
                  value={editSearch}
                  onChange={(e) => setEditSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg max-h-[calc(100vh-250px)] overflow-y-auto">
                {GROUP_ORDER.map((group) => {
                  const comps = Object.entries(pricingData)
                    .filter(([, info]) => info.group === group)
                    .filter(([code]) => !editSearch || code.toLowerCase().includes(editSearch.toLowerCase()))
                    .sort((a, b) => a[0].localeCompare(b[0]))
                  if (comps.length === 0) return null
                  return (
                    <div key={group}>
                      <div className="text-xs font-semibold text-primary px-3 py-1.5 bg-primary/5 sticky top-0">
                        {group} ({comps.length})
                      </div>
                      {comps.map(([code, info]) => (
                        <button
                          key={code}
                          onClick={() => {
                            setSelectedCompany(code)
                            setExpandedCats(new Set())
                          }}
                          className={`w-full text-left px-3 py-2 hover:bg-muted/50 border-b text-sm ${
                            selectedCompany === code ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
                          }`}
                        >
                          <div className="font-medium">{code}</div>
                          <div className="text-xs text-muted-foreground">
                            {info.monthly.toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}/ay
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Company editor */}
            <div>
              {!selectedCompany ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-lg">
                  {tp("selectCompanyToEdit")}
                </div>
              ) : (
                <CompanyEditor
                  code={selectedCompany}
                  data={pricingData[selectedCompany]}
                  onSave={(cats) => saveCompanyPricing(selectedCompany, cats)}
                  onDelete={() => deleteCompany(selectedCompany)}
                  saving={saving}
                  expandedCats={expandedCats}
                  setExpandedCats={setExpandedCats}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB 3: ADDITIONAL SALES (ДОПРОДАЖИ)
          ══════════════════════════════════════════════════════ */}
      {activeTab === "sales" && (
        <div className="space-y-4">
          {/* Header with filters and add button */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tp("search")}
                  value={salesSearch}
                  onChange={(e) => setSalesSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              <select
                value={salesFilter.type}
                onChange={(e) => setSalesFilter({ ...salesFilter, type: e.target.value })}
                className="h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm"
              >
                <option value="all">{tp("allTypes")}</option>
                <option value="recurring">{tp("monthlyMRRFilter")}</option>
                <option value="one_time">{tp("oneTimeFilter")}</option>
              </select>
              <select
                value={salesFilter.status}
                onChange={(e) => setSalesFilter({ ...salesFilter, status: e.target.value })}
                className="h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm"
              >
                <option value="all">{tp("allStatuses")}</option>
                <option value="active">{tp("statusActive")}</option>
                <option value="cancelled">{tp("statusCancelled")}</option>
                <option value="completed">{tp("statusCompleted")}</option>
              </select>
            </div>
            <Button onClick={() => setShowAddSale(true)}>
              <Plus className="h-4 w-4 mr-1" /> {tp("addSale")}
            </Button>
          </div>

          {/* Add sale form */}
          {showAddSale && (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="text-sm font-semibold">{tp("newSale")}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">{tp("companyRequired")}</label>
                    <select
                      value={newSale.profileId}
                      onChange={(e) => setNewSale({ ...newSale, profileId: e.target.value })}
                      className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                    >
                      <option value="">{tp("selectPlaceholder")}</option>
                      {profilesList.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.companyCode} ({p.group?.name})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{tp("typeRequired")}</label>
                    <select
                      value={newSale.type}
                      onChange={(e) => setNewSale({ ...newSale, type: e.target.value })}
                      className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                    >
                      <option value="recurring">{tp("monthlyMRR")}</option>
                      <option value="one_time">{tp("oneTime")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{tp("nameRequired")}</label>
                    <input
                      type="text"
                      value={newSale.name}
                      onChange={(e) => setNewSale({ ...newSale, name: e.target.value })}
                      className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                      placeholder={tp("saleDescription")}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{tp("category")}</label>
                    <input
                      type="text"
                      value={newSale.categoryName}
                      onChange={(e) => setNewSale({ ...newSale, categoryName: e.target.value })}
                      className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                      placeholder={tp("optional")}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{tp("unit")}</label>
                    <select
                      value={newSale.unit}
                      onChange={(e) => setNewSale({ ...newSale, unit: e.target.value })}
                      className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                    >
                      {UNIT_TYPES.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{tp("quantity")}</label>
                    <input
                      type="number"
                      value={newSale.qty}
                      onChange={(e) => setNewSale({ ...newSale, qty: parseInt(e.target.value) || 0 })}
                      className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{tp("pricePerUnit")}</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newSale.price}
                      onChange={(e) => setNewSale({ ...newSale, price: parseFloat(e.target.value) || 0 })}
                      className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{tp("startDate")}</label>
                    <input
                      type="date"
                      value={newSale.effectiveDate}
                      onChange={(e) => setNewSale({ ...newSale, effectiveDate: e.target.value })}
                      className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={async () => {
                      if (!newSale.profileId || !newSale.name || !newSale.effectiveDate) return
                      setSavingSale(true)
                      try {
                        await fetch("/api/v1/pricing/additional-sales", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", ...headers } as any,
                          body: JSON.stringify(newSale),
                        })
                        setShowAddSale(false)
                        setNewSale({ profileId: "", type: "recurring", name: "", description: "", categoryName: "", unit: "Per Device", qty: 1, price: 0, effectiveDate: new Date().toISOString().split("T")[0], endDate: "" })
                        fetchSales()
                      } catch { /* ignore */ }
                      finally { setSavingSale(false) }
                    }}
                    disabled={!newSale.profileId || !newSale.name || savingSale}
                  >
                    {savingSale ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                    {tp("create")}
                  </Button>
                  <Button variant="outline" onClick={() => setShowAddSale(false)}>{tp("cancel")}</Button>
                  {newSale.qty > 0 && newSale.price > 0 && (
                    <span className="text-sm text-muted-foreground ml-auto">
                      {tp("totalLabel")} <strong>{(newSale.qty * newSale.price).toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}</strong>
                      {newSale.type === "recurring" && <span className="text-green-600"> {tp("perMonth")}</span>}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Won deals not yet added to pricing */}
          {wonDeals.length > 0 && (
            <Card className="border-green-200 bg-green-50/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-green-800">
                  <Trophy className="h-4 w-4" />
                  {tp("wonDeals")} ({wonDeals.length})
                  <span className="text-xs font-normal text-green-600 ml-1">{tp("wonDealsNotAdded")}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-green-200 text-left text-green-700">
                        <th className="pb-2 pr-4">{tp("deal")}</th>
                        <th className="pb-2 pr-4">{tp("company")}</th>
                        <th className="pb-2 pr-4 text-right">{tp("amount")}</th>
                        <th className="pb-2 pr-4">{tp("date")}</th>
                        <th className="pb-2 w-40"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {wonDeals.map((deal: any) => (
                        <tr key={deal.id} className="border-b border-green-100 last:border-0 hover:bg-green-100/50">
                          <td className="py-2 pr-4 font-medium">{deal.name}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{deal.company?.name || "—"}</td>
                          <td className="py-2 pr-4 text-right font-mono font-medium">
                            {(deal.valueAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}
                          </td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">
                            {deal.createdAt ? formatDate(deal.createdAt, locale) : "—"}
                          </td>
                          <td className="py-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-100"
                              disabled={addingDealId === deal.id || !deal.companyId}
                              onClick={async () => {
                                if (!deal.companyId) return
                                setAddingDealId(deal.id)
                                try {
                                  const res = await fetch(`/api/v1/deals/${deal.id}/add-to-pricing`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", ...headers } as any,
                                    body: JSON.stringify({
                                      type: "recurring",
                                      name: deal.name,
                                      qty: 1,
                                      price: deal.valueAmount || 0,
                                      effectiveDate: new Date().toISOString().split("T")[0],
                                    }),
                                  })
                                  const json = await res.json()
                                  if (json.success) {
                                    fetchSales()
                                  } else {
                                    toast.error(json.error || tp("errorAdding"))
                                  }
                                } catch { /* ignore */ }
                                finally { setAddingDealId(null) }
                              }}
                            >
                              {addingDealId === deal.id ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              ) : (
                                <ArrowRight className="h-3 w-3 mr-1" />
                              )}
                              {!deal.companyId ? tp("noCompany") : tp("addToSales")}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {wonDealsLoading && wonDeals.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> {tp("loadingWonDeals")}
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ColorStatCard
              label={tp("totalSales")}
              value={String(salesData.length)}
              icon={<DollarSign className="h-4 w-4" />}
             
            />
            <ColorStatCard
              label={tp("salesMRR")}
              value={`${salesData.filter((s) => s.type === "recurring" && s.status === "active").reduce((sum: number, s: any) => sum + s.total, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${getCurrencySymbol()}`}
              icon={<TrendingUp className="h-4 w-4" />}
             
            />
            <ColorStatCard
              label={tp("oneTimeSales")}
              value={`${salesData.filter((s) => s.type === "one_time").reduce((sum: number, s: any) => sum + s.total, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${getCurrencySymbol()}`}
              icon={<DollarSign className="h-4 w-4" />}
             
            />
            <ColorStatCard
              label={tp("activeSales")}
              value={String(salesData.filter((s) => s.status === "active").length)}
              icon={<Trophy className="h-4 w-4" />}
             
            />
          </div>

          {/* Sales table */}
          <Card>
            <CardContent className="pt-4">
              {salesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-2 w-8">#</th>
                        <th className="pb-2 pr-4">{tp("company")}</th>
                        <th className="pb-2 pr-4">{tp("type")}</th>
                        <th className="pb-2 pr-4">{tp("name")}</th>
                        <th className="pb-2 pr-4">{tp("category")}</th>
                        <th className="pb-2 pr-4 text-right">{tp("quantity")}</th>
                        <th className="pb-2 pr-4 text-right">{tp("price")}</th>
                        <th className="pb-2 pr-4 text-right">{tp("totalLabel")}</th>
                        <th className="pb-2 pr-4">{tp("date")}</th>
                        <th className="pb-2 pr-4">{tp("status")}</th>
                        <th className="pb-2 w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesData
                        .filter((s) => salesFilter.type === "all" || s.type === salesFilter.type)
                        .filter((s) => salesFilter.status === "all" || s.status === salesFilter.status)
                        .filter((s) => !salesSearch || s.name?.toLowerCase().includes(salesSearch.toLowerCase()) || s.profile?.companyCode?.toLowerCase().includes(salesSearch.toLowerCase()))
                        .map((sale: any, i: number) => (
                          <tr key={sale.id} className="border-b last:border-0 hover:bg-muted/50">
                            <td className="py-2 pr-2 text-muted-foreground">{i + 1}</td>
                            <td className="py-2 pr-4 font-medium">
                              {sale.profile?.companyCode || "—"}
                              {sale.profile?.company?.name && (
                                <div className="text-xs text-muted-foreground">{sale.profile.company.name}</div>
                              )}
                            </td>
                            <td className="py-2 pr-4">
                              {sale.type === "recurring" ? (
                                <Badge className="bg-green-100 text-green-800 hover:bg-green-100">MRR</Badge>
                              ) : (
                                <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{tp("oneTimeBadge")}</Badge>
                              )}
                            </td>
                            <td className="py-2 pr-4">{sale.name}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{sale.categoryName || "—"}</td>
                            <td className="py-2 pr-4 text-right font-mono">{sale.qty}</td>
                            <td className="py-2 pr-4 text-right font-mono">{sale.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}</td>
                            <td className="py-2 pr-4 text-right font-mono font-medium">{sale.total?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}</td>
                            <td className="py-2 pr-4 text-xs">
                              {sale.effectiveDate ? formatDate(sale.effectiveDate, locale) : "—"}
                            </td>
                            <td className="py-2 pr-4">
                              {sale.status === "active" && <Badge variant="outline" className="text-green-600 border-green-300">{tp("statusActive")}</Badge>}
                              {sale.status === "cancelled" && <Badge variant="outline" className="text-red-600 border-red-300">{tp("statusCancelled")}</Badge>}
                              {sale.status === "completed" && <Badge variant="outline" className="text-muted-foreground border-zinc-200 dark:border-zinc-700">{tp("statusCompleted")}</Badge>}
                            </td>
                            <td className="py-2">
                              <button
                                onClick={async () => {
                                  if (!confirm(tp("confirmDeleteSale"))) return
                                  await fetch(`/api/v1/pricing/additional-sales/${sale.id}`, {
                                    method: "DELETE",
                                    headers: headers as any,
                                  })
                                  fetchSales()
                                }}
                                className="text-red-400 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {salesData.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      {tp("noSalesYet")}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

// ─── Unit types ─────────────────────────────────────────────
const UNIT_TYPES = [
  "Per Device", "Per Systems", "Per Company", "Per User", "Per VM",
  "Per 2 vCPU", "Per GB", "Per Resource", "Project based", "Man/Day",
  "Hourly", "Hourly Rates",
]

// ─── Company Editor Component ───────────────────────────────
function CompanyEditor({ code, data, onSave, onDelete, saving, expandedCats, setExpandedCats }: {
  code: string
  data: PricingCompany
  onSave: (cats: Record<string, CategoryValue>) => void
  onDelete: () => void
  saving: boolean
  expandedCats: Set<string>
  setExpandedCats: (s: Set<string>) => void
}) {
  const tp = useTranslations("pricing")
  const [localCats, setLocalCats] = useState(data.categories)
  const [originalCats, setOriginalCats] = useState(data.categories)
  const [hasChanges, setHasChanges] = useState(false)

  // Add category dialog
  const [showAddCat, setShowAddCat] = useState(false)
  const [newCatName, setNewCatName] = useState("")

  // Add service form (per category)
  const [addingServiceCat, setAddingServiceCat] = useState<string | null>(null)
  const [newSvc, setNewSvc] = useState({ name: "", unit: "Per Device", qty: 1, price: 0 })
  const addSvcFormRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (addingServiceCat) {
      const t = setTimeout(() => {
        addSvcFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      }, 100)
      return () => clearTimeout(t)
    }
  }, [addingServiceCat])

  useEffect(() => {
    setLocalCats(data.categories)
    setOriginalCats(data.categories)
    setHasChanges(false)
  }, [code, data])

  const toggleCat = (cat: string) => {
    const next = new Set(expandedCats)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    setExpandedCats(next)
  }

  const markChanged = (cats: Record<string, CategoryValue>) => {
    setLocalCats(cats)
    setHasChanges(true)
  }

  const updateService = (cat: string, svcIdx: number, field: "qty" | "price", value: number) => {
    const catVal = localCats[cat]
    if (typeof catVal !== "object" || !("services" in catVal)) return
    const newServices = [...catVal.services]
    newServices[svcIdx] = { ...newServices[svcIdx], [field]: value, total: field === "qty" ? value * newServices[svcIdx].price : newServices[svcIdx].qty * value }
    const newTotal = newServices.reduce((s, svc) => s + svc.total, 0)
    markChanged({ ...localCats, [cat]: { total: Math.round(newTotal * 100) / 100, services: newServices } })
  }

  const deleteService = (cat: string, svcIdx: number) => {
    const catVal = localCats[cat]
    if (typeof catVal !== "object" || !("services" in catVal)) return
    const newServices = catVal.services.filter((_, i) => i !== svcIdx)
    const newTotal = newServices.reduce((s, svc) => s + svc.total, 0)
    markChanged({ ...localCats, [cat]: { total: Math.round(newTotal * 100) / 100, services: newServices } })
  }

  const addService = (cat: string) => {
    const catVal = localCats[cat]
    if (!newSvc.name.trim()) return
    const total = newSvc.qty * newSvc.price
    const svc = { name: newSvc.name.trim(), unit: newSvc.unit, qty: newSvc.qty, price: newSvc.price, total }

    if (typeof catVal === "object" && "services" in catVal) {
      const newServices = [...catVal.services, svc]
      const newTotal = newServices.reduce((s, s2) => s + s2.total, 0)
      markChanged({ ...localCats, [cat]: { total: Math.round(newTotal * 100) / 100, services: newServices } })
    } else {
      markChanged({ ...localCats, [cat]: { total, services: [svc] } })
    }
    setAddingServiceCat(null)
    setNewSvc({ name: "", unit: "Per Device", qty: 1, price: 0 })
  }

  const addCategory = () => {
    if (!newCatName.trim() || newCatName.trim() in localCats) return
    markChanged({ ...localCats, [newCatName.trim()]: { total: 0, services: [] } })
    setShowAddCat(false)
    setNewCatName("")
  }

  const deleteCategory = (cat: string) => {
    if (!confirm(tp("confirmDeleteCategory", { cat }))) return
    const newCats = { ...localCats }
    delete newCats[cat]
    markChanged(newCats)
  }

  const handleSave = () => {
    onSave(localCats)
    setOriginalCats(localCats)
    setHasChanges(false)
  }

  const handleCancel = () => {
    setLocalCats(originalCats)
    setHasChanges(false)
  }

  const handleReset = () => {
    setLocalCats(data.categories)
    setOriginalCats(data.categories)
    setHasChanges(false)
  }

  const monthly = Object.values(localCats).reduce<number>((s, v) => s + catTotal(v), 0)
  const annual = monthly * 12

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">{code}</h2>
          <Badge>{data.group}</Badge>
          <button onClick={onDelete} className="text-red-400 hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
          {saving && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">{tp("totalMonthly")}</div>
          <div className="text-xl font-bold text-green-600">
            {monthly.toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}
          </div>
          <div className="text-xs text-muted-foreground">
            {tp("annually", { amount: `${annual.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${getCurrencySymbol()}` })}
          </div>
        </div>
      </div>

      {/* Save / Cancel / Reset buttons */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={!hasChanges || saving}>
          <Save className="h-3.5 w-3.5 mr-1" /> {tp("save")}
        </Button>
        <Button size="sm" variant="outline" onClick={handleCancel} disabled={!hasChanges}>
          <X className="h-3.5 w-3.5 mr-1" /> {tp("cancel")}
        </Button>
        <Button size="sm" variant="ghost" onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> {tp("reset")}
        </Button>
        {hasChanges && <span className="text-xs text-amber-600 ml-2">{tp("unsavedChanges")}</span>}
      </div>

      <div className="space-y-2">
        {Object.entries(localCats).map(([cat, val]) => {
          const total = catTotal(val)
          const isExpanded = expandedCats.has(cat)
          const hasServices = typeof val === "object" && "services" in val && val.services.length > 0

          return (
            <div key={cat} className="border border-zinc-200 dark:border-zinc-700 rounded-lg">
              <div className="flex items-center justify-between p-3 hover:bg-muted/50">
                <button
                  onClick={() => toggleCat(cat)}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="text-sm">{cat}</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-mono font-medium ${total > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                    {total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setAddingServiceCat(addingServiceCat === cat ? null : cat); setExpandedCats(new Set([...expandedCats, cat])) }}
                    className="text-primary hover:text-primary/80 p-1"
                    title={tp("addService")}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteCategory(cat) }}
                    className="text-red-400 hover:text-red-600 p-1"
                    title={tp("deleteCategory")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="px-3 pb-3">
                  {hasServices && typeof val === "object" && "services" in val && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground text-xs">
                          <th className="text-left pb-1">{tp("service")}</th>
                          <th className="text-center pb-1 w-24">{tp("unit")}</th>
                          <th className="text-center pb-1 w-20">{tp("quantity")}</th>
                          <th className="text-center pb-1 w-24">{tp("pricePerUnit")}</th>
                          <th className="text-right pb-1 w-24">{tp("totalLabel")}</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {val.services.map((svc, si) => (
                          <tr key={si} className="border-t">
                            <td className="py-1.5 pr-2">{svc.name}</td>
                            <td className="py-1.5 text-center text-xs text-muted-foreground">{svc.unit}</td>
                            <td className="py-1.5">
                              <input
                                type="number"
                                value={svc.qty}
                                onChange={(e) => updateService(cat, si, "qty", parseFloat(e.target.value) || 0)}
                                className="w-16 h-7 text-center border border-zinc-200 dark:border-zinc-700 rounded text-sm mx-auto block"
                              />
                            </td>
                            <td className="py-1.5">
                              <input
                                type="number"
                                step="0.01"
                                value={svc.price}
                                onChange={(e) => updateService(cat, si, "price", parseFloat(e.target.value) || 0)}
                                className="w-20 h-7 text-center border border-zinc-200 dark:border-zinc-700 rounded text-sm mx-auto block"
                              />
                            </td>
                            <td className="py-1.5 text-right font-mono">
                              {svc.total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}
                            </td>
                            <td className="py-1.5 text-center">
                              <button
                                onClick={() => deleteService(cat, si)}
                                className="text-red-400 hover:text-red-600"
                                title={tp("deleteService")}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* Add service form */}
                  {addingServiceCat === cat && (
                    <div ref={addSvcFormRef} className="mt-2 p-3 bg-blue-50 rounded-lg space-y-2 border border-blue-200">
                      <div className="text-xs font-semibold text-primary">{tp("newService")}</div>
                      <div className="grid grid-cols-[1fr_120px_70px_90px] gap-2">
                        <input
                          type="text"
                          placeholder={tp("serviceName")}
                          value={newSvc.name}
                          onChange={(e) => setNewSvc({ ...newSvc, name: e.target.value })}
                          className="h-8 px-2 border border-zinc-200 dark:border-zinc-700 rounded text-sm"
                        />
                        <select
                          value={newSvc.unit}
                          onChange={(e) => setNewSvc({ ...newSvc, unit: e.target.value })}
                          className="h-8 px-1 border border-zinc-200 dark:border-zinc-700 rounded text-xs"
                        >
                          {UNIT_TYPES.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <input
                          type="number"
                          placeholder={tp("quantity")}
                          value={newSvc.qty}
                          onChange={(e) => setNewSvc({ ...newSvc, qty: parseInt(e.target.value) || 0 })}
                          className="h-8 px-2 border border-zinc-200 dark:border-zinc-700 rounded text-sm text-center"
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder={tp("price")}
                          value={newSvc.price}
                          onChange={(e) => setNewSvc({ ...newSvc, price: parseFloat(e.target.value) || 0 })}
                          className="h-8 px-2 border border-zinc-200 dark:border-zinc-700 rounded text-sm text-center"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => addService(cat)} disabled={!newSvc.name.trim()}>
                          <Plus className="h-3 w-3 mr-1" /> {tp("add")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAddingServiceCat(null)}>
                          {tp("cancel")}
                        </Button>
                        {newSvc.qty > 0 && newSvc.price > 0 && (
                          <span className="text-xs text-muted-foreground self-center ml-auto">
                            {tp("totalLabel")} {(newSvc.qty * newSvc.price).toLocaleString(undefined, { maximumFractionDigits: 2 })} {getCurrencySymbol()}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {!hasServices && addingServiceCat !== cat && (
                    <div className="text-xs text-muted-foreground text-center py-2">{tp("noServices")}</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add category */}
      {showAddCat ? (
        <div className="p-3 bg-green-50 rounded-lg space-y-2 border border-green-200">
          <div className="text-xs font-semibold text-green-700">{tp("newCategory")}</div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={tp("categoryName")}
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="flex-1 h-8 px-2 border border-zinc-200 dark:border-zinc-700 rounded text-sm"
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
            />
            <Button size="sm" onClick={addCategory} disabled={!newCatName.trim()}>
              <Plus className="h-3 w-3 mr-1" /> {tp("add")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowAddCat(false); setNewCatName("") }}>
              {tp("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAddCat(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> {tp("addCategory")}
        </Button>
      )}
    </div>
  )
}
