"use client"

/**
 * /profile — the self-service "personal cabinet".
 *
 * Accessible to ALL roles (sales, support, viewer, admin …), NOT under
 * /settings (which is admin-gated). The (dashboard) layout's direct-URL guard
 * (`moduleBlocked`) only fires when `matchNavItem(pathname)` resolves to a nav
 * item; `/profile` is intentionally NOT in `navItems`, so `matchNavItem` returns
 * undefined → `moduleBlocked` is false → the page renders for every role. The
 * real data boundary is the API itself (requireAuth on each /users/me route).
 *
 * Form pattern mirrors settings/notifications: plain useState + fetch + sonner
 * toast, UI primitives from components/ui. No react-hook-form, no new deps.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslations, useLocale } from "next-intl"
import { signOut } from "next-auth/react"
import { useTheme } from "next-themes"
import Link from "next/link"
import { toast } from "sonner"
import { formatDateTime } from "@/lib/format-date"
import { signOutCallbackUrl } from "@/lib/tenant-domain"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { WallpaperSelector } from "@/components/wallpaper-selector"
import { HelpButton } from "@/components/help/help-button"
import {
  User, Loader2, Upload, KeyRound, ShieldCheck, ShieldOff, Smartphone, LogOut, ChevronRight,
  Globe, Clock, Palette, Sun, Moon, Activity as ActivityIcon, Bell,
} from "lucide-react"

/**
 * Curated IANA time zones offered in the profile (a short, regionally-relevant
 * list rather than the full ~400-entry tz database). The PATCH endpoint accepts
 * any string up to 64 chars, so this is purely a UX convenience.
 */
const TIMEZONES = [
  "Europe/Warsaw",
  "Asia/Baku",
  "Europe/Moscow",
  "Europe/London",
  "Europe/Istanbul",
  "Europe/Kyiv",
  "Asia/Dubai",
  "America/New_York",
  "UTC",
] as const

interface MeProfile {
  id: string
  name: string
  email: string
  phone: string | null
  department: string | null
  avatar: string | null
  preferredLanguage: "ru" | "en" | "az" | null
  timezone: string | null
  role: string
  totpEnabled: boolean
  smsAuthEnabled: boolean
  lastLogin: string | null
  loginCount: number
}

export default function ProfilePage() {
  const t = useTranslations("profile")
  const [profile, setProfile] = useState<MeProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/users/me")
      const json = await res.json()
      if (res.ok && json.success) {
        setProfile(json.data as MeProfile)
      } else {
        toast.error(t("loadError"))
      }
    } catch {
      toast.error(t("loadError"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-4 w-80 rounded bg-muted" />
          {[1, 2].map((i) => (
            <div key={i} className="h-40 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl py-20 text-center text-muted-foreground">
        {t("loadError")}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <User className="h-6 w-6 text-primary" />
          {t("title")}
          <HelpButton slug="profile" variant="label" />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <PersonalInfoSection profile={profile} setProfile={setProfile} />
      <ChangePasswordSection />
      <SecuritySection profile={profile} />
      <LanguageRegionSection profile={profile} setProfile={setProfile} />
      <AppearanceSection />
      <ActivitySection profile={profile} />
    </div>
  )
}

/* ─────────────────────────── Personal Information ─────────────────────────── */

function PersonalInfoSection({
  profile,
  setProfile,
}: {
  profile: MeProfile
  setProfile: React.Dispatch<React.SetStateAction<MeProfile | null>>
}) {
  const t = useTranslations("profile")
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(profile.name ?? "")
  const [phone, setPhone] = useState(profile.phone ?? "")
  const [department, setDepartment] = useState(profile.department ?? "")
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const initial = (profile.name || profile.email || "?").charAt(0).toUpperCase()

  const handleSave = async () => {
    setSaving(true)
    // Send only changed fields; empty optional strings become null (the API
    // accepts null for phone/department to clear them).
    const payload: Record<string, string | null> = {}
    if (name !== (profile.name ?? "")) payload.name = name
    if (phone !== (profile.phone ?? "")) payload.phone = phone === "" ? null : phone
    if (department !== (profile.department ?? "")) payload.department = department === "" ? null : department

    if (Object.keys(payload).length === 0) {
      setSaving(false)
      toast.success(t("saved"))
      return
    }

    try {
      const res = await fetch("/api/v1/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success) {
        setProfile((p) => (p ? { ...p, ...json.data } : p))
        toast.success(t("saved"))
      } else {
        toast.error(json.error || t("saveError"))
      }
    } catch {
      toast.error(t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarPick = () => fileRef.current?.click()

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset the input so picking the same file again re-triggers change.
    e.target.value = ""
    if (!file) return

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/v1/users/me/avatar", { method: "POST", body: fd })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success && json.url) {
        setProfile((p) => (p ? { ...p, avatar: json.url } : p))
        toast.success(t("avatarUpdated"))
      } else {
        toast.error(json.error || t("avatarError"))
      }
    } catch {
      toast.error(t("avatarError"))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("personalInfo")}</CardTitle>
        <CardDescription>{t("personalInfoDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          {profile.avatar ? (
            <img
              src={profile.avatar}
              alt={profile.name || profile.email}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
              {initial}
            </span>
          )}
          <div className="space-y-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <Button variant="outline" size="sm" onClick={handleAvatarPick} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? t("uploading") : t("uploadAvatar")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("avatarHint")}</p>
          </div>
        </div>

        {/* Fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">{t("name")}</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-phone">{t("phone")}</Label>
            <Input
              id="profile-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("phonePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-department">{t("department")}</Label>
            <Input
              id="profile-department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder={t("departmentPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">{t("email")}</Label>
            <Input
              id="profile-email"
              type="email"
              value={profile.email}
              readOnly
              aria-describedby="profile-email-help"
              className="bg-muted/50"
            />
            <p id="profile-email-help" className="text-xs text-muted-foreground">
              {t("emailReadOnly")}
            </p>
          </div>
        </div>

        {/* Read-only role */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t("role")}:</span>
          <Badge variant="brand" className="capitalize">
            {profile.role}
          </Badge>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* ─────────────────────────────── Change Password ─────────────────────────── */

function ChangePasswordSection() {
  const t = useTranslations("profile")
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Client-side guards before hitting the API.
    if (Array.from(next).length < 12) {
      toast.error(t("passwordMinLength"))
      return
    }
    if (next !== confirm) {
      toast.error(t("passwordMismatch"))
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/v1/users/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success) {
        // Password change bumps passwordChangedAt → the current session is now
        // stale. Tell the user, then force re-auth.
        toast.success(t("passwordChanged"))
        setTimeout(() => signOut({ callbackUrl: signOutCallbackUrl() }), 800)
        return
      }
      // The API returns 400 both for a wrong current password and for "new ==
      // current"; show the specific message it sends, falling back to the
      // wrong-password copy.
      if (res.status === 400) {
        toast.error(json.error || t("passwordIncorrect"))
      } else {
        toast.error(json.error || t("saveError"))
      }
    } catch {
      toast.error(t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          {t("changePassword")}
        </CardTitle>
        <CardDescription>{t("changePasswordDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cp-current">{t("currentPassword")}</Label>
            <Input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-new">{t("newPassword")}</Label>
              <Input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                minLength={12}
                maxLength={72}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-confirm">{t("confirmNewPassword")}</Label>
              <Input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={12}
                maxLength={72}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !current || !next || !confirm}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? t("saving") : t("updatePassword")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/* ───────────────────────────────── Security ──────────────────────────────── */

function SecuritySection({ profile }: { profile: MeProfile }) {
  const t = useTranslations("profile")
  const [revoking, setRevoking] = useState(false)

  const handleLogoutAll = async () => {
    if (!window.confirm(t("logoutAllConfirm"))) return
    setRevoking(true)
    try {
      const res = await fetch("/api/v1/users/me/revoke-sessions", { method: "POST" })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success) {
        // Revoking bumps passwordChangedAt → current session is stale too.
        signOut({ callbackUrl: signOutCallbackUrl() })
        return
      }
      toast.error(json.error || t("logoutAllError"))
      setRevoking(false)
    } catch {
      toast.error(t("logoutAllError"))
      setRevoking(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          {t("security")}
        </CardTitle>
        <CardDescription>{t("securityDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 2FA status — managed on the dedicated /settings/security page */}
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{t("twoFactorTotp")}</span>
            </div>
            <Badge variant={profile.totpEnabled ? "success" : "secondary"}>
              {profile.totpEnabled ? t("enabled") : t("disabled")}
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{t("twoFactorSms")}</span>
            </div>
            <Badge variant={profile.smsAuthEnabled ? "success" : "secondary"}>
              {profile.smsAuthEnabled ? t("enabled") : t("disabled")}
            </Badge>
          </div>
          <Link
            href="/settings/security"
            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-primary hover:bg-muted/60 transition-colors"
          >
            <span>{t("manageSecurity")}</span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Log out of all devices */}
        <div className="flex items-center justify-between gap-4 border-t border-zinc-200/60 dark:border-zinc-700/60 pt-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldOff className="h-4 w-4 text-muted-foreground" />
              {t("logoutAllDevices")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("logoutAllDevicesDesc")}</p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleLogoutAll} disabled={revoking} className="shrink-0">
            {revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {t("logoutAllDevices")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* ───────────────────────────── Language & Region ─────────────────────────── */

function LanguageRegionSection({
  profile,
  setProfile,
}: {
  profile: MeProfile
  setProfile: React.Dispatch<React.SetStateAction<MeProfile | null>>
}) {
  const t = useTranslations("profile")
  const [savingTz, setSavingTz] = useState(false)

  // PATCH a single profile field, with toast feedback. Returns true on success.
  const patchField = async (
    payload: Record<string, string | null>,
    successKey: "languageSaved" | "timezoneSaved",
  ): Promise<boolean> => {
    try {
      const res = await fetch("/api/v1/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success) {
        setProfile((p) => (p ? { ...p, ...json.data } : p))
        toast.success(t(successKey))
        return true
      }
      toast.error(json.error || t("saveError"))
      return false
    } catch {
      toast.error(t("saveError"))
      return false
    }
  }

  const handleLanguageChange = async (lang: string) => {
    // Dual-write: persist to the profile (durable, applies on every device on
    // next load) AND set the NEXT_LOCALE cookie + reload so the UI switches
    // immediately here (mirrors language-switcher.tsx). We set the cookie only
    // after the PATCH succeeds so a rejected change doesn't desync the cookie.
    const ok = await patchField({ preferredLanguage: lang }, "languageSaved")
    if (!ok) return
    document.cookie = `NEXT_LOCALE=${lang};path=/;max-age=${365 * 24 * 60 * 60}`
    window.location.reload()
  }

  const handleTimezoneChange = async (tz: string) => {
    setSavingTz(true)
    await patchField({ timezone: tz }, "timezoneSaved")
    setSavingTz(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          {t("languageRegion")}
        </CardTitle>
        <CardDescription>{t("languageRegionDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-language">{t("language")}</Label>
            <Select
              id="profile-language"
              value={profile.preferredLanguage ?? "ru"}
              onChange={(e) => handleLanguageChange(e.target.value)}
            >
              <option value="ru">{t("languageRu")}</option>
              <option value="az">{t("languageAz")}</option>
              <option value="en">{t("languageEn")}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-timezone" className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {t("timezone")}
            </Label>
            <Select
              id="profile-timezone"
              value={profile.timezone ?? "UTC"}
              disabled={savingTz}
              onChange={(e) => handleTimezoneChange(e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ──────────────────────────────── Appearance ─────────────────────────────── */

function AppearanceSection() {
  const t = useTranslations("profile")
  const { resolvedTheme, setTheme } = useTheme()
  // next-themes resolves the theme client-side only — `resolvedTheme` is
  // undefined during SSR / before hydration. We derive the active pill straight
  // from it (no mount-flag setState, which the lint rule forbids in an effect)
  // and mark the toggle row `suppressHydrationWarning` so the brief
  // server(unknown)→client(known) flip on the active button doesn't warn.
  const isDark = resolvedTheme === "dark"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-muted-foreground" />
          {t("appearance")}
        </CardTitle>
        <CardDescription>{t("appearanceDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Theme toggle — reuses next-themes (same hook as the header) */}
        <div className="flex items-center justify-between" suppressHydrationWarning>
          <span className="flex items-center gap-2 text-sm font-medium">
            {isDark ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
            {t("theme")}
          </span>
          <div className="inline-flex rounded-full border border-zinc-200/70 dark:border-zinc-700/70 p-0.5">
            <button
              type="button"
              onClick={() => setTheme("light")}
              aria-pressed={!isDark}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                !isDark ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              {t("themeLight")}
            </button>
            <button
              type="button"
              onClick={() => setTheme("dark")}
              aria-pressed={isDark}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                isDark ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              {t("themeDark")}
            </button>
          </div>
        </div>

        {/* Wallpaper — reuses the existing WallpaperSelector popover */}
        <div className="flex items-center justify-between border-t border-zinc-200/60 dark:border-zinc-700/60 pt-4">
          <span className="text-sm font-medium">{t("wallpaper")}</span>
          <WallpaperSelector />
        </div>
      </CardContent>
    </Card>
  )
}

/* ───────────────────────────────── Activity ──────────────────────────────── */

function ActivitySection({ profile }: { profile: MeProfile }) {
  const t = useTranslations("profile")
  const locale = useLocale()
  const lastLogin = profile.lastLogin ? formatDateTime(profile.lastLogin, locale) : t("never")

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ActivityIcon className="h-4 w-4 text-muted-foreground" />
          {t("activity")}
        </CardTitle>
        <CardDescription>{t("activityDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{t("lastLogin")}</p>
            <p className="mt-0.5 text-sm font-medium">{lastLogin}</p>
          </div>
          <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{t("loginCount")}</p>
            <p className="mt-0.5 text-sm font-medium">{profile.loginCount ?? 0}</p>
          </div>
        </div>
        <Link
          href="/settings/notifications"
          className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-primary hover:bg-muted/60 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            {t("notificationSettings")}
          </span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
