"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { DataTable } from "@/components/data-table"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { StatCard } from "@/components/stat-card"
import {
  Users, Plus, Pencil, Trash2, Shield, ShieldCheck, Eye,
  EyeOff, Headphones, KeyRound, Loader2, UserCheck, UserX, AlertTriangle,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { toast } from "sonner"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

interface User extends Record<string, unknown> {
  id: string
  name: string
  email: string
  role: string
  phone: string | null
  department: string | null
  isActive: boolean
  lastLogin: string | null
  passwordChangedAt: string | null
  loginCount: number
  totpEnabled: boolean
  require2fa: boolean
  voiceEnabled?: boolean
  smsAuthEnabled: boolean
  verifiedPhone: string | null
  skills: string[]
  maxTickets: number
  isAvailable: boolean
  preferredLanguage: string | null
  createdAt: string
}

interface RoleConfig {
  id: string
  name: string
  color: string
  isSystem: boolean
  // Set by GET /settings/roles: false for roles the permission engine does not
  // enforce (deny-all). Such roles are hidden from the assignment dropdown.
  assignable?: boolean
}

const COLOR_MAP: Record<string, string> = {
  red: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  gray: "bg-muted text-foreground",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  cyan: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300",
  indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  slate: "bg-muted text-foreground",
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  admin: <Shield className="h-3 w-3" />,
  manager: <ShieldCheck className="h-3 w-3" />,
  agent: <UserCheck className="h-3 w-3" />,
  ticketing: <Headphones className="h-3 w-3" />,
  viewer: <Eye className="h-3 w-3" />,
}

interface UserFormData {
  name: string
  email: string
  password: string
  role: string
  phone: string
  department: string
  isActive: boolean
  maxTickets: number
  preferredLanguage: string
}

type UserPayload = {
  name: string
  email: string
  role: string
  phone: string | null
  department: string | null
  isActive: boolean
  maxTickets: number
  preferredLanguage: string | null
  password?: string
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

type Loc = "en" | "ru" | "az"
const USER_FORM_COPY: Record<Loc, Record<string, string>> = {
  en: {
    emailHint: "Used for login and notifications. Changing it changes where this user signs in.",
    passwordCreateHint: "Set a temporary password. The user can change it after logging in.",
    passwordEditHint: "Leave blank to keep the current password. Fill only when resetting access.",
    passwordEditPlaceholder: "Leave blank to keep current password",
    roleHint: "Role controls permissions across the tenant. Use Viewer for read-only access.",
    departmentHint: "Optional. Helps filter users and understand team ownership.",
    activeHint: "Inactive users cannot log in, but their historical records remain assigned.",
    maxTicketsHint: "Maximum open support tickets assigned to this agent at once.",
  },
  ru: {
    emailHint: "Используется для входа и уведомлений. Изменение email меняет адрес входа пользователя.",
    passwordCreateHint: "Задайте временный пароль. Пользователь сможет изменить его после входа.",
    passwordEditHint: "Оставьте пустым, чтобы сохранить текущий пароль. Заполняйте только для сброса доступа.",
    passwordEditPlaceholder: "Оставьте пустым, чтобы не менять пароль",
    roleHint: "Роль управляет правами в tenant. Viewer подходит для read-only доступа.",
    departmentHint: "Необязательно. Помогает фильтровать пользователей и понимать принадлежность к команде.",
    activeHint: "Неактивные пользователи не могут войти, но исторические записи остаются за ними.",
    maxTicketsHint: "Максимум открытых support tickets, назначенных агенту одновременно.",
  },
  az: {
    emailHint: "Giriş və bildirişlər üçün istifadə olunur. Email dəyişəndə istifadəçinin giriş ünvanı da dəyişir.",
    passwordCreateHint: "Müvəqqəti şifrə təyin edin. İstifadəçi daxil olduqdan sonra dəyişə bilər.",
    passwordEditHint: "Cari şifrə qalsınsa boş saxlayın. Yalnız girişi sıfırlamaq üçün doldurun.",
    passwordEditPlaceholder: "Şifrəni dəyişməmək üçün boş saxlayın",
    roleHint: "Rol tenant üzrə icazələri idarə edir. Yalnız oxumaq üçün Viewer istifadə edin.",
    departmentHint: "İstəyə bağlıdır. İstifadəçiləri filterləməyə və komanda sahibliklərini anlamağa kömək edir.",
    activeHint: "Deaktiv istifadəçilər daxil ola bilməz, amma tarixi qeydlər onlara bağlı qalır.",
    maxTicketsHint: "Agentə eyni anda təyin edilə biləcək maksimum açıq support ticket sayı.",
  },
}

function UserFormDialog({
  open, onOpenChange, onSaved, editUser, orgId, availableRoles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  editUser?: User
  orgId?: string
  availableRoles: RoleConfig[]
}) {
  const isEdit = !!editUser
  const tc = useTranslations("common")
  const ts = useTranslations("settings")
  const tu = useTranslations("settingsUsers")
  const locale = (useLocale() as Loc) || "en"
  const c = USER_FORM_COPY[locale] ?? USER_FORM_COPY.en
  const [form, setForm] = useState<UserFormData>({
    name: "", email: "", password: "", role: "viewer",
    phone: "", department: "", isActive: true,
    maxTickets: 20, preferredLanguage: "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        name: editUser?.name || "",
        email: editUser?.email || "",
        password: "",
        role: editUser?.role || "viewer",
        phone: editUser?.phone || "",
        department: editUser?.department || "",
        isActive: editUser?.isActive ?? true,
        maxTickets: editUser?.maxTickets || 20,
        preferredLanguage: editUser?.preferredLanguage || "",
      })
      setError("")
    }
  }, [open, editUser])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    // Phone is optional, but if present it must be valid E.164 (+ and 7-15 digits).
    // Catching this client-side prevents a round-trip to the backend and gives
    // a focused error message right next to the field.
    if (form.phone !== "" && !/^\+[1-9]\d{6,14}$/.test(form.phone)) {
      setError(tu("phoneInvalidError"))
      setSaving(false)
      return
    }

    try {
      const payload: UserPayload = {
        name: form.name,
        email: form.email,
        role: form.role,
        phone: form.phone || null,
        department: form.department || null,
        isActive: form.isActive,
        maxTickets: form.maxTickets,
        preferredLanguage: form.preferredLanguage || null,
      }
      if (!isEdit) {
        payload.password = form.password
      }

      const url = isEdit ? `/api/v1/users/${editUser!.id}` : "/api/v1/users"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("errorUpdateFailed"))
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <form onSubmit={handleSubmit} autoComplete="off" className="flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{isEdit ? tu("editUser") : tu("addUser")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div>
              <Label htmlFor="name">{tu("fieldName")}</Label>
              <Input id="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" autoComplete="off" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
              <p className="text-xs text-muted-foreground mt-1">{c.emailHint}</p>
            </div>
            {!isEdit && (
              <div>
                <Label htmlFor="password">{tu("fieldPassword")}</Label>
                <Input
                  id="password"
                  name="new-user-password"
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground mt-1">{c.passwordCreateHint}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="role">{tu("fieldRole")}</Label>
                <Select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {(() => {
                    // Only enforce-able roles can be assigned; deny-all roles are
                    // hidden. But keep the user's CURRENT role visible (even if a
                    // legacy/extended one) so the row renders and an admin can
                    // migrate it to a real role.
                    const assignable = availableRoles.filter(r => r.assignable !== false)
                    const opts = (form.role && !assignable.some(r => r.id === form.role))
                      ? [...assignable, { id: form.role, name: form.role, color: "slate", isSystem: false } as RoleConfig]
                      : assignable
                    return opts.map(r => (
                      <option key={r.id} value={r.id}>{ts.has(`role_${r.id}`) ? ts(`role_${r.id}` as never) : r.name}</option>
                    ))
                  })()}
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{c.roleHint}</p>
              </div>
              <div>
                <Label htmlFor="department">{tu("fieldDepartment")}</Label>
                <Input id="department" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
                <p className="text-xs text-muted-foreground mt-1">{c.departmentHint}</p>
              </div>
            </div>
            <div>
              <Label htmlFor="phone">{tu("fieldPhone")}</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={16}
                placeholder="+994501234567"
                value={form.phone}
                onChange={(e) => {
                  // Accept only leading + and digits, strip everything else
                  // as the user types so copy-pasted spaces/dashes/parens
                  // don't get saved verbatim into the DB.
                  let v = e.target.value.replace(/[^\d+]/g, "")
                  if (v.indexOf("+") > 0) v = v.replace(/\+/g, "")
                  setForm((f) => ({ ...f, phone: v.slice(0, 16) }))
                }}
                aria-invalid={form.phone !== "" && !/^\+\d{7,15}$/.test(form.phone)}
                className={
                  form.phone !== "" && !/^\+\d{7,15}$/.test(form.phone)
                    ? "border-destructive focus-visible:ring-destructive"
                    : undefined
                }
              />
              <p className="text-xs text-muted-foreground mt-1">{tu("hintPhone")}</p>
              {form.phone !== "" && !/^\+\d{7,15}$/.test(form.phone) && (
                <p className="text-xs text-destructive mt-1">{tu("phoneFormatError")}</p>
              )}
            </div>
            {/* Briefing language preference */}
            {isEdit && (
              <div>
                <Label htmlFor="preferredLanguage">{ts("briefingLanguage")}</Label>
                <Select value={form.preferredLanguage} onChange={e => setForm(f => ({ ...f, preferredLanguage: e.target.value }))}>
                  <option value="">{ts("useOrgDefault")}</option>
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                  <option value="az">Azərbaycan</option>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{ts("briefingLanguageDesc")}</p>
              </div>
            )}
            {/* Support agent settings — only shown when editing */}
            {isEdit && (
              <>
                <div className="border-t pt-3 mt-1">
                  <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">{tu("supportSettings")}</p>
                </div>
                <div>
                  <Label htmlFor="maxTickets">{tu("fieldMaxTickets")}</Label>
                  <Input
                    id="maxTickets"
                    type="number"
                    min={1}
                    max={100}
                    value={form.maxTickets}
                    onChange={e => setForm(f => ({ ...f, maxTickets: parseInt(e.target.value) || 20 }))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">{c.maxTicketsHint}</p>
                </div>
              </>
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox" id="isActive" checked={form.isActive}
                  onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                  className="h-4 w-4 rounded border-zinc-200 dark:border-zinc-700"
                />
                <Label htmlFor="isActive" className="mb-0 cursor-pointer">{tu("fieldIsActive")}</Label>
              </div>
              <p className="text-xs text-muted-foreground">{c.activeHint}</p>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tu("cancel")}</Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{tu("saving")}</>
              : isEdit ? tu("update") : tu("create")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

function ResetPasswordDialog({
  open,
  onOpenChange,
  onSaved,
  user,
  orgId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  user?: User
  orgId?: string
}) {
  const tu = useTranslations("settingsUsers")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setPassword("")
    setConfirmPassword("")
    setShowPassword(false)
    setCapsLock(false)
    setConfirmed(false)
    setSaving(false)
    setError("")
  }, [open, user?.id])

  if (!user) return null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")
    if (password !== confirmPassword) {
      setError(tu("passwordMismatch"))
      return
    }
    if (!confirmed) {
      setError(tu("passwordResetConfirmationRequired"))
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/v1/users/${user.id}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({ password, confirmPassword }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || tu("passwordResetFailed"))
      }
      toast.success(tu("passwordResetSuccess", { name: user.name }))
      onSaved()
      onOpenChange(false)
    } catch (resetError) {
      setError(errorMessage(resetError))
    } finally {
      setSaving(false)
    }
  }

  const updateCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState("CapsLock"))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <form onSubmit={handleSubmit} autoComplete="off" className="flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{tu("passwordResetTitle", { name: user.name })}</DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {tu("passwordResetDescription")}
          </p>
        </DialogHeader>
        <DialogContent>
          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!user.isActive && (
            <div className="mb-4 flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">{tu("inactivePasswordWarningTitle")}</p>
                <p className="mt-1">{tu("inactivePasswordWarningDescription")}</p>
              </div>
            </div>
          )}

          <div className="grid gap-4">
            <div>
              <Label htmlFor={`reset-password-${user.id}`}>{tu("passwordNew")}</Label>
              <div className="relative">
                <Input
                  id={`reset-password-${user.id}`}
                  name={`reset-password-${user.id}`}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={updateCapsLock}
                  onKeyUp={updateCapsLock}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? tu("hidePassword") : tu("showPassword")}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor={`confirm-password-${user.id}`}>{tu("passwordConfirm")}</Label>
              <Input
                id={`confirm-password-${user.id}`}
                name={`confirm-password-${user.id}`}
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                onKeyDown={updateCapsLock}
                onKeyUp={updateCapsLock}
                autoComplete="new-password"
                minLength={12}
                maxLength={72}
                required
              />
            </div>

            {capsLock && (
              <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                {tu("capsLockOn")}
              </p>
            )}

            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-700">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded"
              />
              <span>{tu("passwordResetConfirmation")}</span>
            </label>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tu("cancel")}
          </Button>
          <Button type="submit" disabled={saving || !confirmed}>
            {saving
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{tu("saving")}</>
              : <><KeyRound className="mr-2 h-4 w-4" />{tu("passwordResetAction")}</>}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

export default function UsersSettingsPage() {
  const { data: session } = useSession()
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const tu = useTranslations("settingsUsers")
  const locale = useLocale()
  useAutoTour("users")
  const [users, setUsers] = useState<User[]>([])
  // Organisation-wide voice ceiling. Admin-only, matching the route's gate:
  // showing a control that always 403s teaches the reader nothing.
  const canEditVoiceBudget = session?.user?.role === "admin" || session?.user?.role === "superadmin"
  const [voiceBudget, setVoiceBudget] = useState<{ minutes: number | null; min: number; max: number; default: number } | null>(null)
  const [voiceMinutesInput, setVoiceMinutesInput] = useState("")
  const [savingVoiceBudget, setSavingVoiceBudget] = useState(false)
  const [availableRoles, setAvailableRoles] = useState<RoleConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editUser, setEditUser] = useState<User | undefined>()
  const [passwordResetUser, setPasswordResetUser] = useState<User | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const orgId = session?.user?.organizationId

  const fetchData = useCallback(async () => {
    const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetch("/api/v1/users", { headers }),
        fetch("/api/v1/settings/roles", { headers }),
      ])
      if (usersRes.ok) {
        const result = await usersRes.json()
        setUsers(result.data || [])
      }
      if (rolesRes.ok) {
        const result = await rolesRes.json()
        if (result.data?.roles) setAvailableRoles(result.data.roles)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }, [orgId])

  useEffect(() => {
    if (!canEditVoiceBudget) return
    fetch("/api/v1/settings/voice-budget")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.data) return
        setVoiceBudget(j.data)
        setVoiceMinutesInput(j.data.minutes === null ? "" : String(j.data.minutes))
      })
      .catch(() => {})
  }, [canEditVoiceBudget])

  const saveVoiceBudget = async () => {
    setSavingVoiceBudget(true)
    try {
      const res = await fetch("/api/v1/settings/voice-budget", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // An empty box means "use the default", so it is sent as null rather
        // than as the number zero.
        body: JSON.stringify({ minutes: voiceMinutesInput.trim() === "" ? null : Number(voiceMinutesInput) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error || tc("saveFailed"))
        return
      }
      setVoiceBudget(json.data)
      setVoiceMinutesInput(json.data.minutes === null ? "" : String(json.data.minutes))
      toast.success(tc("saved"))
    } finally {
      setSavingVoiceBudget(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/v1/users", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      if (res.ok) {
        const result = await res.json()
        setUsers(result.data || [])
      }
    } catch (err) { console.error(err) }
  }

  useEffect(() => { fetchData() }, [fetchData])

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/v1/users/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) {
      const json = await res.json()
      throw new Error(json.error || tc("errorDeleteFailed"))
    }
    fetchUsers()
  }

  const handleToggleActive = async (user: User) => {
    await fetch(`/api/v1/users/${user.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
      },
      body: JSON.stringify({ isActive: !user.isActive }),
    })
    fetchUsers()
  }

  const activeCount = users.filter(u => u.isActive).length
  const adminCount = users.filter(u => u.role === "admin").length

  // System role ids ship with localized labels in the `settings.role_*` keys.
  // Custom org-created roles keep their user-defined name (real data, not a leak).
  const roleLabel = (id: string, fallbackName?: string) =>
    ts.has(`role_${id}`) ? ts(`role_${id}` as never) : (fallbackName || id)

  const actionsColumn = {
    key: "actions",
    label: tu("colActions"),
    className: "w-[15rem] whitespace-nowrap",
    render: (item: User) => (
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          title={tu("editAction")}
          aria-label={tu("editUserNamed", { name: item.name })}
          onClick={(e) => {
            e.stopPropagation()
            setEditUser(item)
            setShowForm(true)
          }}
        >
          <Pencil className="h-4 w-4" />
          {/* The word is dropped below xl so the row fits: this table already
              carries eleven columns, and the pencil plus the title attribute
              say the same thing in a quarter of the width. */}
          <span className="hidden xl:inline">{tu("editAction")}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={tu("passwordResetAction")}
          aria-label={tu("passwordResetUserNamed", { name: item.name })}
          onClick={(e) => {
            e.stopPropagation()
            setPasswordResetUser(item)
          }}
        >
          <KeyRound className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={tu("deleteAction")}
          aria-label={tu("deleteUserNamed", { name: item.name })}
          onClick={(e) => {
            e.stopPropagation()
            setDeleteId(item.id)
            setDeleteName(item.name)
          }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    ),
  }

  const columns = [
    {
      // Pinned. Twelve columns cannot fit any screen, so the table scrolls
      // sideways — and a scrolled-away name turns every other cell into a row
      // of values belonging to nobody.
      key: "name", label: tu("colUser"), sortable: true,
      className: "sticky left-0 z-20 bg-card group-hover:bg-muted/50",
      headClassName: "bg-muted",
      render: (item: User) => (
        <div>
          <div className="font-medium">{item.name}</div>
          <div className="text-xs text-muted-foreground">{item.email}</div>
        </div>
      ),
    },
    // Keep the primary row action next to the user's identity. The table has
    // many operational columns and scrolls horizontally on laptop screens;
    // placing actions at the far end made editing effectively undiscoverable.
    actionsColumn,
    {
      key: "role", label: tu("colRole"), sortable: true,
      render: (item: User) => {
        const roleConfig = availableRoles.find(r => r.id === item.role)
        const colorClass = roleConfig ? (COLOR_MAP[roleConfig.color] || COLOR_MAP.slate) : COLOR_MAP.gray
        return (
          <Badge className={`${colorClass} gap-1`}>
            {ROLE_ICONS[item.role]}{roleLabel(item.role, roleConfig?.name)}
          </Badge>
        )
      },
    },
    {
      key: "department", label: tu("colDepartment"), sortable: true,
      className: "hidden xl:table-cell",
      render: (item: User) => (
        <span className="text-sm">{item.department || "—"}</span>
      ),
    },
    {
      key: "skills", label: tu("colSkills"),
      className: "hidden 2xl:table-cell",
      render: (item: User) => (
        <div className="flex flex-wrap gap-1">
          {item.skills && item.skills.length > 0 ? (
            item.skills.map((s) => (
              <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      key: "maxTickets", label: tu("colMaxTickets"),
      className: "hidden xl:table-cell",
      render: (item: User) => (
        <span className="text-sm font-mono">{item.maxTickets || 20}</span>
      ),
    },
    {
      key: "isAvailable", label: tu("colAvailable"),
      render: (item: User) => (
        <button
          type="button"
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            item.isAvailable ? "bg-green-500" : "bg-muted-foreground/40"
          }`}
          onClick={async (e) => {
            e.stopPropagation()
            await fetch(`/api/v1/users/${item.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
              body: JSON.stringify({ isAvailable: !item.isAvailable }),
            })
            fetchUsers()
          }}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
            item.isAvailable ? "translate-x-4" : "translate-x-0"
          }`} />
        </button>
      ),
    },
    {
      key: "isActive", label: tu("colStatus"), sortable: true,
      render: (item: User) => (
        <Badge
          className={`cursor-pointer ${item.isActive
            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
            : "bg-muted text-muted-foreground"
          }`}
          onClick={() => handleToggleActive(item)}
        >
          {item.isActive ? tu("statusActive") : tu("statusInactive")}
        </Badge>
      ),
    },
    {
      // Two dates about the same account, in one column instead of two. They
      // were the widest pair in the table and always read together anyway.
      // Sorting stays on the last login, which is the one anybody sorts by.
      key: "lastLogin", label: tu("colLastLogin"), sortable: true,
      className: "whitespace-nowrap",
      render: (item: User) => (
        <div className="text-sm leading-tight">
          <div>
            {item.lastLogin
              ? formatDate(item.lastLogin, locale, {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })
              : <span className="text-muted-foreground">{tu("never")}</span>
            }
          </div>
          <div className="text-[11px] text-muted-foreground">
            {tu("colPasswordReset")}:{" "}
            {item.passwordChangedAt
              ? formatDate(item.passwordChangedAt, locale, {
                  day: "2-digit", month: "short", year: "numeric",
                })
              : tu("never")
            }
          </div>
        </div>
      ),
    },
    {
      key: "totpEnabled", label: "2FA",
      // The three controls used to wrap onto three lines in a narrow column,
      // which made every row in the table three lines tall. They stay on one
      // line now and the column carries its own width instead.
      className: "whitespace-nowrap",
      render: (item: User) => {
        const anyMethodActive = item.totpEnabled || item.smsAuthEnabled
        return (
          <div className="flex flex-nowrap items-center gap-1.5">
            {/* TOTP status pill — clickable to reset */}
            <button
              type="button"
              title={item.totpEnabled ? tu("totpSetTooltip") : tu("totpNotSetTooltip")}
              className={`text-[10px] px-1.5 py-0.5 rounded border font-medium transition ${
                item.totpEnabled
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                  : "bg-muted/40 text-muted-foreground border-muted"
              }`}
              onClick={async (e) => {
                e.stopPropagation()
                if (!item.totpEnabled) return
                if (!confirm(tu("totpResetConfirm"))) return
                await fetch(`/api/v1/users/${item.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
                  body: JSON.stringify({ resetTotp: true }),
                })
                fetchUsers()
              }}
            >
              TOTP {item.totpEnabled ? "✓" : "—"}
            </button>
            {/* SMS status pill — clickable to reset */}
            <button
              type="button"
              title={
                item.smsAuthEnabled
                  ? tu("smsSetTooltip", { phone: item.verifiedPhone || "—" })
                  : tu("smsNotSetTooltip")
              }
              className={`text-[10px] px-1.5 py-0.5 rounded border font-medium transition ${
                item.smsAuthEnabled
                  ? "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100"
                  : "bg-muted/40 text-muted-foreground border-muted"
              }`}
              onClick={async (e) => {
                e.stopPropagation()
                if (!item.smsAuthEnabled) return
                if (!confirm(tu("smsResetConfirm"))) return
                await fetch(`/api/v1/users/${item.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
                  body: JSON.stringify({ resetSms: true }),
                })
                fetchUsers()
              }}
            >
              SMS {item.smsAuthEnabled ? "✓" : "—"}
            </button>
            {/* Require 2FA toggle */}
            <button
              type="button"
              title={tu("require2faTooltip")}
              className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors ${
                item.require2fa || anyMethodActive ? "bg-green-500" : "bg-muted-foreground/40"
              }`}
              onClick={async (e) => {
                e.stopPropagation()
                await fetch(`/api/v1/users/${item.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
                  body: JSON.stringify({ require2fa: !(item.require2fa || anyMethodActive) }),
                })
                fetchUsers()
              }}
            >
              <span className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${
                item.require2fa || anyMethodActive ? "translate-x-3" : "translate-x-0"
              }`} />
            </button>
          </div>
        )
      },
    },
    {
      // The microphone used to sit as a second unlabelled switch inside the 2FA
      // cell, directly under the require-2FA one. Nobody could tell which was
      // which, and the floating assistant button covered it. A control that
      // grants a paid third-party session over the tenant's data has to be
      // readable at a glance, so it gets its own labelled column.
      key: "voiceEnabled", label: tu("voiceColumn"),
      render: (item: User) => {
        // Only admins and managers may hold it — the gate refuses other roles
        // anyway, so offering the switch would promise access that never
        // arrives. They get a dash rather than an empty cell, so the column
        // reads as "not applicable" instead of "not loaded".
        if (!(item.role === "admin" || item.role === "manager" || item.role === "superadmin")) {
          return <span className="text-muted-foreground">—</span>
        }
        return (
          <button
            type="button"
            title={tu("voiceEnabledTooltip")}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors ${
              item.voiceEnabled ? "bg-primary" : "bg-muted-foreground/40"
            }`}
            onClick={async (e) => {
              e.stopPropagation()
              await fetch(`/api/v1/users/${item.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
                body: JSON.stringify({ voiceEnabled: !item.voiceEnabled }),
              })
              fetchUsers()
            }}
          >
            <span className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${
              item.voiceEnabled ? "translate-x-3" : "translate-x-0"
            }`} />
          </button>
        )
      },
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{tu("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}
          </div>
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {tu("titleWithCount", { count: users.length })} <TourReplayButton tourId="users" />
            <HelpButton slug="users" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground">{ts("hintUsers")}</p>
        </div>
        <Button data-tour-id="users-new" onClick={() => { setEditUser(undefined); setShowForm(true) }}>
          <Plus className="h-4 w-4 mr-1" /> {tu("add")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title={tu("statTotal")} value={users.length} icon={<Users className="h-4 w-4" />} />
        <StatCard title={tu("statActive")} value={activeCount} icon={<UserCheck className="h-4 w-4" />} />
        <StatCard title={tu("statInactive")} value={users.length - activeCount} icon={<UserX className="h-4 w-4" />} />
        <StatCard title={tu("statAdmins")} value={adminCount} icon={<Shield className="h-4 w-4" />} />
      </div>

      {/* The microphone column below says WHO may talk to the assistant; this
          says how much talking the organisation will pay for in a month. Both
          belong on the same screen — otherwise the ceiling lives in an
          environment variable nobody can see, which is where it lived when a
          customer topped up their provider balance and still read "expired".
          The two numbers are unrelated: that one is the provider's, this one is
          ours. */}
      {canEditVoiceBudget && (
        <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <Label htmlFor="voice-monthly-minutes" className="text-sm font-medium">{tu("voiceBudgetLabel")}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{tu("voiceBudgetHint")}</p>
            </div>
            <Input
              id="voice-monthly-minutes"
              type="number"
              inputMode="numeric"
              min={voiceBudget?.min ?? 1}
              max={voiceBudget?.max ?? 100000}
              className="w-32"
              // Empty is a real state: it means "use the default", which is not
              // the same as zero and must stay expressible.
              placeholder={voiceBudget ? String(voiceBudget.default) : ""}
              value={voiceMinutesInput}
              onChange={(e) => setVoiceMinutesInput(e.target.value)}
            />
            <Button onClick={saveVoiceBudget} disabled={savingVoiceBudget}>
              {savingVoiceBudget ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {tc("save")}
            </Button>
          </div>
        </div>
      )}

      {users.length === 0 ? (
        <div data-tour-id="users-list" className="flex flex-col items-center justify-center rounded-lg border border-zinc-200 py-12 text-center dark:border-zinc-700">
          <Users className="mb-3 h-9 w-9 text-muted-foreground/40" />
          <p className="font-medium">{tu("noUsers")}</p>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">{tu("noUsersHint")}</p>
          <Button className="mt-4" onClick={() => { setEditUser(undefined); setShowForm(true) }}>
            <Plus className="h-4 w-4 mr-1" /> {tu("add")}
          </Button>
        </div>
      ) : (
        <div data-tour-id="users-list">
          <DataTable<User> data={users} columns={columns} searchKey="name" searchPlaceholder={tu("searchPlaceholder")} />
        </div>
      )}

      <UserFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        onSaved={fetchUsers}
        editUser={editUser}
        orgId={orgId}
        availableRoles={availableRoles}
      />

      <ResetPasswordDialog
        open={!!passwordResetUser}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPasswordResetUser(undefined)
        }}
        onSaved={fetchUsers}
        user={passwordResetUser}
        orgId={orgId}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={tu("deleteTitle")}
        itemName={deleteName}
      />
    </div>
  )
}
