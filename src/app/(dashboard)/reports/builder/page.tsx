"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Loader2,
  Plus,
  Trash2,
  Download,
  Save,
  FileSpreadsheet,
  BarChart3,
  Check,
  FolderOpen,
} from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
} from "recharts"
import type { XAxisProps } from "recharts"

// ---------------------------------------------------------------------------
// Entity field definitions — label keys mapped to translation keys
// ---------------------------------------------------------------------------

const ENTITY_FIELD_DEFS: Record<string, { name: string; tKey: string; type: string }[]> = {
  deals: [
    { name: "name", tKey: "fieldDealName", type: "string" },
    { name: "valueAmount", tKey: "fieldValue", type: "number" },
    { name: "stage", tKey: "fieldStage", type: "string" },
    { name: "probability", tKey: "fieldProbability", type: "number" },
    { name: "expectedClose", tKey: "fieldExpectedClose", type: "date" },
    { name: "assignedTo", tKey: "fieldAssignedTo", type: "string" },
    { name: "createdAt", tKey: "fieldCreated", type: "date" },
    { name: "company.name", tKey: "fieldCompanyName", type: "string" },
  ],
  contacts: [
    { name: "fullName", tKey: "fieldFullName", type: "string" },
    { name: "email", tKey: "fieldEmail", type: "string" },
    { name: "position", tKey: "fieldPosition", type: "string" },
    { name: "engagementScore", tKey: "fieldEngagement", type: "number" },
    { name: "source", tKey: "fieldSource", type: "string" },
    { name: "createdAt", tKey: "fieldCreated", type: "date" },
    { name: "company.name", tKey: "fieldCompanyName", type: "string" },
  ],
  companies: [
    { name: "name", tKey: "fieldCompanyName", type: "string" },
    { name: "industry", tKey: "fieldIndustry", type: "string" },
    { name: "status", tKey: "fieldStatus", type: "string" },
    { name: "annualRevenue", tKey: "fieldRevenue", type: "number" },
    { name: "employeeCount", tKey: "fieldEmployees", type: "number" },
    { name: "createdAt", tKey: "fieldCreated", type: "date" },
  ],
  leads: [
    { name: "contactName", tKey: "fieldLeadName", type: "string" },
    { name: "companyName", tKey: "fieldCompany", type: "string" },
    { name: "source", tKey: "fieldSource", type: "string" },
    { name: "status", tKey: "fieldStatus", type: "string" },
    { name: "estimatedValue", tKey: "fieldEstValue", type: "number" },
    { name: "score", tKey: "fieldScore", type: "number" },
    { name: "createdAt", tKey: "fieldCreated", type: "date" },
  ],
  tickets: [
    { name: "ticketNumber", tKey: "fieldTicketNumber", type: "string" },
    { name: "subject", tKey: "fieldSubject", type: "string" },
    { name: "priority", tKey: "fieldPriority", type: "string" },
    { name: "status", tKey: "fieldStatus", type: "string" },
    { name: "category", tKey: "fieldCategory", type: "string" },
    { name: "createdAt", tKey: "fieldCreated", type: "date" },
    { name: "contact.fullName", tKey: "fieldContactName", type: "string" },
  ],
  tasks: [
    { name: "title", tKey: "fieldTitle", type: "string" },
    { name: "status", tKey: "fieldStatus", type: "string" },
    { name: "priority", tKey: "fieldPriority", type: "string" },
    { name: "dueDate", tKey: "fieldDueDate", type: "date" },
    { name: "createdAt", tKey: "fieldCreated", type: "date" },
  ],
  activities: [
    { name: "type", tKey: "fieldType", type: "string" },
    { name: "subject", tKey: "fieldSubject", type: "string" },
    { name: "createdAt", tKey: "fieldCreated", type: "date" },
    { name: "contact.fullName", tKey: "fieldContact", type: "string" },
    { name: "company.name", tKey: "fieldCompany", type: "string" },
  ],
}

const ENTITY_KEYS = ["deals", "contacts", "companies", "leads", "tickets", "tasks", "activities"] as const

const CHART_COLORS = [
  "#6366f1", // indigo
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#f97316", // orange
  "#14b8a6", // teal
  "#e11d48", // rose
  "#3b82f6", // blue
  "#84cc16", // lime
  "#a855f7", // purple
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Filter {
  id: string
  field: string
  operator: string
  value: string
}

interface ReportConfig {
  entity: string
  columns: string[]
  filters: Filter[]
  groupBy: string
  sortBy: string
  sortOrder: "asc" | "desc"
  chartType: string
}

interface SavedReport {
  id: string
  name: string
  config: ReportConfig
  createdAt: string
}

interface PreviewData {
  rows: Record<string, unknown>[]
  total: number
  aggregates?: Record<string, number>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReportBuilderPage() {
  const tr = useTranslations("reportBuilder")

  // Translated operators, chart types, entities
  const operators = [
    { value: "eq", label: tr("opEquals") },
    { value: "neq", label: tr("opNotEquals") },
    { value: "gt", label: tr("opGreaterThan") },
    { value: "lt", label: tr("opLessThan") },
    { value: "contains", label: tr("opContains") },
    { value: "in", label: tr("opIn") },
    { value: "between", label: tr("opBetween") },
  ]
  const chartTypes = [
    { value: "table", label: tr("chartTable") },
    { value: "bar", label: tr("chartBar") },
    { value: "line", label: tr("chartLine") },
    { value: "pie", label: tr("chartPie") },
    { value: "area", label: tr("chartArea") },
  ]
  const entityOptions = ENTITY_KEYS.map(key => ({
    value: key,
    label: tr(`entity${key.charAt(0).toUpperCase() + key.slice(1)}` as any),
  }))

  // Build translated field labels
  const ENTITY_FIELDS = useMemo(() => {
    const result: Record<string, { name: string; label: string; type: string }[]> = {}
    for (const [entityKey, fieldDefs] of Object.entries(ENTITY_FIELD_DEFS)) {
      result[entityKey] = fieldDefs.map(f => ({
        name: f.name,
        label: tr(f.tKey as any),
        type: f.type,
      }))
    }
    return result
  }, [tr])

  // -- Config state --
  const [entity, setEntity] = useState("deals")
  const [columns, setColumns] = useState<string[]>(["name", "valueAmount", "stage"])
  const [filters, setFilters] = useState<Filter[]>([])
  const [groupBy, setGroupBy] = useState("")
  const [sortBy, setSortBy] = useState("")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")
  const [chartType, setChartType] = useState("table")

  // -- UI state --
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewData, setPreviewData] = useState<PreviewData | null>(null)
  const [savedReports, setSavedReports] = useState<SavedReport[]>([])
  const [savedReportsLoading, setSavedReportsLoading] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [reportName, setReportName] = useState("")
  const [editingReportId, setEditingReportId] = useState<string | null>(null)
  const [scheduleFreq, setScheduleFreq] = useState("")
  const [scheduleEmails, setScheduleEmails] = useState("")

  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const fields = useMemo(() => ENTITY_FIELDS[entity] || [], [entity, ENTITY_FIELDS])

  // When entity changes, pick smart default columns (2 string + 1 numeric for charts)
  useEffect(() => {
    const f = ENTITY_FIELDS[entity] || []
    const stringFields = f.filter(fd => fd.type === "string")
    const numericFields = f.filter(fd => fd.type === "number")
    const defaults: string[] = []
    // Pick first 2 string fields
    for (const sf of stringFields) {
      if (defaults.length >= 2) break
      defaults.push(sf.name)
    }
    // Pick first numeric field (important for charts)
    if (numericFields.length > 0) {
      defaults.push(numericFields[0].name)
    }
    // If still < 3, fill from remaining fields
    for (const fd of f) {
      if (defaults.length >= 3) break
      if (!defaults.includes(fd.name)) defaults.push(fd.name)
    }
    setColumns(defaults)
    setGroupBy("")
    setSortBy("")
    setFilters([])
  }, [entity, ENTITY_FIELDS])

  // -- Build config object --
  const buildConfig = useCallback(
    (): ReportConfig => ({
      entity,
      columns,
      filters,
      groupBy,
      sortBy,
      sortOrder,
      chartType,
    }),
    [entity, columns, filters, groupBy, sortBy, sortOrder, chartType],
  )

  // -- Debounced preview fetch --
  const fetchPreview = useCallback((cfg: ReportConfig) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        // Skip filters with empty values to avoid matching nothing
        const cleanConfig = {
          ...cfg,
          filters: cfg.filters.filter(f => f.value.trim() !== ""),
        }
        const res = await fetch("/api/v1/reports/builder/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cleanConfig),
        })
        if (res.ok) {
          const data = await res.json()
          setPreviewData(data)
        } else {
          setPreviewData(null)
        }
      } catch {
        setPreviewData(null)
      } finally {
        setLoading(false)
      }
    }, 600)
  }, [])

  // Trigger preview on config changes
  useEffect(() => {
    if (columns.length > 0) {
      fetchPreview(buildConfig())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, columns, filters, groupBy, sortBy, sortOrder, chartType])

  // -- Load saved reports --
  useEffect(() => {
    void (async () => {
      setSavedReportsLoading(true)
      try {
        const res = await fetch("/api/v1/reports/builder")
        if (res.ok) {
          const data = await res.json()
          setSavedReports(Array.isArray(data) ? data : data.reports ?? [])
        }
      } catch {
        // silent
      } finally {
        setSavedReportsLoading(false)
      }
    })()
  }, [])

  // -- Column toggle --
  const toggleColumn = (name: string) => {
    setColumns((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
    )
  }

  // -- Filter helpers --
  const addFilter = () => {
    setFilters((prev) => [
      ...prev,
      { id: crypto.randomUUID(), field: fields[0]?.name ?? "", operator: "eq", value: "" },
    ])
  }

  const updateFilter = (id: string, patch: Partial<Filter>) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  const removeFilter = (id: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== id))
  }

  // -- Save report --
  const handleSave = async () => {
    if (!reportName.trim()) return
    setSaving(true)
    try {
      const body: any = { name: reportName, config: buildConfig(), id: editingReportId }
      if (scheduleFreq) body.scheduleFreq = scheduleFreq
      if (scheduleEmails.trim()) body.scheduleEmails = scheduleEmails.split(",").map((e: string) => e.trim()).filter(Boolean)
      const res = await fetch("/api/v1/reports/builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const saved = await res.json()
        setSavedReports((prev) => {
          const idx = prev.findIndex((r) => r.id === saved.id)
          if (idx >= 0) {
            const copy = [...prev]
            copy[idx] = saved
            return copy
          }
          return [saved, ...prev]
        })
        setSaveDialogOpen(false)
        setReportName("")
        setEditingReportId(null)
      }
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  // -- Load report --
  const loadReport = (report: SavedReport) => {
    const c = report.config
    setEntity(c.entity)
    // Defer so entity useEffect fires first, then we overwrite
    setTimeout(() => {
      setColumns(c.columns)
      setFilters(c.filters)
      setGroupBy(c.groupBy)
      setSortBy(c.sortBy)
      setSortOrder(c.sortOrder)
      setChartType(c.chartType)
      setEditingReportId(report.id)
      setReportName(report.name)
      setScheduleFreq((report as any).scheduleFreq || "")
      setScheduleEmails(((report as any).scheduleEmails || []).join(", "))
    }, 50)
  }

  // -- Export --
  const handleExport = async (format: "csv" | "xlsx") => {
    try {
      const res = await fetch("/api/v1/reports/builder/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: buildConfig(), format }),
      })
      // A failed export used to do NOTHING: no else branch, and the catch was
      // empty. That is how a 400 on every single export survived unnoticed —
      // the button looked like it worked and the file just never appeared.
      if (!res.ok) {
        toast.error(tr("exportFailed"))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `report.${format === "xlsx" ? "xlsx" : "csv"}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(tr("exportFailed"))
    }
    setExportDialogOpen(false)
  }

  // -- Get label for a field name --
  const fieldLabel = (name: string) =>
    fields.find((f) => f.name === name)?.label ?? name

  // -- Render chart preview --
  const renderChart = () => {
    if (!previewData || previewData.rows.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            tr("noData")
          )}
        </div>
      )
    }

    const rows = previewData.rows

    if (chartType === "table") {
      return renderDataTable(rows, columns, fieldLabel)
    }

    // ----- Smart data preparation for charts -----
    const numericColFound = columns.find((c) => {
      const f = fields.find((fd) => fd.name === c)
      return f?.type === "number"
    })

    // If no numeric column selected, show hint
    if (!numericColFound) {
      const availableNumeric = fields.filter(f => f.type === "number")
      return (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
          <BarChart3 className="h-10 w-10 opacity-30" />
          <p className="text-sm">{tr("noNumericColumn" as any) || "Qrafik üçün ədədi sütun seçin"}</p>
          {availableNumeric.length > 0 && (
            <div className="flex gap-1.5 mt-1">
              {availableNumeric.map(f => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => setColumns(prev => [...prev, f.name])}
                  className="px-2.5 py-1 text-xs rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
                >
                  + {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )
    }

    const numericCol = numericColFound

    // For pie/bar without groupBy: auto-group by first string column (e.g. stage)
    const stringCols = columns.filter((c) => {
      const f = fields.find((fd) => fd.name === c)
      return f?.type === "string" && c !== numericCol
    })
    const shouldAutoGroup = !groupBy && (chartType === "pie" || rows.length > 10)
    const categoryCol = groupBy || (shouldAutoGroup ? stringCols[0] : undefined) || columns.find((c) => c !== numericCol) || columns[0]

    const truncate = (s: string, max = 18) => s.length > max ? s.slice(0, max) + "…" : s

    // Aggregate data by category (always for pie, auto for many rows)
    const buildAggregatedData = () => {
      const aggregated = new Map<string, number>()
      for (const row of rows) {
        const key = String(row[categoryCol] ?? "N/A")
        aggregated.set(key, (aggregated.get(key) ?? 0) + Number(row[numericCol] ?? 0))
      }
      return Array.from(aggregated.entries())
        .map(([key, val]) => ({ name: truncate(key), fullName: key, value: val }))
        .sort((a, b) => b.value - a.value)
    }

    // Raw data (one entry per row)
    const buildRawData = () =>
      rows.map((row) => ({
        name: truncate(String(row[categoryCol] ?? "N/A")),
        fullName: String(row[categoryCol] ?? "N/A"),
        value: Number(row[numericCol] ?? 0),
      }))

    let chartData: { name: string; fullName: string; value: number }[]

    if (chartType === "pie") {
      // Pie always aggregates + limits to 8 slices
      chartData = buildAggregatedData()
      if (chartData.length > 8) {
        const top = chartData.slice(0, 7)
        const otherValue = chartData.slice(7).reduce((sum, d) => sum + d.value, 0)
        top.push({ name: tr("other" as any) || "Digər", fullName: tr("other" as any) || "Digər", value: otherValue })
        chartData = top
      }
    } else if (shouldAutoGroup) {
      chartData = buildAggregatedData()
    } else {
      chartData = buildRawData()
    }

    // Sort: bar desc, line/area asc
    if (chartType === "bar") chartData = [...chartData].sort((a, b) => b.value - a.value)
    if (chartType === "line" || chartType === "area") chartData = [...chartData].sort((a, b) => a.value - b.value)

    // Limit bar/line/area to 15 items max for readability
    if (chartType !== "pie" && chartData.length > 15) {
      chartData = chartData.slice(0, 15)
    }

    const tooltipStyle = {
      backgroundColor: "hsl(var(--popover))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "8px",
      color: "hsl(var(--popover-foreground))",
    }

    const CustomTooltip = ({ active, payload }: any) => {
      if (!active || !payload?.length) return null
      const data = payload[0].payload
      return (
        <div style={tooltipStyle} className="px-3 py-2 shadow-lg">
          <p className="text-xs font-medium">{data.fullName}</p>
          <p className="text-sm font-bold">{Number(data.value).toLocaleString()}</p>
        </div>
      )
    }

    const needsAngle = chartData.length > 5
    const xAxisProps: XAxisProps = {
      dataKey: "name",
      className: "text-xs",
      angle: needsAngle ? -40 : 0,
      textAnchor: needsAngle ? "end" : "middle",
      height: needsAngle ? 90 : 35,
      interval: 0,
      tick: { fontSize: 10 },
    }

    if (chartType === "bar") {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData} margin={{ bottom: needsAngle ? 10 : 5, left: 10, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis {...xAxisProps} />
            <YAxis className="text-xs" tick={{ fontSize: 10 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {chartData.map((_, idx) => (
                <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartType === "line") {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData} margin={{ bottom: needsAngle ? 10 : 5, left: 10, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis {...xAxisProps} />
            <YAxis className="text-xs" tick={{ fontSize: 10 }} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#6366f1"
              strokeWidth={2.5}
              dot={{ r: 5, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }}
              activeDot={{ r: 7, fill: "#6366f1" }}
            />
          </LineChart>
        </ResponsiveContainer>
      )
    }

    if (chartType === "area") {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={chartData} margin={{ bottom: needsAngle ? 10 : 5, left: 10, right: 10 }}>
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis {...xAxisProps} />
            <YAxis className="text-xs" tick={{ fontSize: 10 }} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#6366f1"
              fill="url(#areaGradient)"
              strokeWidth={2.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      )
    }

    if (chartType === "pie") {
      const total = chartData.reduce((s, d) => s + d.value, 0)
      return (
        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              outerRadius={150}
              innerRadius={60}
              dataKey="value"
              nameKey="name"
              paddingAngle={3}
              label={({ name, percent }: { name?: string; percent?: number }) => {
                const p = (percent ?? 0) * 100
                if (p < 4) return "" // hide tiny slices
                return `${name ?? ""} ${p.toFixed(0)}%`
              }}
              labelLine={false}
            >
              {chartData.map((_, idx) => (
                <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      )
    }

    return null
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{tr("title")}<HelpButton slug="report-builder" variant="label" /></h1>
          <PageDescription text={tr("subtitle")} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExportDialogOpen(true)}
            disabled={!previewData || previewData.rows.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            {tr("export")}
          </Button>
          <Button size="sm" onClick={() => setSaveDialogOpen(true)}>
            <Save className="h-4 w-4 mr-1" />
            {tr("saveReport")}
          </Button>
        </div>
      </div>

      {/* Main layout: left config + right preview */}
      <div className="flex gap-4 items-start">
        {/* ============== LEFT PANEL ============== */}
        <div
          className="w-[350px] shrink-0 space-y-4 overflow-y-auto pr-1 pb-8 sticky top-4 scrollbar-thin"
          style={{ maxHeight: "calc(100vh - 80px)" }}
        >
          {/* Entity Selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{tr("entity")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
              >
                {entityOptions.map((ent) => (
                  <option key={ent.value} value={ent.value}>
                    {ent.label}
                  </option>
                ))}
              </Select>
            </CardContent>
          </Card>

          {/* Column Picker */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                {tr("columns")}{" "}
                <span className="text-muted-foreground font-normal">
                  ({columns.length} {tr("selected")})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {fields.map((f) => {
                  const selected = columns.includes(f.name)
                  return (
                    <button
                      key={f.name}
                      type="button"
                      onClick={() => toggleColumn(f.name)}
                      className={`inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-zinc-200 dark:border-zinc-700 bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                      {f.label}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{tr("filters")}</CardTitle>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={addFilter}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {tr("add")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {filters.length === 0 && (
                <p className="text-xs text-muted-foreground">{tr("noFilters")}</p>
              )}
              <div className="space-y-2">
                {filters.map((filter) => (
                  <div key={filter.id} className="flex items-end gap-1.5">
                    {/* Field */}
                    <div className="flex-1 min-w-0">
                      <Select
                        className="h-8 text-xs"
                        value={filter.field}
                        onChange={(e) =>
                          updateFilter(filter.id, { field: e.target.value })
                        }
                      >
                        {fields.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {/* Operator */}
                    <div className="w-[100px] shrink-0">
                      <Select
                        className="h-8 text-xs"
                        value={filter.operator}
                        onChange={(e) =>
                          updateFilter(filter.id, { operator: e.target.value })
                        }
                      >
                        {operators.map((op) => (
                          <option key={op.value} value={op.value}>
                            {op.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {/* Value */}
                    <Input
                      className="h-8 text-xs flex-1 min-w-0"
                      placeholder={tr("valuePlaceholder")}
                      value={filter.value}
                      onChange={(e) =>
                        updateFilter(filter.id, { value: e.target.value })
                      }
                    />
                    {/* Remove */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => removeFilter(filter.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Group By */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{tr("groupBy")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                <option value="">{tr("none")}</option>
                {fields.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </CardContent>
          </Card>

          {/* Sort By */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{tr("sortBy")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="">{tr("none")}</option>
                {fields.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.label}
                  </option>
                ))}
              </Select>
              {sortBy && (
                <Select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                >
                  <option value="asc">{tr("ascending")}</option>
                  <option value="desc">{tr("descending")}</option>
                </Select>
              )}
            </CardContent>
          </Card>

          {/* Chart Type */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{tr("chartType")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-1.5">
                {chartTypes.map((ct) => (
                  <button
                    key={ct.value}
                    type="button"
                    onClick={() => setChartType(ct.value)}
                    className={`rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1.5 text-xs font-medium transition-colors ${
                      chartType === ct.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-zinc-200 dark:border-zinc-700 bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {ct.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Saved Reports */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{tr("savedReports")}</CardTitle>
                {savedReportsLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {savedReports.length === 0 && !savedReportsLoading && (
                <p className="text-xs text-muted-foreground">{tr("noSavedReports")}</p>
              )}
              <div className="space-y-1.5">
                {savedReports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => loadReport(r)}
                    className="w-full flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-left text-xs hover:bg-muted transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-muted-foreground">
                        {r.config.entity} &middot;{" "}
                        {new Date(r.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ============== RIGHT PANEL ============== */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="text-xs text-muted-foreground">{tr("totalRecords")}</div>
                <div className="text-2xl font-bold">
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    (previewData?.total ?? 0)
                  )}
                </div>
              </CardContent>
            </Card>
            {previewData?.aggregates &&
              Object.entries(previewData.aggregates)
                .slice(0, 2)
                .map(([key, val]) => (
                  <Card key={key}>
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="text-xs text-muted-foreground capitalize">{key}</div>
                      <div className="text-2xl font-bold">
                        {typeof val === "number" ? val.toLocaleString() : val}
                      </div>
                    </CardContent>
                  </Card>
                ))}
            {/* Fill remaining slots when no aggregates */}
            {(!previewData?.aggregates ||
              Object.keys(previewData.aggregates).length === 0) && (
              <>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="text-xs text-muted-foreground">{tr("columns")}</div>
                    <div className="text-2xl font-bold">{columns.length}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="text-xs text-muted-foreground">{tr("filters")}</div>
                    <div className="text-2xl font-bold">{filters.length}</div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {/* Chart / Table */}
          <Card className="flex-1">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  {tr("preview")}
                  {loading && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-xs">
                    {entityOptions.find((e) => e.value === entity)?.label}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {chartTypes.find((c) => c.value === chartType)?.label}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>{renderChart()}</CardContent>
          </Card>

          {/* Data table below chart (when chart type is not "table") */}
          {chartType !== "table" && previewData && previewData.rows.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  {tr("dataTable")} ({previewData.rows.length} {tr("rows")})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderDataTable(previewData.rows, columns, fieldLabel, 300)}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ============== SAVE DIALOG ============== */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingReportId ? tr("updateReport") : tr("saveReport")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="report-name">{tr("reportName")}</Label>
              <Input
                id="report-name"
                placeholder="e.g. Monthly Deals Overview"
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">
                {entityOptions.find((e) => e.value === entity)?.label}
              </Badge>
              <Badge variant="outline">{columns.length} {tr("columnsLower")}</Badge>
              <Badge variant="outline">{filters.length} {tr("filtersLower")}</Badge>
              <Badge variant="outline">
                {chartTypes.find((c) => c.value === chartType)?.label}
              </Badge>
            </div>
            {/* Schedule section */}
            <div className="border-t pt-3 mt-1 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{tr("emailSchedule")}</p>
              <div>
                <Label htmlFor="schedule-freq" className="text-xs">{tr("frequency")}</Label>
                <Select
                  value={scheduleFreq}
                  onChange={(e) => setScheduleFreq(e.target.value)}
                  className="mt-1 h-8 text-xs"
                >
                  <option value="">{tr("noSchedule")}</option>
                  <option value="daily">{tr("daily")}</option>
                  <option value="weekly">{tr("weekly")}</option>
                  <option value="monthly">{tr("monthly")}</option>
                </Select>
              </div>
              {scheduleFreq && (
                <div>
                  <Label htmlFor="schedule-emails" className="text-xs">{tr("recipients")}</Label>
                  <Input
                    id="schedule-emails"
                    placeholder="user@example.com, team@company.com"
                    value={scheduleEmails}
                    onChange={(e) => setScheduleEmails(e.target.value)}
                    className="mt-1 h-8 text-xs"
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving || !reportName.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingReportId ? tr("update") : tr("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== EXPORT DIALOG ============== */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("exportReport")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <button
              type="button"
              onClick={() => handleExport("csv")}
              className="flex flex-col items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 hover:bg-muted transition-colors"
            >
              <FileSpreadsheet className="h-8 w-8 text-green-600" />
              <span className="text-sm font-medium">CSV</span>
              <span className="text-xs text-muted-foreground">
                {tr("csvDesc")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleExport("xlsx")}
              className="flex flex-col items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 hover:bg-muted transition-colors"
            >
              <FileSpreadsheet className="h-8 w-8 text-blue-600" />
              <span className="text-sm font-medium">Excel</span>
              <span className="text-xs text-muted-foreground">{tr("xlsxDesc")}</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return "-"
  if (typeof val === "number") return val.toLocaleString()
  if (typeof val === "boolean") return val ? "Yes" : "No"
  if (typeof val === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
      try {
        return new Date(val).toLocaleDateString()
      } catch {
        return val
      }
    }
    return val
  }
  return String(val)
}

function renderDataTable(
  rows: Record<string, unknown>[],
  columns: string[],
  fieldLabel: (name: string) => string,
  maxHeight = 500,
) {
  return (
    <div className="overflow-auto border border-zinc-200 dark:border-zinc-700 rounded-lg" style={{ maxHeight }}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                className="text-left px-3 py-2 font-medium text-muted-foreground border-b"
              >
                {fieldLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
              {columns.map((col) => (
                <td key={col} className="px-3 py-2">
                  {formatCellValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
