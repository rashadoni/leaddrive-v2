"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/data-table"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { Upload, Download, Plus, MessageSquareWarning, AlertTriangle } from "lucide-react"

type ComplaintRow = {
  id: string
  ticketNumber: string
  subject: string
  description: string | null
  status: string
  priority: string
  source: string | null
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

const riskColors: Record<string, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
}

const statusColors: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  closed: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  escalated: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
}

const localeMap: Record<string, string> = { ru: "ru-RU", en: "en-US", az: "az-AZ" }

export default function ComplaintsPage() {
  const t = useTranslations("complaints")
  const locale = useLocale()
  const dateLocale = localeMap[locale] || "en-US"
  const router = useRouter()
  const { data: session } = useSession()
  const [rows, setRows] = useState<ComplaintRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ brand: "", riskLevel: "", status: "", productCategory: "" })

  const orgId = session?.user?.organizationId

  const fetchRows = useCallback(async () => {
    const params = new URLSearchParams()
    params.set("limit", "200")
    if (filters.brand) params.set("brand", filters.brand)
    if (filters.riskLevel) params.set("riskLevel", filters.riskLevel)
    if (filters.status) params.set("status", filters.status)
    if (filters.productCategory) params.set("productCategory", filters.productCategory)
    try {
      const res = await fetch(`/api/v1/complaints?${params.toString()}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
      })
      const json = await res.json()
      if (json.success) setRows(json.data.complaints)
    } finally {
      setLoading(false)
    }
  }, [orgId, filters])

  useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  async function handleExport() {
    const res = await fetch("/api/v1/complaints/export-xlsx", {
      headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `CRM-hesabat-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const riskLabel = (lvl: string) => {
    if (lvl === "high") return t("riskHigh")
    if (lvl === "medium") return t("riskMedium")
    if (lvl === "low") return t("riskLow")
    return lvl
  }

  const statusLabel = (s: string) => {
    if (s === "open") return t("statusOpen")
    if (s === "in_progress") return t("statusInProgress")
    if (s === "resolved") return t("statusResolved")
    if (s === "closed") return t("statusClosed")
    return s
  }

  const columns = [
    {
      key: "registryNumber",
      label: t("colRegistryNumber"),
      render: (r: ComplaintRow) => (
        <span className="font-mono text-xs">
          {r.complaintMeta?.externalRegistryNumber ?? r.ticketNumber}
        </span>
      ),
    },
    {
      key: "customer",
      label: t("colCustomer"),
      render: (r: ComplaintRow) => (
        <div className="text-sm">
          <div>{r.contact?.fullName || "—"}</div>
          {r.contact?.phone && <div className="text-xs text-muted-foreground">{r.contact.phone}</div>}
        </div>
      ),
    },
    {
      key: "createdAt",
      label: t("colDate"),
      render: (r: ComplaintRow) => new Date(r.createdAt).toLocaleDateString(dateLocale),
    },
    {
      key: "source",
      label: t("colSource"),
      render: (r: ComplaintRow) => <span className="text-xs">{r.source || "—"}</span>,
    },
    {
      key: "brand",
      label: t("colBrand"),
      render: (r: ComplaintRow) => r.complaintMeta?.brand || "—",
    },
    {
      key: "product",
      label: t("colProduct"),
      render: (r: ComplaintRow) => r.complaintMeta?.productCategory || "—",
    },
    {
      key: "object",
      label: t("colObject"),
      render: (r: ComplaintRow) => r.complaintMeta?.complaintObject || "—",
    },
    {
      key: "department",
      label: t("colDepartment"),
      render: (r: ComplaintRow) => r.complaintMeta?.responsibleDepartment || "—",
    },
    {
      key: "risk",
      label: t("colRisk"),
      render: (r: ComplaintRow) => {
        const lvl = r.complaintMeta?.riskLevel
        if (!lvl) return <span className="text-muted-foreground">—</span>
        return <Badge className={riskColors[lvl]}>{riskLabel(lvl)}</Badge>
      },
    },
    {
      key: "status",
      label: t("colStatus"),
      render: (r: ComplaintRow) => <Badge className={statusColors[r.status] || ""}>{statusLabel(r.status)}</Badge>,
    },
  ]

  const highRisk = rows.filter((r) => r.complaintMeta?.riskLevel === "high").length
  const open = rows.filter((r) => r.status === "open" || r.status === "in_progress").length

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <MessageSquareWarning className="w-7 h-7" />
            {t("title")}
            <HelpButton slug="complaints" variant="label" />
          </h1>
          <PageDescription text={t("pageDescription")} />
        </div>
        <div className="flex gap-2">
          <Link href="/complaints/import">
            <Button variant="outline">
              <Upload className="w-4 h-4 mr-2" /> {t("importXlsx")}
            </Button>
          </Link>
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" /> {t("exportXlsx")}
          </Button>
          <Link href="/complaints/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" /> {t("newComplaint")}
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={t("statTotal")} value={rows.length} />
        <StatCard label={t("statOpen")} value={open} tone="amber" />
        <StatCard label={t("statHighRisk")} value={highRisk} tone="red" icon={<AlertTriangle className="w-4 h-4" />} />
        <StatCard
          label={t("statResolved")}
          value={rows.filter((r) => r.status === "resolved").length}
          tone="green"
        />
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder={t("filterBrand")}
          value={filters.brand}
          onChange={(e) => setFilters((f) => ({ ...f, brand: e.target.value }))}
          className="w-40"
        />
        <Input
          placeholder={t("filterProduct")}
          value={filters.productCategory}
          onChange={(e) => setFilters((f) => ({ ...f, productCategory: e.target.value }))}
          className="w-40"
        />
        <select
          className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 text-sm bg-background"
          value={filters.riskLevel}
          onChange={(e) => setFilters((f) => ({ ...f, riskLevel: e.target.value }))}
        >
          <option value="">{t("filterAllRisks")}</option>
          <option value="high">{t("riskHigh")}</option>
          <option value="medium">{t("riskMedium")}</option>
          <option value="low">{t("riskLow")}</option>
        </select>
        <select
          className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 text-sm bg-background"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">{t("filterAllStatuses")}</option>
          <option value="open">{t("statusOpen")}</option>
          <option value="in_progress">{t("statusInProgress")}</option>
          <option value="resolved">{t("statusResolved")}</option>
          <option value="closed">{t("statusClosed")}</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">{t("loading")}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 border border-zinc-200 dark:border-zinc-700 rounded-lg">
          <MessageSquareWarning className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium">{t("emptyTitle")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("emptyHint")}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/complaints/import">
              <Button variant="outline" size="sm">
                <Upload className="w-4 h-4 mr-2" /> {t("importShort")}
              </Button>
            </Link>
            <Link href="/complaints/new">
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" /> {t("createShort")}
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          columns={columns as unknown as Parameters<typeof DataTable<Record<string, unknown>>>[0]["columns"]}
          data={rows as unknown as Record<string, unknown>[]}
          searchPlaceholder={t("searchPlaceholder")}
          searchKey="subject"
          onRowClick={(r) => router.push(`/complaints/${(r as unknown as ComplaintRow).id}`)}
        />
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  tone = "neutral",
  icon,
}: {
  label: string
  value: number
  tone?: "neutral" | "amber" | "red" | "green"
  icon?: React.ReactNode
}) {
  const toneClass = {
    neutral: "bg-card",
    amber: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900",
    red: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900",
    green: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900",
  }[tone]
  return (
    <div className={`border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-3 ${toneClass}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}
