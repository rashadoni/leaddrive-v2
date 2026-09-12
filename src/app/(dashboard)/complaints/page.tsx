"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  Download,
  Filter,
  Loader2,
  MessageSquareWarning,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react"

import { DataTable } from "@/components/data-table"
import { HelpButton } from "@/components/help/help-button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  complaintChildHref,
  complaintRegistryPath,
  complaintScrollStorageKey,
} from "@/lib/complaints/workspace-state"

type ComplaintRow = {
  id: string
  ticketNumber: string
  subject: string
  status: string
  priority: string
  source: string | null
  assignedTo: string | null
  assigneeName?: string | null
  slaDueAt: string | null
  createdAt: string
  complaintMeta: {
    externalRegistryNumber: number | null
    complaintType: string
    brand: string | null
    productCategory: string | null
    complaintObject: string | null
    responsibleDepartment: string | null
    riskLevel: string | null
  } | null
  contact: { id: string; fullName: string | null; phone: string | null } | null
}

type Filters = {
  q: string
  brand: string
  productCategory: string
  riskLevel: string
  status: string
}

const riskStyles: Record<string, string> = {
  high: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
  medium: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  low: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
}

const statusStyles: Record<string, string> = {
  open: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300",
  in_progress: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  resolved: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  closed: "border-border bg-muted text-foreground",
  escalated: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
}

const localeMap: Record<string, string> = { ru: "ru-RU", en: "en-US", az: "az-AZ" }

export default function ComplaintsPage() {
  const t = useTranslations("complaints")
  const locale = useLocale()
  const dateLocale = localeMap[locale] || "en-US"
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [rows, setRows] = useState<ComplaintRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState("")
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")
  const [exportDone, setExportDone] = useState(false)
  const [filters, setFilters] = useState<Filters>(() => ({
    q: searchParams.get("q") || "",
    brand: searchParams.get("brand") || "",
    productCategory: searchParams.get("productCategory") || "",
    riskLevel: searchParams.get("riskLevel") || "",
    status: searchParams.get("status") || "",
  }))
  const [requestFilters, setRequestFilters] = useState(filters)

  const registryPath = useMemo(() => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    return complaintRegistryPath(params)
  }, [filters])
  const childHref = useCallback((path: string) => complaintChildHref(path, registryPath), [registryPath])
  const headers = useMemo<Record<string, string>>(
    (): Record<string, string> => orgId ? { "x-organization-id": String(orgId) } : {},
    [orgId],
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => setRequestFilters(filters), 250)
    router.replace(registryPath, { scroll: false })
    return () => window.clearTimeout(timeout)
  }, [filters, registryPath, router])

  const fetchRows = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: "200" })
    for (const [key, value] of Object.entries(requestFilters)) if (value) params.set(key, value)
    setRefreshing(true)
    setFetchError("")
    try {
      const res = await fetch(`/api/v1/complaints?${params.toString()}`, { headers, signal })
      const json = await res.json().catch(() => null)
      if (signal?.aborted) return
      if (!res.ok || !json?.success) {
        throw new Error(res.status === 403 ? t("permissionError") : t("fetchError"))
      }
      setRows(json.data.complaints || [])
      setTotal(json.data.total || 0)
    } catch (failure) {
      if (signal?.aborted) return
      setFetchError(failure instanceof Error ? failure.message : t("fetchError"))
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [headers, requestFilters, t])

  useEffect(() => {
    const controller = new AbortController()
    void fetchRows(controller.signal)
    return () => controller.abort()
  }, [fetchRows])

  useEffect(() => {
    if (loading) return
    try {
      const saved = sessionStorage.getItem(complaintScrollStorageKey(registryPath))
      const scroller = document.querySelector<HTMLElement>("main")
      if (saved && scroller) scroller.scrollTo({ top: Number(saved) || 0, behavior: "instant" })
    } catch {}
  }, [loading, registryPath])

  function openChild(path: string) {
    try {
      const scrollTop = document.querySelector<HTMLElement>("main")?.scrollTop ?? window.scrollY
      sessionStorage.setItem(complaintScrollStorageKey(registryPath), String(scrollTop))
    } catch {}
    router.push(childHref(path))
  }

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    setExportError("")
    setExportDone(false)
    try {
      const query = registryPath.split("?")[1]
      const res = await fetch(`/api/v1/complaints/export-xlsx${query ? `?${query}` : ""}`, { headers })
      if (!res.ok) {
        throw new Error(res.status === 403 ? t("permissionError") : t("exportError"))
      }
      const contentType = res.headers.get("content-type") || ""
      if (!contentType.includes("spreadsheetml")) throw new Error(t("exportError"))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `CRM-hesabat-${new Date().toISOString().slice(0, 10)}.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
      setExportDone(true)
      window.setTimeout(() => setExportDone(false), 3000)
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : t("exportError"))
    } finally {
      setExporting(false)
    }
  }

  const riskLabel = (value: string) => value === "high" ? t("riskHigh") : value === "medium" ? t("riskMedium") : value === "low" ? t("riskLow") : t("unknownRisk")
  const sourceLabel = (value: string | null) => value === "hotline" ? t("sourceHotline") : value === "email" ? t("sourceEmail") : value === "sales_rep" ? t("sourceSalesRep") : value === "whatsapp" ? t("sourceWhatsapp") : value === "instagram" ? t("sourceInstagram") : value === "facebook" ? t("sourceFacebook") : value === "web_chat" ? t("sourceWebChat") : t("unknownSource")
  const statusLabel = (value: string) => value === "open"
    ? t("statusOpen")
    : value === "in_progress"
      ? t("statusInProgress")
      : value === "resolved"
        ? t("statusResolved")
        : value === "closed"
          ? t("statusClosed")
          : value === "escalated" ? t("statusEscalated") : t("unknownStatus")
  const deadlineLabel = (value: string | null) => {
    if (!value) return { label: t("noDeadline"), overdue: false }
    const date = new Date(value)
    return {
      label: date.toLocaleDateString(dateLocale),
      overdue: date.getTime() < Date.now(),
    }
  }
  const activeFilters = (Object.entries(filters) as Array<[keyof Filters, string]>).filter(([, value]) => Boolean(value))
  const clearFilters = () => setFilters({ q: "", brand: "", productCategory: "", riskLevel: "", status: "" })
  const columns = [
    {
      key: "case",
      label: t("colComplaint"),
      render: (row: ComplaintRow) => (
        <div className="max-w-[22rem]">
          <span className="font-mono text-xs text-muted-foreground">#{row.complaintMeta?.externalRegistryNumber ?? row.ticketNumber}</span>
          <p className="truncate text-sm font-medium">{row.subject}</p>
        </div>
      ),
    },
    {
      key: "customer",
      label: t("colCustomer"),
      render: (row: ComplaintRow) => (
        <div className="max-w-44 text-sm">
          <p className="truncate">{row.contact?.fullName || t("unknownCustomer")}</p>
          <p className="truncate text-xs text-muted-foreground">{row.contact?.phone || t("noPhone")}</p>
        </div>
      ),
    },
    {
      key: "owner",
      label: t("colOwner"),
      render: (row: ComplaintRow) => <span className="text-xs">{row.assigneeName || t("unassigned")}</span>,
    },
    {
      key: "riskDeadline",
      label: t("colRiskDeadline"),
      render: (row: ComplaintRow) => {
        const deadline = deadlineLabel(row.slaDueAt)
        return (
          <div className="space-y-1">
            {row.complaintMeta?.riskLevel
              ? <Badge variant="outline" className={riskStyles[row.complaintMeta.riskLevel]}>{riskLabel(row.complaintMeta.riskLevel)}</Badge>
              : <span className="text-xs text-muted-foreground">{t("riskNotSet")}</span>}
            <p className={`text-xs ${deadline.overdue ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
              {deadline.overdue ? `${t("overdue")}: ` : ""}{deadline.label}
            </p>
          </div>
        )
      },
    },
    {
      key: "status",
      label: t("colStatus"),
      render: (row: ComplaintRow) => <Badge variant="outline" className={statusStyles[row.status] || ""}>{statusLabel(row.status)}</Badge>,
    },
    {
      key: "details",
      label: t("rowDetails"),
      render: (row: ComplaintRow) => (
        <details className="relative" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <summary className="min-h-11 cursor-pointer rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-9">
            {t("rowDetails")}
          </summary>
          <div className="mt-1 w-56 space-y-1 rounded-lg border bg-popover p-3 text-xs shadow-sm">
            <p><span className="text-muted-foreground">{t("colBrand")}:</span> {row.complaintMeta?.brand || "—"}</p>
            <p><span className="text-muted-foreground">{t("colProduct")}:</span> {row.complaintMeta?.productCategory || "—"}</p>
            <p><span className="text-muted-foreground">{t("colObject")}:</span> {row.complaintMeta?.complaintObject || "—"}</p>
            <p><span className="text-muted-foreground">{t("colDepartment")}:</span> {row.complaintMeta?.responsibleDepartment || "—"}</p>
            <p><span className="text-muted-foreground">{t("colSource")}:</span> {sourceLabel(row.source)}</p>
            <p><span className="text-muted-foreground">{t("colDate")}:</span> {new Date(row.createdAt).toLocaleDateString(dateLocale)}</p>
          </div>
        </details>
      ),
    },
  ]

  return (
    <SupportPageShell
      data-testid="complaints-workspace"
      width="fluid"
      title={t("title")}
      description={t("pageDescription")}
      leading={<MessageSquareWarning className="h-5 w-5" aria-hidden="true" />}
      utilities={<HelpButton slug="complaints" variant="icon" />}
      actions={<>
          <Popover>
            <PopoverTrigger asChild>
              <Button data-testid="complaints-secondary-actions" variant="outline" size="sm" className="h-11 sm:h-9" aria-label={t("secondaryActions")}>
                <MoreHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">{t("secondaryActions")}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-2 motion-reduce:animate-none">
              <button data-testid="complaints-open-import" type="button" className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => openChild("/complaints/import")}>
                <Upload className="h-4 w-4" />{t("importXlsx")}
              </button>
              <button data-testid="complaints-export" type="button" className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" disabled={exporting} onClick={() => void handleExport()}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Download className="h-4 w-4" />}
                {exporting ? t("exporting") : t("exportXlsx")}
              </button>
            </PopoverContent>
          </Popover>
          <Button data-testid="complaints-new" size="sm" className="h-11 sm:h-9" onClick={() => openChild("/complaints/new")}>
            <Plus className="h-4 w-4" />{t("newComplaint")}
          </Button>
        </>}
    >

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y py-2 text-xs text-muted-foreground" aria-label={t("registrySummary")}>
        <span><strong className="text-sm text-foreground">{total}</strong> {t("statTotal")}</span>
        <span aria-hidden="true">·</span>
        <span>{t("shownCount", { count: rows.length })}</span>
      </div>

      <div className="sticky top-16 z-20 space-y-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="complaints-search"
              aria-label={t("searchPlaceholder")}
              value={filters.q}
              onChange={event => setFilters(current => ({ ...current, q: event.target.value }))}
              placeholder={t("searchPlaceholder")}
              className="h-11 pl-9 sm:h-9"
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button data-testid="complaints-filter-trigger" variant="outline" size="sm" className="h-11 shrink-0 sm:h-9" aria-label={t("filters")}>
                <Filter className="h-4 w-4" />{t("filters")}
                {activeFilters.filter(([key]) => key !== "q").length > 0 && <Badge className="ml-1 h-5 min-w-5 px-1">{activeFilters.filter(([key]) => key !== "q").length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] space-y-3 motion-reduce:animate-none">
              <label className="grid gap-1 text-xs"><span>{t("filterBrand")}</span><Input value={filters.brand} onChange={event => setFilters(current => ({ ...current, brand: event.target.value }))} /></label>
              <label className="grid gap-1 text-xs"><span>{t("filterProduct")}</span><Input value={filters.productCategory} onChange={event => setFilters(current => ({ ...current, productCategory: event.target.value }))} /></label>
              <label className="grid gap-1 text-xs"><span>{t("colRisk")}</span><select className="h-11 rounded-md border bg-background px-3 text-sm sm:h-9" value={filters.riskLevel} onChange={event => setFilters(current => ({ ...current, riskLevel: event.target.value }))}><option value="">{t("filterAllRisks")}</option><option value="high">{t("riskHigh")}</option><option value="medium">{t("riskMedium")}</option><option value="low">{t("riskLow")}</option></select></label>
              <label className="grid gap-1 text-xs"><span>{t("colStatus")}</span><select className="h-11 rounded-md border bg-background px-3 text-sm sm:h-9" value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}><option value="">{t("filterAllStatuses")}</option><option value="open">{t("statusOpen")}</option><option value="in_progress">{t("statusInProgress")}</option><option value="resolved">{t("statusResolved")}</option><option value="closed">{t("statusClosed")}</option><option value="escalated">{t("statusEscalated")}</option></select></label>
              <Button type="button" variant="outline" size="sm" className="h-11 w-full sm:h-9" disabled={activeFilters.length === 0} onClick={clearFilters}>{t("resetFilters")}</Button>
            </PopoverContent>
          </Popover>
        </div>
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeFilters.map(([key, value]) => (
              <button key={key} type="button" className="inline-flex min-h-11 items-center gap-1 rounded-full border px-2.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" aria-label={`${t("removeFilter")}: ${value}`} onClick={() => setFilters(current => ({ ...current, [key]: "" }))}>
                <span className="max-w-40 truncate">{value}</span><X className="h-3 w-3" />
              </button>
            ))}
            <button type="button" className="min-h-11 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={clearFilters}>{t("resetFilters")}</button>
          </div>
        )}
      </div>

      {(fetchError || exportError || exportDone) && (
        <div className="space-y-2">
          {fetchError && <div data-testid="complaints-load-error" role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between"><span>{fetchError}</span><Button data-testid="complaints-retry-load" variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => void fetchRows()}><RefreshCw className="h-4 w-4" />{t("retry")}</Button></div>}
          {exportError && <div data-testid="complaints-export-error" role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between"><span>{exportError}</span><Button data-testid="complaints-retry-export" variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => void handleExport()}>{t("retryExport")}</Button></div>}
          {exportDone && <p data-testid="complaints-export-complete" role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{t("exportComplete")}</p>}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />{t("loading")}</div>
      ) : rows.length === 0 && !fetchError ? (
        <div data-testid="complaints-empty-state" className="rounded-xl border border-dashed px-4 py-10 text-center">
          <MessageSquareWarning className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">{activeFilters.length ? t("noResultsTitle") : t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{activeFilters.length ? t("noResultsHint") : t("emptyHint")}</p>
          <div className="mt-4 flex justify-center gap-2">
            {activeFilters.length > 0 && <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={clearFilters}>{t("resetFilters")}</Button>}
            <Button size="sm" className="h-11 sm:h-9" onClick={() => openChild("/complaints/new")}><Plus className="h-4 w-4" />{t("createShort")}</Button>
          </div>
        </div>
      ) : (
        <div data-testid="complaints-results" className="relative">
          {refreshing && <div role="status" className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border bg-background px-2 py-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />{t("refreshing")}</div>}
          <DataTable<Record<string, unknown>>
            columns={columns as unknown as Parameters<typeof DataTable<Record<string, unknown>>>[0]["columns"]}
            data={rows as unknown as Record<string, unknown>[]}
            hideSearch
            hideResultCount
            dense
            compact
            pageSize={50}
            onRowClick={row => openChild(`/complaints/${(row as unknown as ComplaintRow).id}`)}
            mobileCardRender={rowValue => {
              const row = rowValue as unknown as ComplaintRow
              const deadline = deadlineLabel(row.slaDueAt)
              return (
                <article className="rounded-xl border bg-card p-3">
                  <button type="button" className="min-h-11 w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => openChild(`/complaints/${row.id}`)}>
                    <span className="font-mono text-xs text-muted-foreground">#{row.complaintMeta?.externalRegistryNumber ?? row.ticketNumber}</span>
                    <span className="block line-clamp-2 text-sm font-medium">{row.subject}</span>
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={statusStyles[row.status] || ""}>{statusLabel(row.status)}</Badge>
                    {row.complaintMeta?.riskLevel && <Badge variant="outline" className={riskStyles[row.complaintMeta.riskLevel]}>{riskLabel(row.complaintMeta.riskLevel)}</Badge>}
                    <span className={`text-xs ${deadline.overdue ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>{deadline.overdue ? `${t("overdue")}: ` : ""}{deadline.label}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <span className="truncate"><span className="text-muted-foreground">{t("colCustomer")}:</span> {row.contact?.fullName || t("unknownCustomer")}</span>
                    <span className="truncate"><span className="text-muted-foreground">{t("colOwner")}:</span> {row.assigneeName || t("unassigned")}</span>
                  </div>
                  <details className="mt-2 border-t pt-2">
                    <summary className="min-h-11 cursor-pointer rounded-md py-3 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">{t("rowDetails")}</summary>
                    <div className="grid gap-1 pb-1 text-xs"><span>{t("colBrand")}: {row.complaintMeta?.brand || "—"}</span><span>{t("colProduct")}: {row.complaintMeta?.productCategory || "—"}</span><span>{t("colDepartment")}: {row.complaintMeta?.responsibleDepartment || "—"}</span></div>
                  </details>
                </article>
              )
            }}
          />
        </div>
      )}
    </SupportPageShell>
  )
}
