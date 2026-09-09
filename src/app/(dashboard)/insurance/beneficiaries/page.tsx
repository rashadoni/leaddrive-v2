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
  Users, RefreshCw,
} from "lucide-react"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface Beneficiary {
  id: string
  policyId: string
  tier: string
  beneficiaryType: string
  fullName: string
  relationship: string | null
  allocationPct: number
  dateOfBirth: string | null
  designatedAt: string | null
  revokedAt: string | null
  createdAt: string
}

const TIER_COLORS: Record<string, string> = {
  primary:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  contingent:  "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  tertiary:    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
}

export default function InsuranceBeneficiariesPage() {
  const { data: session } = useSession()
  const t = useTranslations("insurance")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([])
  const [loading, setLoading] = useState(true)
  const [tierFilter, setTierFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [totals, setTotals] = useState({ total: 0, primary: 0, contingent: 0, revoked: 0 })

  const fetchBeneficiaries = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (tierFilter) params.set("tier", tierFilter)
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/beneficiaries?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.beneficiaries) {
        setBeneficiaries(prev => reset ? json.beneficiaries : [...prev, ...json.beneficiaries])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const b: Beneficiary[] = json.beneficiaries
          setTotals({
            total:      b.length,
            primary:    b.filter(x => x.tier === "primary").length,
            contingent: b.filter(x => x.tier === "contingent").length,
            revoked:    b.filter(x => x.revokedAt !== null).length,
          })
        }
      }
    } catch (err) {
      console.error("[insurance/beneficiaries]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, tierFilter, cursor, headers])

  useEffect(() => {
    fetchBeneficiaries(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tierFilter])

  const tierLabel = (s: string) =>
    t(`beneeTier_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "fullName",
      label: t("colBeneeName"),
      sortable: true,
      render: (item: Beneficiary) => (
        <span className="font-medium text-sm">{item.fullName}</span>
      ),
    },
    {
      key: "tier",
      label: t("colTier"),
      sortable: true,
      render: (item: Beneficiary) => (
        <Badge className={`text-xs ${TIER_COLORS[item.tier] || TIER_COLORS.tertiary}`}>
          {tierLabel(item.tier)}
        </Badge>
      ),
    },
    {
      key: "beneficiaryType",
      label: t("colBeneeType"),
      render: (item: Beneficiary) => (
        <span className="text-sm text-muted-foreground capitalize">{item.beneficiaryType}</span>
      ),
    },
    {
      key: "relationship",
      label: t("colRelationship"),
      render: (item: Beneficiary) => (
        <span className="text-sm text-muted-foreground capitalize">{item.relationship || "—"}</span>
      ),
    },
    {
      key: "allocationPct",
      label: t("colAllocation"),
      sortable: true,
      render: (item: Beneficiary) => (
        <span className="text-sm font-medium">{item.allocationPct}%</span>
      ),
    },
    {
      key: "revokedAt",
      label: t("colRevoked"),
      render: (item: Beneficiary) => (
        <span className="text-xs text-muted-foreground">
          {item.revokedAt ? new Date(item.revokedAt).toLocaleDateString() : "—"}
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
            <div className="p-2 bg-violet-500/10 rounded-lg">
              <Users className="h-6 w-6 text-violet-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("beneficiariesPageTitle")}<HelpButton slug="insurance-beneficiaries" variant="label" /></h1>
              <PageDescription text={t("beneficiariesPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("beneeStatTotal")} value={String(totals.total)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("beneeStatPrimary")} value={String(totals.primary)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("beneeStatContingent")} value={String(totals.contingent)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("beneeStatRevoked")} value={String(totals.revoked)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={tierFilter}
            onChange={e => setTierFilter(e.target.value)}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{t("allTiers")}</option>
            {["primary","contingent","tertiary"].map(tier => (
              <option key={tier} value={tier}>{tierLabel(tier)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchBeneficiaries(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={beneficiaries as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchBeneficiaries(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
