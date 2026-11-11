"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { ACCESS_LEVELS, isEditableCell, setClientRoleAccess, type RoleAccessMap } from "@/lib/role-access"
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
import { enforcedAccessLevel, HIDEABLE_MODULE_SCOPES, type AccessLevel } from "@/lib/user-access-summary"
import { hasModule } from "@/lib/modules"
import { orgFromSession } from "@/lib/nav-items"
import { tenantHideableModules, USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"
import { userModuleOptions } from "@/lib/user-module-options"


interface RoleConfig {
  id: string
  name: string
  color: string
  isSystem: boolean
  // false for an organization's own role: the permission engine does not
  // enforce it, so it cannot be given to anybody (see GET /settings/roles).
  assignable?: boolean
}

/** One block of the table: a tick from the user card and the scopes behind it. */
interface MatrixGroup { id: string; label: string; scopes: readonly string[] }

const MODULE_HINT_KEYS: Partial<Record<string, string>> = {
  loyalty: "moduleHint_loyalty",
  // A manager reads `users` and has no `settings`: without these two lines the
  // table says "Users — View" about a page the manager cannot open.
  settings: "moduleHint_settings",
  users: "moduleHint_users",
  // The row is named after its menu entry, which says nothing about payment
  // orders or bank accounts — the things an admin is actually deciding about.
  finance: "moduleHint_finance",
  // checkPermission special-cases meetings: no role deletes them, and the
  // viewer — who reads everything else — does not see them.
  bookings: "moduleHint_bookings",
}

// The matrix asks `enforcedAccessLevel` — `checkPermission` underneath, the
// function every API route is gated by — so this table cannot say something
// enforcement does not. Since 2026-11-11 an admin changes it here for their
// organization (lib/role-access.ts): the map the table edits is the one
// `checkPermission` reads, saved in `Organization.settings.roleAccess`. It used to render `Organization.settings.permissions`,
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
  const { data: session, update: updateSession } = useSession()
  const t = useTranslations("settings")
  const tc = useTranslations("common")
  const tn = useTranslations("nav")
  // The table is grouped exactly like the ticks on the user card — same names,
  // same order, same scopes (HIDEABLE_MODULE_SCOPES) — and lists only what this
  // organization has. It used to keep its own grouping, list modules the tenant
  // never bought and leave Meetings out (audit, owner 2026-11-07). Not memoized:
  // the session object changes identity on every read anyway.
  const sessionUser = session?.user
  const isSuperadmin = sessionUser?.role === "superadmin"
  const org = orgFromSession(sessionUser)
  const matrixGroups: MatrixGroup[] = [
    ...userModuleOptions(
      isSuperadmin ? USER_HIDEABLE_MODULE_IDS : tenantHideableModules(org),
      (key) => tn(key as never),
    ).map((option) => ({ id: option.id, label: option.label, scopes: HIDEABLE_MODULE_SCOPES[option.id] })),
    ...(isSuperadmin || hasModule(org, "ai") ? [{ id: "ai", label: t("module_ai"), scopes: ["ai"] }] : []),
    // Settings has no tick: only the role opens it.
    { id: "settings", label: tn("groups.Settings" as never), scopes: ["settings", "users", "audit"] },
  ]
  const scopeLabel = (group: MatrixGroup, scope: string) =>
    t.has(`module_${scope}`) ? t(`module_${scope}` as never) : group.label
  useAutoTour("roles")
  const [roles, setRoles] = useState<RoleConfig[]>([])
  const [userCounts, setUserCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null)
  const [deleteRoleName, setDeleteRoleName] = useState("")
  const orgId = session?.user?.organizationId
  const canEdit = sessionUser?.role === "admin" || isSuperadmin
  // The organization's rights for its roles: as saved, and as being edited.
  const [savedAccess, setSavedAccess] = useState<RoleAccessMap>({})
  const [draftAccess, setDraftAccess] = useState<RoleAccessMap>({})
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchData = useCallback(async () => {
    if (!orgId) return
    const headers = { "x-organization-id": String(orgId) }
    try {
      const [usersRes, rolesRes, accessRes] = await Promise.all([
        fetch("/api/v1/users", { headers }),
        fetch("/api/v1/settings/roles", { headers }),
        canEdit ? fetch("/api/v1/settings/role-access", { headers }) : Promise.resolve(null),
      ])
      if (accessRes?.ok) {
        const result = await accessRes.json()
        const map = (result.data?.roleAccess ?? {}) as RoleAccessMap
        setSavedAccess(map)
        setDraftAccess(map)
      }

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
  }, [orgId, canEdit])

  useEffect(() => { fetchData() }, [fetchData])

  const cellOf = (map: RoleAccessMap, role: string, scope: string) => map[role]?.[scope]
  const changedCount = (() => {
    let n = 0
    const roleIds = new Set([...Object.keys(savedAccess), ...Object.keys(draftAccess)])
    for (const role of roleIds) {
      const scopes = new Set([...Object.keys(savedAccess[role] ?? {}), ...Object.keys(draftAccess[role] ?? {})])
      for (const scope of scopes) if (cellOf(savedAccess, role, scope) !== cellOf(draftAccess, role, scope)) n++
    }
    return n
  })()
  const setCell = (role: string, scope: string, level: AccessLevel) => {
    setSaveNote(null)
    setDraftAccess((prev) => {
      const next: RoleAccessMap = Object.fromEntries(Object.entries(prev).map(([r, m]) => [r, { ...m }]))
      // Only what differs from the built-in right is kept.
      if (level === enforcedLevel(role, scope, {})) delete next[role]?.[scope]
      else (next[role] ??= {})[scope] = level
      if (next[role] && Object.keys(next[role]).length === 0) delete next[role]
      return next
    })
  }
  const saveAccess = async () => {
    setSaving(true)
    setSaveNote(null)
    try {
      const res = await fetch("/api/v1/settings/role-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
        body: JSON.stringify({ roleAccess: draftAccess }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const result = await res.json()
      const map = (result.data?.roleAccess ?? {}) as RoleAccessMap
      setSavedAccess(map)
      setDraftAccess(map)
      // This tab's buttons follow at once; the session (and other tabs) on its next read.
      setClientRoleAccess(map)
      updateSession?.().catch(() => {})
      setSaveNote({ ok: true, text: t("rolesMatrixSaved") })
    } catch {
      setSaveNote({ ok: false, text: t("rolesMatrixSaveFailed") })
    } finally {
      setSaving(false)
    }
  }

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

  // Built-in roles are named in the reader's language, as on the users page;
  // an organization's own role keeps the name it was given.
  const roleLabel = (role: RoleConfig) => t.has(`role_${role.id}`) ? t(`role_${role.id}` as never) : role.name

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
                <div key={role.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
                  <Badge className={`${getColorBg(role.color)} gap-1`}>
                    <Icon className="h-3 w-3" />
                    {roleLabel(role)}
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
                      onClick={() => { setDeleteRoleId(role.id); setDeleteRoleName(roleLabel(role)) }}
                      title={t("deleteRole")}
                      aria-label={`${t("deleteRole")}: ${roleLabel(role)}`}
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
          <div className="mt-1 mb-4 flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-3xl text-xs text-muted-foreground">{t(canEdit ? "rolesMatrixEditHint" : "rolesMatrixReadOnlyHint")}</p>
            {canEdit && changedCount > 0 && (
              <span className="text-xs font-medium text-[#C2410C]" data-testid="roles-matrix-unsaved">{t("rolesMatrixUnsaved", { count: changedCount })}</span>
            )}
          </div>
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
                          {roleLabel(role)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-normal">
                          {userCounts[role.id] || 0} {t("usersCount")}
                        </span>
                        {role.assignable === false && (
                          <span className="text-[10px] font-normal text-amber-700 dark:text-amber-400" title={t("roleNotAssignableHint")}>
                            {t("roleNotAssignable")}
                          </span>
                        )}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {matrixGroups.map((group) => {
                // A tick with one scope is one row named after the tick; with
                // several, a heading row and one row per scope under it.
                const single = group.scopes.length === 1
                return [
                  !single && (
                    <tr key={`${group.id}-head`} className="border-t bg-muted/50" data-matrix-group={group.id}>
                      <td colSpan={roles.length + 1} className="sticky left-0 py-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </td>
                    </tr>
                  ),
                  ...group.scopes.map((mod) => (
                    <tr key={`${group.id}-${mod}`} className={single ? "border-t" : ""} data-matrix-scope={mod}>
                      <td className={`py-2.5 font-medium sticky left-0 bg-card z-10 ${single ? "px-3" : "pl-6 pr-3"}`}>
                        <div>{single ? group.label : scopeLabel(group, mod)}</div>
                        {MODULE_HINT_KEYS[mod] && (
                          <p className="mt-0.5 max-w-[260px] text-[11px] font-normal leading-snug text-muted-foreground">
                            {t(MODULE_HINT_KEYS[mod]!)}
                          </p>
                        )}
                      </td>
                      {roles.map(role => {
                        const level = enforcedLevel(role.id, mod, canEdit ? draftAccess : undefined)
                        const builtIn = enforcedLevel(role.id, mod, {})
                        const style = ACCESS_STYLES[level]
                        const IconEl = style.icon
                        const editable = canEdit && role.assignable !== false && isEditableCell(role.id, mod)
                        const unsaved = editable && cellOf(draftAccess, role.id, mod) !== cellOf(savedAccess, role.id, mod)
                        const locked = role.id === "admin" || role.id === "superadmin"
                        return (
                          <td key={role.id} className="py-2.5 px-2">
                            <div className="flex flex-col items-center gap-0.5">
                              {editable ? (
                                <select
                                  value={level}
                                  onChange={(e) => setCell(role.id, mod, e.target.value as AccessLevel)}
                                  aria-label={t("rolesMatrixCellLabel", { role: roleLabel(role), module: single ? group.label : scopeLabel(group, mod) })}
                                  data-testid="roles-matrix-cell"
                                  data-role={role.id}
                                  data-scope={mod}
                                  className={`cursor-pointer appearance-none rounded-md border-0 px-2 py-0.5 text-center text-[11px] font-medium ${style.className} ${unsaved ? "ring-2 ring-[#EA580C] ring-offset-1" : "hover:ring-1 hover:ring-border"}`}
                                >
                                  {ACCESS_LEVELS.map((option) => <option key={option} value={option}>{accessLabel(option)}</option>)}
                                </select>
                              ) : (
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${style.className}`}
                                  title={canEdit ? t("rolesMatrixLocked") : undefined}
                                >
                                  {canEdit && locked ? <Lock className="h-3 w-3" /> : <IconEl className="h-3 w-3" />}
                                  {accessLabel(level)}
                                </span>
                              )}
                              {editable && level !== builtIn && (
                                <span className="text-[10px] text-[#C2410C]">{t("rolesMatrixDefault", { level: accessLabel(builtIn) })}</span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )),
                ]
              })}
            </tbody>
          </table>
          {canEdit && (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {saveNote && <span className={`text-xs ${saveNote.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>{saveNote.text}</span>}
              <Button
                type="button"
                variant="outline"
                onClick={() => { setSaveNote(null); setDraftAccess({}) }}
                disabled={saving || Object.keys(draftAccess).length === 0}
                data-testid="roles-matrix-reset"
              >
                {t("rolesMatrixReset")}
              </Button>
              <Button type="button" onClick={saveAccess} disabled={saving || changedCount === 0} data-testid="roles-matrix-save">
                {t("rolesMatrixSave")}
              </Button>
            </div>
          )}
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
