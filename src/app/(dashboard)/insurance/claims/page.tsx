"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { DataTable } from "@/components/data-table"
import { HelpButton } from "@/components/help/help-button"
import {
  Shield, AlertTriangle, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface Claim {
  id: string
  claimNumber: string
  policyId: string
  lossType: string
  status: string
  severity: string | null
  lossDate: string | null
  reportedAt: string | null
  initialReserveAmount: number | null
  currentReserveAmount: number | null
  paidAmount: number | null
  fraudFlag: boolean
  approvedAt: string | null
  settledAt: string | null
  deniedAt: string | null
  createdAt: string
}

const CLAIM_STATUS_COLORS: Record<string, string> = {
  reported:        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  under_review:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  approved:        "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  settled:         "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  denied:          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  closed_no_action:"bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
}

export default function InsuranceClaimsPage() {
  const { data: session } = useSession()
  const t = useTranslations("insurance")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [totals, setTotals] = useState({ total: 0, open: 0, approved: 0, fraud: 0 })

  const fetchClaims = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/claims?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.claims) {
        setClaims(prev => reset ? json.claims : [...prev, ...json.claims])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const c: Claim[] = json.claims
          setTotals({
            total:    c.length,
            open:     c.filter(x => ["reported","under_review"].includes(x.status)).length,
            approved: c.filter(x => x.status === "approved" || x.status === "settled").length,
            fraud:    c.filter(x => x.fraudFlag).length,
          })
        }
      }
    } catch (err) {
      console.error("[insurance/claims]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, cursor, headers])

  useEffect(() => {
    fetchClaims(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  const statusLabel = (s: string) =>
    t(`claimStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const lossTypeLabel = (s: string) =>
    t(`lossType_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const fmtCurrency = (v: number | null) =>
    v == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v)

  const columns = [
    {
      key: "claimNumber",
      label: t("colClaimNumber"),
      sortable: true,
      render: (item: Claim) => (
        <span className="font-mono text-xs text-muted-foreground">{item.claimNumber}</span>
      ),
    },
    {
      key: "lossType",
      label: t("colLossType"),
      sortable: true,
      render: (item: Claim) => (
        <span className="text-sm capitalize">{lossTypeLabel(item.lossType)}</span>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: Claim) => (
        <div className="flex items-center gap-2">
          <Badge className={cn("text-xs", CLAIM_STATUS_COLORS[item.status] || CLAIM_STATUS_COLORS.reported)}>
            {statusLabel(item.status)}
          </Badge>
          {item.fraudFlag && (
            <span title="Fraud flag">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" aria-label={t("fraudFlag")} />
            </span>
          )}
        </div>
      ),
    },
    {
      key: "currentReserveAmount",
      label: t("colReserve"),
      sortable: true,
      render: (item: Claim) => (
        <span className="text-sm text-muted-foreground">{fmtCurrency(item.currentReserveAmount)}</span>
      ),
    },
    {
      key: "paidAmount",
      label: t("colPaid"),
      render: (item: Claim) => (
        <span className="text-sm text-muted-foreground">{fmtCurrency(item.paidAmount)}</span>
      ),
    },
    {
      key: "lossDate",
      label: t("colLossDate"),
      sortable: true,
      render: (item: Claim) => (
        <span className="text-xs text-muted-foreground">
          {item.lossDate ? new Date(item.lossDate).toLocaleDateString() : "—"}
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
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Shield className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("claimsPageTitle")}<HelpButton slug="insurance-claims" variant="label" /></h1>
              <PageDescription text={t("claimsPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("claimStatTotal")} value={String(totals.total)} icon={<Shield className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("claimStatOpen")} value={String(totals.open)} icon={<Shield className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("claimStatApproved")} value={String(totals.approved)} icon={<Shield className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("claimStatFraud")} value={String(totals.fraud)} icon={<AlertTriangle className="h-4 w-4" />} />
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
            {["reported","under_review","approved","settled","denied","closed_no_action"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchClaims(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={claims as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchClaims(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
