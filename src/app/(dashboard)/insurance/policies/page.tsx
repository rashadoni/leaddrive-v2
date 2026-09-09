"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { DataTable } from "@/components/data-table"
import {
  FileText, RefreshCw, Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface Policy {
  id: string
  policyNumber: string
  policyHolderId: string
  lineOfBusiness: string
  status: string
  coverageLimit: number | null
  annualPremium: number | null
  billingFrequency: string
  effectiveDate: string | null
  expirationDate: string | null
  createdAt: string
}

const POLICY_STATUS_COLORS: Record<string, string> = {
  quote:     "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  bound:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  expired:   "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  lapsed:    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function InsurancePoliciesPage() {
  const { data: session } = useSession()
  const t = useTranslations("insurance")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [lobFilter, setLobFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [totals, setTotals] = useState({ total: 0, active: 0, expiring: 0, lapsed: 0 })

  const fetchPolicies = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (lobFilter) params.set("lineOfBusiness", lobFilter)
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/policies?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.policies) {
        setPolicies(prev => reset ? json.policies : [...prev, ...json.policies])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const p: Policy[] = json.policies
          setTotals({
            total:   p.length,
            active:  p.filter(x => x.status === "active").length,
            expiring: p.filter(x => x.status === "expired").length,
            lapsed:  p.filter(x => x.status === "lapsed").length,
          })
        }
      }
    } catch (err) {
      console.error("[insurance/policies]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, lobFilter, cursor, headers])

  useEffect(() => {
    fetchPolicies(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter, lobFilter])

  const statusLabel = (s: string) =>
    t(`policyStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const lobLabel = (s: string) =>
    t(`lob_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const fmtCurrency = (v: number | null) =>
    v == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v)

  const columns = [
    {
      key: "policyNumber",
      label: t("colPolicyNumber"),
      sortable: true,
      render: (item: Policy) => (
        <span className="font-mono text-xs text-muted-foreground">{item.policyNumber}</span>
      ),
    },
    {
      key: "lineOfBusiness",
      label: t("colLineOfBusiness"),
      sortable: true,
      render: (item: Policy) => (
        <span className="text-sm font-medium capitalize">{lobLabel(item.lineOfBusiness)}</span>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: Policy) => (
        <Badge className={cn("text-xs", POLICY_STATUS_COLORS[item.status] || POLICY_STATUS_COLORS.quote)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "annualPremium",
      label: t("colPremium"),
      sortable: true,
      render: (item: Policy) => (
        <span className="text-sm text-muted-foreground">{fmtCurrency(item.annualPremium)}</span>
      ),
    },
    {
      key: "effectiveDate",
      label: t("colEffectiveDate"),
      sortable: true,
      render: (item: Policy) => (
        <span className="text-xs text-muted-foreground">
          {item.effectiveDate ? new Date(item.effectiveDate).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "expirationDate",
      label: t("colExpirationDate"),
      sortable: true,
      render: (item: Policy) => (
        <span className="text-xs text-muted-foreground">
          {item.expirationDate ? new Date(item.expirationDate).toLocaleDateString() : "—"}
        </span>
      ),
    },
  ]

  return (
    <MotionPage>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <FileText className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("policiesPageTitle")}<HelpButton slug="insurance-policies" variant="label" /></h1>
              <PageDescription text={t("policiesPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("polStatTotal")} value={String(totals.total)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("polStatActive")} value={String(totals.active)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("polStatExpired")} value={String(totals.expiring)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("polStatLapsed")} value={String(totals.lapsed)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{t("allStatuses")}</option>
            {["quote","bound","active","expired","lapsed","cancelled"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <select
            value={lobFilter}
            onChange={e => setLobFilter(e.target.value)}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{t("allLobs")}</option>
            {["auto","home","life","health","commercial","umbrella","marine"].map(l => (
              <option key={l} value={l}>{lobLabel(l)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchPolicies(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={policies as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchPolicies(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
