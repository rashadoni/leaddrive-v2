"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import {
  Shield, ShieldCheck, UserCheck, Eye, Briefcase, Megaphone, Wallet, Headphones,
  Check, X, Pencil, EyeIcon, Lock, Trash2, Tag, Users, ArrowRight,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { enforcedAccessLevel, type AccessLevel } from "@/lib/user-access-summary"
import { isCrmCapabilityAvailable } from "@/lib/crm-product-availability"


interface RoleConfig {
  id: string
  name: string
  color: string
  isSystem: boolean
}

// Grouped module list — each module is a permission scope in permissions.ts,
// and the matrix below is read straight from that file's role table.
const MODULE_GROUPS: { label: string; modules: string[] }[] = [
  { label: "crm",       modules: ["companies", "contacts", "deals", "leads", "tasks"] },
  { label: "sales",     modules: ["contracts", "offers", "pricing"] },
  { label: "marketing", modules: ["campaigns", "journeys", "segments", "events"] },
  { label: "loyalty",   modules: ["loyalty"] },
  { label: "comm",      modules: ["inbox", "voip", "social"] },
  { label: "support",   modules: ["tickets", "kb"] },
  { label: "finance",   modules: ["invoices", "finance", "budgeting", "profitability"] },
  { label: "erp",       modules: ["projects"] },
  { label: "field",     modules: ["mtm", "workforce"] },
  { label: "ai",        modules: ["ai"] },
  { label: "analytics", modules: ["reports"] },
  { label: "admin",     modules: ["settings", "users", "audit"] },
]

const MODULES: string[] = MODULE_GROUPS.flatMap(g => g.modules)
  .filter((module) => module !== "workforce" || isCrmCapabilityAvailable("workforce-hrm"))
const MODULE_HINT_KEYS: Partial<Record<string, string>> = {
  loyalty: "moduleHint_loyalty",
  // A manager reads `users` and has no `settings`: without these two lines the
  // table says "Users — View" about a page the manager cannot open.
  settings: "moduleHint_settings",
  users: "moduleHint_users",
  // The row is named after its menu entry, which says nothing about payment
  // orders or bank accounts — the things an admin is actually deciding about.
  finance: "moduleHint_finance",
}

// The matrix asks `enforcedAccessLevel` — `checkPermission` underneath, the
// function every API route is gated by — so this table cannot say something
// enforcement does not. It used to render `Organization.settings.permissions`,
// an editable copy that nothing reads at enforcement time: an admin could set
// Sales → Deals to "None", save, and Sales kept full access. The user card
// reads the same function for its "what this person gets" rows.
const enforcedLevel = enforcedAccessLevel

const COLOR_OPTIONS = [
  { id: "red", label: "Red", bg: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
  { id: "blue", label: "Blue", bg: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" },
  { id: "purple", label: "Purple", bg: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300" },
  { id: "gray", label: "Gray", bg: "bg-muted text-foreground" },
  { id: "emerald", label: "Green", bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300" },
  { id: "pink", label: "Pink", bg: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300" },
  { id: "amber", label: "Amber", bg: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300" },
  { id: "cyan", label: "Cyan", bg: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300" },
  { id: "indigo", label: "Indigo", bg: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300" },
  { id: "teal", label: "Teal", bg: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300" },
  { id: "orange", label: "Orange", bg: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300" },
  { id: "slate", label: "Slate", bg: "bg-muted text-foreground" },
]

function getColorBg(color: string): string {
  return COLOR_OPTIONS.find(c => c.id === color)?.bg || COLOR_OPTIONS[COLOR_OPTIONS.length - 1].bg
}

const ROLE_ICONS: Record<string, typeof Shield> = {
  admin: Shield, manager: ShieldCheck, agent: UserCheck, viewer: Eye,
  ticketing: Headphones,
  sales: Briefcase, marketing: Megaphone, finance: Wallet, service_desk: Headphones,
}

function getRoleIcon(roleId: string) {
  return ROLE_ICONS[roleId] || Tag
}

const ACCESS_STYLES: Record<AccessLevel, { icon: typeof Check; className: string }> = {
  full: { icon: Check,   className: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20" },
  edit: { icon: Pencil,  className: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20" },
  view: { icon: EyeIcon, className: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20" },
  none: { icon: X,       className: "text-muted-foreground bg-muted" },
}

export default function RolesSettingsPage() {
  const { data: session } = useSession()
  const t = useTranslations("settings")
  const tc = useTranslations("common")
  useAutoTour("roles")
  const [roles, setRoles] = useState<RoleConfig[]>([])
  const [userCounts, setUserCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null)
  const [deleteRoleName, setDeleteRoleName] = useState("")
  const orgId = session?.user?.organizationId

  const fetchData = useCallback(async () => {
    if (!orgId) return
    const headers = { "x-organization-id": String(orgId) }
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetch("/api/v1/users", { headers }),
        fetch("/api/v1/settings/roles", { headers }),
      ])

      if (usersRes.ok) {
        const result = await usersRes.json()
        const counts: Record<string, number> = {}
        for (const u of result.data || []) {
          counts[u.role] = (counts[u.role] || 0) + 1
        }
        setUserCounts(counts)
      }

      if (rolesRes.ok) {
        const result = await rolesRes.json()
        if (result.data) setRoles(result.data.roles)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }, [orgId])

  useEffect(() => { fetchData() }, [fetchData])

  const handleDeleteRole = async () => {
    if (!deleteRoleId) return
    const res = await fetch(`/api/v1/settings/roles?id=${deleteRoleId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) {
      const json = await res.json()
      throw new Error(json.error || tc("errorDeleteFailed"))
    }
    setDeleteRoleId(null)
    await fetchData()
  }

  const accessLabel = (level: AccessLevel): string => {
    switch (level) {
      case "full": return t("accessFull")
      case "edit": return t("accessEdit")
      case "view": return t("accessView")
      case "none": return t("accessNone")
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("roles")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-lg" />
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between" data-tour-id="roles-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("roles")} <HelpButton slug="roles" variant="label" /></h1>
          <p className="text-muted-foreground">{t("rolesPageSubtitle")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("hintRoles")}</p>
        </div>
        <TourReplayButton tourId="roles" />
      </div>

      {/* Where module access for one person is actually set */}
      <Card data-tour-id="roles-user-access" className="border-primary/40">
        <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <h3 className="font-semibold">{t("rolesUserAccessTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("rolesUserAccessBody")}</p>
          </div>
          <Button asChild>
            <Link href="/settings/users">
              <Users className="h-4 w-4 mr-1" />
              {t("rolesUserAccessCta")}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Roles cards */}
      <Card data-tour-id="roles-list">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">{t("availableRoles")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t("availableRolesHint")}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {roles.map(role => {
              const Icon = getRoleIcon(role.id)
              return (
                <div key={role.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card">
                  <Badge className={`${getColorBg(role.color)} gap-1`}>
                    <Icon className="h-3 w-3" />
                    {role.name}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {userCounts[role.id] || 0} {t("usersCount")}
                  </span>
                  {role.isSystem && (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  )}
                  {!role.isSystem && (
                    <button
                      type="button"
                      onClick={() => { setDeleteRoleId(role.id); setDeleteRoleName(role.name) }}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Permission Matrix */}
      <Card data-tour-id="roles-matrix">
        <CardContent className="pt-6 overflow-x-auto">
          <h3 className="font-semibold">{t("rolesMatrixTitle")}</h3>
          <p className="mt-1 mb-4 text-xs text-muted-foreground">{t("rolesMatrixReadOnlyHint")}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-3 font-semibold sticky left-0 bg-card z-10">{t("module")}</th>
                {roles.map(role => {
                  const Icon = getRoleIcon(role.id)
                  return (
                    <th key={role.id} className="text-center py-3 px-2 min-w-[100px]">
                      <div className="flex flex-col items-center gap-1">
                        <Badge className={`${getColorBg(role.color)} gap-1 text-[10px]`}>
                          <Icon className="h-3 w-3" />
                          {role.name}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-normal">
                          {userCounts[role.id] || 0} {t("usersCount")}
                        </span>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((mod, idx) => (
                <tr key={mod} className={idx % 2 === 0 ? "bg-muted/30" : ""}>
                  <td className="py-2.5 px-3 font-medium sticky left-0 bg-inherit z-10">
                    <div>{t(`module_${mod}`)}</div>
                    {MODULE_HINT_KEYS[mod] && (
                      <p className="mt-0.5 max-w-[260px] text-[11px] font-normal leading-snug text-muted-foreground">
                        {t(MODULE_HINT_KEYS[mod]!)}
                      </p>
                    )}
                  </td>
                  {roles.map(role => {
                    const level = enforcedLevel(role.id, mod)
                    const style = ACCESS_STYLES[level]
                    const IconEl = style.icon
                    return (
                      <td key={role.id} className="py-2.5 px-2">
                        <div className="flex justify-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${style.className}`}>
                            <IconEl className="h-3 w-3" />
                            {accessLabel(level)}
                          </span>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Delete Role Dialog */}
      <DeleteConfirmDialog
        open={!!deleteRoleId}
        onOpenChange={(open) => { if (!open) setDeleteRoleId(null) }}
        onConfirm={handleDeleteRole}
        title={t("deleteRole")}
        itemName={deleteRoleName}
      />
    </div>
  )
}
