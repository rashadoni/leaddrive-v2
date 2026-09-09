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
  Users, RefreshCw, Search,
} from "lucide-react"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface Provider {
  id: string
  userId: string | null
  fullName: string
  email: string | null
  phone: string | null
  npiNumber: string | null
  role: string
  specialty: string | null
  departmentSlug: string | null
  isActive: boolean
  createdAt: string
}

const ROLE_COLORS: Record<string, string> = {
  physician:             "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  nurse_practitioner:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  physician_assistant:   "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  registered_nurse:      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  specialist:            "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  therapist:             "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  technician:            "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  admin:                 "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
  // fallback for unknown roles
  _unknown:              "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
}

export default function HealthProvidersPage() {
  const { data: session } = useSession()
  const t = useTranslations("health")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [totals, setTotals] = useState({ total: 0, active: 0, physicians: 0, nurses: 0 })

  const fetchProviders = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (roleFilter) params.set("role", roleFilter)
      if (search.trim()) params.set("search", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/health-providers?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.providers) {
        setProviders(prev => reset ? json.providers : [...prev, ...json.providers])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const p: Provider[] = json.providers
          setTotals({
            total:      p.length,
            active:     p.filter(x => x.isActive).length,
            physicians: p.filter(x => x.role === "physician").length,
            nurses:     p.filter(x => x.role === "registered_nurse" || x.role === "nurse_practitioner").length,
          })
        }
      }
    } catch (err) {
      console.error("[health/providers]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, roleFilter, search, cursor, headers])

  useEffect(() => {
    fetchProviders(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, roleFilter])

  // Debounced search
  useEffect(() => {
    const id = setTimeout(() => fetchProviders(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const roleLabel = (r: string) =>
    t(`provRole_${r}` as Parameters<typeof t>[0], { fallback: r }) ?? r

  const columns = [
    {
      key: "fullName",
      label: t("provName"),
      sortable: true,
      render: (item: Provider) => (
        <div>
          <div className="font-medium text-sm">{item.fullName}</div>
          {item.email && <div className="text-xs text-muted-foreground">{item.email}</div>}
        </div>
      ),
    },
    {
      key: "role",
      label: t("provRole"),
      sortable: true,
      render: (item: Provider) => (
        <Badge className={`text-xs ${ROLE_COLORS[item.role] ?? ROLE_COLORS._unknown}`}>
          {roleLabel(item.role)}
        </Badge>
      ),
    },
    {
      key: "specialty",
      label: t("provSpecialty"),
      render: (item: Provider) => (
        <span className="text-sm text-muted-foreground">{item.specialty || "—"}</span>
      ),
    },
    {
      key: "npiNumber",
      label: t("provNpi"),
      render: (item: Provider) => (
        <span className="font-mono text-xs text-muted-foreground">{item.npiNumber || "—"}</span>
      ),
    },
    {
      key: "isActive",
      label: t("provActive"),
      sortable: true,
      render: (item: Provider) => (
        <Badge className={item.isActive
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs"
          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 text-xs"
        }>
          {item.isActive ? t("provStatusActive") : t("provStatusInactive")}
        </Badge>
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
              <Users className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("provPageTitle")}<HelpButton slug="health-providers" variant="label" /></h1>
              <PageDescription text={t("provPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("provStatTotal")} value={String(totals.total)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("provStatActive")} value={String(totals.active)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("provStatPhysicians")} value={String(totals.physicians)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("provStatNurses")} value={String(totals.nurses)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("provSearchPlaceholder")}
              className="w-full pl-9 pr-3 h-9 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{t("allRoles")}</option>
            {["physician","nurse_practitioner","physician_assistant","registered_nurse","specialist","therapist","technician","admin"].map(r => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchProviders(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={providers as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchProviders(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
