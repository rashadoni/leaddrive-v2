"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Loader2, Save, Check, Handshake, Mail, MessageSquare, Ticket, Wallet, BarChart3, Target, MapPin, Settings, Zap, Upload, X, Sparkles, HeartPulse, Umbrella, Landmark, Tv2, Flame, FileText, Award, Activity, Phone } from "lucide-react"
import Link from "next/link"
import { MODULE_REGISTRY, type ModuleId, ADDON_MODULES, withRequiredModules } from "@/lib/modules"
import { Switch } from "@/components/ui/switch"
import {
  SIDEBAR_SECTIONS,
  TOGGLEABLE_MODULES,
  countEnabledModules,
  enableAllModules,
  clearAllModules,
  CAPABILITY_SECTIONS,
  isCapabilityEnabled,
  enableCapability,
  disableCapability,
} from "@/lib/admin-sidebar-catalog"

// SIDEBAR_SECTIONS + TOGGLEABLE_MODULES are derived from the live `navItems`
// (see src/lib/admin-sidebar-catalog.ts) — single source of truth, so this
// admin module catalog can never silently drift from the real sidebar again.

// AI Automation features — pair of shadow (safe) + live (autonomous) per scenario
const AI_AUTOMATION_FEATURES: { scenario: string; label: string; shadowKey: string; liveKey: string; note: string }[] = [
  { scenario: "analytics_briefing",  label: "Daily Briefing",         shadowKey: "ai_daily_briefing",        liveKey: "ai_daily_briefing",        note: "Morning digest email (analytics only, no actions)" },
  { scenario: "analytics_anomaly",   label: "Anomaly Detection",      shadowKey: "ai_anomaly_detection",     liveKey: "ai_anomaly_detection",     note: "Spots spikes + alerts (no actions)" },
  { scenario: "analytics_lead",      label: "Lead Scoring",           shadowKey: "ai_lead_scoring",          liveKey: "ai_lead_scoring",          note: "Enhanced lead scoring" },
  { scenario: "hot_lead",            label: "Hot Lead Escalation",    shadowKey: "ai_auto_hot_lead_shadow",  liveKey: "ai_auto_hot_lead",         note: "Score ≥80 → reassign senior" },
  { scenario: "triage",              label: "Ticket Auto-Triage",     shadowKey: "ai_auto_triage_shadow",    liveKey: "ai_auto_triage",           note: "AI sets category/priority/tags" },
  { scenario: "stage_advance",       label: "Deal Stage Advance",     shadowKey: "ai_auto_stage_advance_shadow", liveKey: "ai_auto_stage_advance", note: "Stuck deals → next stage" },
  { scenario: "acknowledge",         label: "SLA Auto-Response",      shadowKey: "ai_auto_acknowledge_shadow", liveKey: "ai_auto_acknowledge",    note: "Auto-reply before SLA breach" },
  { scenario: "followup",            label: "Stale Deal Follow-Up",   shadowKey: "ai_auto_followup_shadow",  liveKey: "ai_auto_followup",         note: "7+ days inactive → create task" },
  { scenario: "payment_reminder",    label: "Payment Reminder",       shadowKey: "ai_auto_payment_reminder_shadow", liveKey: "ai_auto_payment_reminder", note: "Overdue invoice → journey" },
  { scenario: "renewal",             label: "Contract Renewal",       shadowKey: "ai_auto_renewal_shadow",   liveKey: "ai_auto_renewal",          note: "30d before end → AI drafts proposal" },
  { scenario: "sentiment",           label: "Negative Sentiment",     shadowKey: "ai_auto_sentiment_shadow", liveKey: "ai_auto_sentiment",        note: "Angry ticket → senior escalation" },
  { scenario: "kb_close",            label: "KB Auto-Close",          shadowKey: "ai_auto_kb_close_shadow",  liveKey: "ai_auto_kb_close",         note: "Ticket matches KB → close with link" },
  { scenario: "duplicate",           label: "Duplicate Merge",        shadowKey: "ai_auto_duplicate_shadow", liveKey: "ai_auto_duplicate",        note: "Same email/phone → suggest merge" },
  { scenario: "credit_limit",        label: "Credit Limit Warning",   shadowKey: "ai_auto_credit_limit_shadow", liveKey: "ai_auto_credit_limit",  note: "Outstanding ≥80% of limit → AR task" },
  { scenario: "meeting_recap",       label: "Meeting Recap",          shadowKey: "ai_auto_meeting_recap_shadow", liveKey: "ai_auto_meeting_recap", note: "Webhook transcript → AI recap + next steps" },
  { scenario: "social_reply",        label: "Social AI Reply",        shadowKey: "ai_auto_social_reply_shadow", liveKey: "ai_auto_social_reply", note: "AI drafts reply to negative/neutral mentions" },
  { scenario: "social_viral",        label: "Social Viral Alert",     shadowKey: "ai_auto_social_viral_shadow", liveKey: "ai_auto_social_viral", note: "High-reach mentions → senior alert" },
]

// NB: group order + which groups exist are DERIVED from navItems (via
// SIDEBAR_SECTIONS / NAV_GROUP_ORDER) — this map only supplies per-group styling.
// The old hand-maintained GROUP_ORDER const was dead (never referenced) and
// listed a phantom "ERP" group that no nav item uses, so it was removed.
const GROUP_STYLE: Record<string, { icon: any; color: string; bg: string; border: string }> = {
  CRM:                  { icon: Handshake,  color: "text-sky-500",    bg: "bg-sky-50",     border: "border-sky-200" },
  Sales:                { icon: Target,     color: "text-red-500",    bg: "bg-red-50",     border: "border-red-200" },
  "Contracts Control":  { icon: FileText,   color: "text-blue-600",   bg: "bg-blue-50",    border: "border-blue-300" },
  Marketing:        { icon: Mail,          color: "text-orange-500", bg: "bg-orange-50",  border: "border-orange-200" },
  "Loyalty Program": { icon: Award,         color: "text-lime-600",   bg: "bg-lime-50",    border: "border-lime-200" },
  Communication:    { icon: MessageSquare, color: "text-blue-500",   bg: "bg-blue-50",    border: "border-blue-200" },
  "Social Monitoring": { icon: Activity,   color: "text-green-600",  bg: "bg-green-50",   border: "border-green-200" },
  VoIP:             { icon: Phone,         color: "text-cyan-600",   bg: "bg-cyan-50",    border: "border-cyan-200" },
  Support:          { icon: Ticket,        color: "text-emerald-500",bg: "bg-emerald-50", border: "border-emerald-200" },
  Finance:          { icon: Wallet,        color: "text-amber-500",  bg: "bg-amber-50",   border: "border-amber-200" },
  Analytics:        { icon: BarChart3,     color: "text-purple-500", bg: "bg-purple-50",  border: "border-purple-200" },
  "Route & Field":  { icon: MapPin,        color: "text-cyan-500",   bg: "bg-cyan-50",    border: "border-cyan-200" },
  // Phase-7 industry clouds — now surfaced via navItems derivation (were absent
  // from the old hand-maintained catalog), styled to match the sidebar palette.
  "Health Cloud":       { icon: HeartPulse, color: "text-rose-500",    bg: "bg-rose-50",    border: "border-rose-200" },
  "Insurance Cloud":    { icon: Umbrella,   color: "text-violet-500",  bg: "bg-violet-50",  border: "border-violet-200" },
  "Public Sector":      { icon: Landmark,   color: "text-teal-500",    bg: "bg-teal-50",    border: "border-teal-200" },
  "Media Cloud":        { icon: Tv2,        color: "text-fuchsia-500", bg: "bg-fuchsia-50", border: "border-fuchsia-200" },
  "Energy & Utilities": { icon: Flame,      color: "text-yellow-500",  bg: "bg-yellow-50",  border: "border-yellow-200" },
  Settings:         { icon: Settings,      color: "text-zinc-500",   bg: "bg-zinc-50",    border: "border-zinc-200" },
}

interface TenantData {
  id: string
  name: string
  slug: string
  plan: string
  maxUsers: number
  maxContacts: number
  branding: any
  features: any
  isActive: boolean
  serverType: string
  provisionedAt: string | null
  createdAt: string
}

export default function TenantEditPage() {
  const router = useRouter()
  const params = useParams()
  const tenantId = params.id as string
  const t = useTranslations("admin")
  // Nav-item labels live in the "nav" namespace (same keys the sidebar uses),
  // so the derived catalog resolves item.tKey through this.
  const tNav = useTranslations("nav")

  const [tenant, setTenant] = useState<TenantData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: "",
    slug: "",
    plan: "starter",
    maxUsers: 3,
    maxContacts: 500,
    primaryColor: "#6C63FF",
    logo: "",
    features: [] as string[],
    addons: [] as string[],
    orgLanguage: "",
    aiDailyBudgetUsd: "",
    landingPath: "",
  })

  useEffect(() => {
    fetch(`/api/v1/admin/tenants/${tenantId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.data) {
          const t = res.data
          setTenant(t)
          const branding = typeof t.branding === "string" ? JSON.parse(t.branding || "{}") : (t.branding || {})
          const featuresRaw = typeof t.features === "string" ? JSON.parse(t.features || "[]") : (t.features || [])
          const settings = typeof t.settings === "string" ? JSON.parse(t.settings || "{}") : (t.settings || {})
          setForm({
            name: t.name,
            slug: t.slug,
            plan: t.plan,
            maxUsers: t.maxUsers,
            maxContacts: t.maxContacts,
            primaryColor: branding.primaryColor || "#6C63FF",
            logo: branding.logo || "",
            features: withRequiredModules(featuresRaw),
            addons: Array.isArray(t.addons) ? t.addons : [],
            orgLanguage: settings.language || settings.locale || "",
            landingPath: typeof settings.landingPath === "string" ? settings.landingPath : "",
            aiDailyBudgetUsd: settings.aiDailyBudgetUsd != null ? String(settings.aiDailyBudgetUsd) : "",
          })
        }
      })
      .catch(() => setError(t("tenants.error")))
      .finally(() => setLoading(false))
  }, [tenantId])

  function toggleFeature(id: string) {
    setForm((prev) => {
      const isEnabled = prev.features.includes(id)
      const requiredByEnabledModule = isEnabled && (Object.entries(MODULE_REGISTRY) as [ModuleId, { requires: ModuleId[] }][]).some(([moduleId, definition]) => (
        prev.features.includes(moduleId) && moduleId !== id && definition.requires.includes(id as ModuleId)
      ))
      if (requiredByEnabledModule) return prev

      return {
        ...prev,
        features: isEnabled
          ? prev.features.filter((feature) => feature !== id)
          : withRequiredModules([...prev.features, id]),
      }
    })
  }

  function toggleAddon(id: string) {
    setForm((prev) => ({
      ...prev,
      addons: prev.addons.includes(id)
        ? prev.addons.filter((a) => a !== id)
        : [...prev.addons, id],
    }))
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoPreview(URL.createObjectURL(file))
    setLogoUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/v1/admin/upload-logo", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Logo upload failed")
        setLogoPreview(null)
        return
      }
      setForm((prev) => ({ ...prev, logo: data.url }))
    } catch {
      setError("Logo upload failed")
      setLogoPreview(null)
    } finally {
      setLogoUploading(false)
    }
  }

  function removeLogo() {
    setForm((prev) => ({ ...prev, logo: "" }))
    setLogoPreview(null)
  }

  async function handleSave() {
    setSaving(true)
    setError("")
    setSaved(false)
    try {
      const settingsPatch: Record<string, any> = {}
      if (form.orgLanguage) settingsPatch.language = form.orgLanguage
      else settingsPatch.language = null
      const budgetNum = form.aiDailyBudgetUsd.trim() === "" ? null : Number(form.aiDailyBudgetUsd)
      if (budgetNum !== null && (!isFinite(budgetNum) || budgetNum < 0)) {
        setError("Invalid AI daily budget")
        setSaving(false)
        return
      }
      settingsPatch.aiDailyBudgetUsd = budgetNum
      // Стартовая страница тенанта: пусто = автоподбор (первый доступный пункт
      // меню). Значение читает JWT и редирект с «/» (см. lib/tenant-landing).
      settingsPatch.landingPath = form.landingPath || null

      const res = await fetch(`/api/v1/admin/tenants/${tenantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          plan: form.plan,
          maxUsers: form.maxUsers,
          maxContacts: form.maxContacts,
          branding: { primaryColor: form.primaryColor, logo: form.logo || undefined },
          features: form.features,
          addons: form.addons,
          settings: settingsPatch,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Update failed")
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err.message || "Network error")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!tenant) {
    return <div className="py-20 text-center text-muted-foreground">{t("tenants.notFound")}</div>
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/admin/tenants/${tenantId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              {t("back")}
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{t("tenants.edit")}</h1>
            <p className="text-muted-foreground text-sm">{tenant.name} &mdash; <span className="font-mono">{tenant.slug}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <Check className="w-4 h-4" /> {t("tenants.saved")}
            </span>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            {t("tenants.save")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — General info */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5">
            <h3 className="text-base font-semibold mb-4">{t("tenants.general")}</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("tenants.companyName")}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>{t("url")}</Label>
                <div className="flex items-center">
                  <span className="inline-flex items-center px-3 h-10 rounded-l-lg border border-r-0 border-zinc-200 dark:border-zinc-700/70 bg-muted/50 text-sm text-muted-foreground font-mono">https://</span>
                  <Input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                    className="rounded-none border-x-0 font-mono"
                  />
                  <span className="inline-flex items-center px-3 h-10 rounded-r-lg border border-l-0 border-zinc-200 dark:border-zinc-700/70 bg-muted/50 text-sm text-muted-foreground font-mono">.leaddrivecrm.org</span>
                </div>
                {form.slug !== tenant.slug && (
                  <p className="text-xs text-amber-600">{t("tenants.urlWarning")}</p>
                )}
              </div>
            </div>
          </Card>

          {/* Modules — shows every sidebar page grouped by section */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">{t("tenants.activeModules")}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t("tenants.modulesCount", { count: countEnabledModules(form.features), total: TOGGLEABLE_MODULES.length })}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setForm((f) => ({ ...f, features: enableAllModules(f.features) }))}
                >{t("tenants.selectAll")}</Button>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setForm((f) => ({ ...f, features: clearAllModules(f.features) }))}
                >{t("tenants.clearAll")}</Button>
              </div>
            </div>

            {/* Sections: hide the whole card when every toggleable module in
                 it is off. Every nav item carries a toggleable group id since
                 the narrow-union task (no always-on `core` id remains). Hidden
                 categories surface as compact chips below the list — clicking
                 re-enables everything in that group. */}
            {(() => {
              const annotated = SIDEBAR_SECTIONS.map((section) => {
                const ids = [...new Set(section.items.map((i) => i.moduleId))]
                const active = ids.filter((id) => form.features.includes(id)).length
                return { section, ids, active, total: ids.length }
              })
              const visible = annotated.filter(({ active, total }) => total === 0 || active > 0)
              const hidden = annotated.filter(({ active, total }) => total > 0 && active === 0)
              return (
                <>
            <div className="space-y-4">
              {visible.map(({ section, ids: sectionModuleIds, active: activeCount, total: totalToggleable }) => {
                const style = GROUP_STYLE[section.group] || GROUP_STYLE.Settings
                const GroupIcon = style.icon

                return (
                  <div key={section.group} className={`rounded-xl border ${style.border} ${style.bg} overflow-hidden`}>
                    {/* Group header */}
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <GroupIcon className={`w-4 h-4 ${style.color}`} />
                        <span className={`text-sm font-semibold ${style.color}`}>{tNav(`groups.${section.group}`)}</span>
                      </div>
                      {totalToggleable > 0 && (
                        <span className="text-xs text-muted-foreground">{activeCount}/{totalToggleable}</span>
                      )}
                    </div>
                    {/* Pages list */}
                    <div className="bg-white/80 px-3 py-2">
                      {/* Module toggles — one per unique moduleId */}
                      {sectionModuleIds.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {sectionModuleIds.map((modId) => {
                            const isActive = form.features.includes(modId)
                            const modDef = MODULE_REGISTRY[modId as ModuleId]
                            return (
                              <button
                                key={modId}
                                type="button"
                                disabled={modId === "crm" && form.features.includes("support")}
                                onClick={() => toggleFeature(modId)}
                                title={modId === "crm" && form.features.includes("support") ? "Support requires the shared companies and clients in Основная." : undefined}
                                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all ${
                                  isActive
                                    ? `${style.bg} ${style.border} border border-zinc-200 dark:border-zinc-700 shadow-sm font-medium`
                                    : "border border-zinc-200 hover:bg-muted/30 text-muted-foreground"
                                } ${modId === "crm" && form.features.includes("support") ? "cursor-not-allowed" : ""}`}
                              >
                                <div className={`w-7 h-[16px] rounded-full relative transition-colors flex-shrink-0 ${isActive ? "bg-primary" : "bg-zinc-200"}`}>
                                  <div className={`absolute top-[2px] w-[12px] h-[12px] rounded-full bg-white shadow transition-transform ${isActive ? "left-[13px]" : "left-[2px]"}`} />
                                </div>
                                {modDef?.name || modId}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {/* Pages affected */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                        {section.items.map((item) => {
                          const isEnabled = form.features.includes(item.moduleId)
                          return (
                            <div
                              key={item.href}
                              className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-xs transition-colors ${
                                isEnabled ? "text-foreground" : "text-muted-foreground/40 line-through"
                              }`}
                            >
                              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isEnabled ? "bg-green-400" : "bg-zinc-200"}`} />
                              {tNav(item.tKey)}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {hidden.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zinc-200" role="group" aria-label={t("tenants.hiddenCategories")}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">{t("tenants.hiddenCategories")}</span>
                  {hidden.map(({ section, ids }) => {
                    const style = GROUP_STYLE[section.group] || GROUP_STYLE.Settings
                    const GroupIcon = style.icon
                    const groupLabel = tNav(`groups.${section.group}`)
                    const label = t("tenants.enableAllInGroup", { group: groupLabel })
                    return (
                      <button
                        key={section.group}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, features: withRequiredModules([...f.features, ...ids]) }))}
                        className={`inline-flex items-center gap-1.5 rounded-full border border-dashed ${style.border} px-2.5 py-1 text-xs ${style.color} hover:bg-muted/40 transition-colors`}
                        aria-label={label}
                        title={label}
                      >
                        <GroupIcon className="w-3 h-3" aria-hidden="true" />
                        {groupLabel}
                        <span className="text-muted-foreground" aria-hidden="true">+</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
                </>
              )
            })()}
            {form.features.includes("loyalty") && (
              <p className="text-xs text-muted-foreground mt-4">
                {t("tenants.loyaltyModuleHint")}
              </p>
            )}
            {(!form.features.includes("crm") || !form.features.includes("sales") || !form.features.includes("settings")) && (
              <p className="text-xs text-amber-600 mt-4">⚠ Основная / Sales / Settings are core groups — tenant users lose those sections when disabled. Superadmin can always re-enable from this panel.</p>
            )}
          </Card>

          {/* Capabilities — sidebar areas gated by a tenant capability rather
              than a group module. They are deliberately absent from the module
              card above (a Workforce grant must not read as an MTM module
              toggle), which left HRM with no control anywhere at all: the whole
              group could not be turned on or off from this editor. Each switch
              writes the capability's own entitlement key, the same string the
              capability resolver reads. */}
          {CAPABILITY_SECTIONS.length > 0 && (
            <Card className="p-5">
              <div className="mb-5">
                <h3 className="text-base font-semibold">{t("tenants.capabilities")}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t("tenants.capabilitiesDesc")}
                </p>
              </div>

              <div className="space-y-4">
                {CAPABILITY_SECTIONS.map((section) => {
                  const capabilityIds = [...new Set(section.items.map((item) => item.capabilityId))]
                  return (
                    <div key={section.group} className="rounded-lg border p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {tNav(`groups.${section.group}`)}
                      </p>
                      <div className="mt-3 space-y-3">
                        {capabilityIds.map((capabilityId) => {
                          const enabled = isCapabilityEnabled(form.features, capabilityId)
                          const pages = section.items.filter((item) => item.capabilityId === capabilityId)
                          return (
                            <div
                              key={capabilityId}
                              data-tenant-capability={capabilityId}
                              className="flex items-start justify-between gap-4"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{capabilityId}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {pages.map((page) => tNav(page.tKey)).join(" · ")}
                                </p>
                              </div>
                              <Switch
                                checked={enabled}
                                aria-label={capabilityId}
                                onCheckedChange={(next) =>
                                  setForm((f) => ({
                                    ...f,
                                    features: next
                                      ? enableCapability(f.features, capabilityId)
                                      : disableCapability(f.features, capabilityId),
                                  }))
                                }
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* AI Automation — per-scenario shadow/live toggles */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-500" />
                  AI Automation
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Review → Autopilot per scenario. Shadow = AI drafts + waits for approve. Live = AI acts on its own.
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                {AI_AUTOMATION_FEATURES.filter(f => form.features.includes(f.shadowKey) || form.features.includes(f.liveKey)).length}
                {" / "}
                {AI_AUTOMATION_FEATURES.length}
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-zinc-200/60 dark:border-zinc-700/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-xs">Scenario</th>
                    <th className="text-center px-2 py-2 font-medium text-xs text-amber-700 w-24">Review</th>
                    <th className="text-center px-2 py-2 font-medium text-xs text-violet-700 w-24">Autopilot</th>
                  </tr>
                </thead>
                <tbody>
                  {AI_AUTOMATION_FEATURES.map((f) => {
                    const shadowActive = form.features.includes(f.shadowKey)
                    const liveActive = form.features.includes(f.liveKey)
                    const hasShadowMode = f.shadowKey !== f.liveKey // analytics features share key
                    return (
                      <tr key={f.scenario} className="border-t border-zinc-200/40 dark:border-zinc-700/40">
                        <td className="px-3 py-2">
                          <div className="font-medium">{f.label}</div>
                          <div className="text-[11px] text-muted-foreground">{f.note}</div>
                        </td>
                        <td className="text-center px-2 py-2">
                          {hasShadowMode ? (
                            <button
                              type="button"
                              onClick={() => toggleFeature(f.shadowKey)}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                                shadowActive
                                  ? "bg-amber-100 text-amber-800 border border-amber-300"
                                  : "bg-transparent text-muted-foreground border border-zinc-200 dark:border-zinc-700 hover:bg-muted"
                              }`}
                            >
                              {shadowActive ? "on" : "off"}
                            </button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="text-center px-2 py-2">
                          <button
                            type="button"
                            onClick={() => toggleFeature(f.liveKey)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                              liveActive
                                ? "bg-violet-100 text-violet-800 border border-violet-300"
                                : "bg-transparent text-muted-foreground border border-zinc-200 dark:border-zinc-700 hover:bg-muted"
                            }`}
                          >
                            {liveActive ? "on" : "off"}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Tip: always enable the Review toggle first, let the tenant see the shadow queue for a few days, then switch to Autopilot.
            </p>

            <div className="mt-5 pt-5 border-t border-zinc-200/60 dark:border-zinc-700/60 space-y-2">
              <h4 className="text-sm font-semibold">Extra features</h4>
              <p className="text-[11px] text-muted-foreground">
                Optional modules that aren&apos;t tied to a plan tier. Available on top of the main module list.
              </p>
              <div className="flex items-center justify-between py-2 px-3 rounded-md border border-zinc-200/40 dark:border-zinc-700/40 bg-muted/20">
                <div>
                  <div className="text-sm font-medium">Complaints Register</div>
                  <div className="text-[11px] text-muted-foreground">
                    Дополнительный раздел /complaints в группе Support (FMCG / consumer-goods use case).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleFeature("complaints_register")}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    form.features.includes("complaints_register")
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-transparent text-muted-foreground border border-zinc-200 dark:border-zinc-700 hover:bg-muted"
                  }`}
                >
                  {form.features.includes("complaints_register") ? "on" : "off"}
                </button>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-md border border-zinc-200/40 dark:border-zinc-700/40 bg-muted/20">
                <div>
                  <div className="text-sm font-medium">Social: Brand-protection only</div>
                  <div className="text-[11px] text-muted-foreground">
                    Соц-мониторинг только для наблюдения за внешними страницами (brand protection): скрывает подключение своих каналов, ответы и ИИ-агента; API отклоняет создание owned-источников.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleFeature("social_brand_protection_only")}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    form.features.includes("social_brand_protection_only")
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-transparent text-muted-foreground border border-zinc-200 dark:border-zinc-700 hover:bg-muted"
                  }`}
                >
                  {form.features.includes("social_brand_protection_only") ? "on" : "off"}
                </button>
              </div>
            </div>

            {/* Addons — separate from module toggles because addons unlock
                groups of modules (e.g. `finance` → invoices+budgeting+
                profitability) and are billed separately. The admin needs to
                see and edit them explicitly: until this section existed, an
                admin could turn off "Invoices" via module toggles but the
                page kept rendering because the `finance` addon still granted
                the module via hasModule's addon path. With this UI, admin can
                drop the addon and the modules go with it. */}
            <div className="mt-5 pt-5 border-t border-zinc-200/60 dark:border-zinc-700/60 space-y-2">
              <h4 className="text-sm font-semibold">Addons</h4>
              <p className="text-[11px] text-muted-foreground">
                Paid add-on packages. Each unlocks one or more modules above.
                The module toggles WIN: a module switched off above stays off
                even while its addon is on — the addon then only records what
                the customer pays for. Modules an addon grants are listed per
                row with their current state.
              </p>
              <div className="space-y-2">
                {(() => {
                  // Display metadata only — the actual list of addons is
                  // driven off `Object.keys(ADDON_MODULES)` so a future entry
                  // there auto-appears here. Billing-only addons (no module
                  // grants) live in BILLING_ONLY_ADDONS — they still need a
                  // toggle so admins can record what the customer paid for,
                  // but render with a "no module impact" note.
                  const ADDON_META: Record<string, { name: string; note: string }> = {
                    ai:       { name: "Da Vinci AI",       note: "AI assistant + scoring + suggestions." },
                    channels: { name: "Channels",          note: "Omni-channel inbox (FB, IG, Telegram, etc.)." },
                    finance:  { name: "Finance Suite",     note: "Invoices + Budgeting + Profitability." },
                    mtm:      { name: "Field Teams (MTM)", note: "Routes, visits, geofence — for field/merchandising teams." },
                    voip:     { name: "VoIP / Telephony",  note: "Billing tag for telephony tier. The voip module itself unlocks via Features list, not via this addon." },
                  }
                  const BILLING_ONLY_ADDONS = ["voip"] as const
                  // Union of module-granting addon ids and billing-only ids,
                  // dedup'd. Stable sort to keep UI deterministic.
                  const addonIds = Array.from(new Set([
                    ...Object.keys(ADDON_MODULES),
                    ...BILLING_ONLY_ADDONS,
                  ])).sort()
                  return addonIds.map((id) => {
                    const meta = ADDON_META[id] || { name: id, note: "" }
                    const isActive = form.addons.includes(id)
                    const grantedModules = ADDON_MODULES[id] || []
                    const isBillingOnly = grantedModules.length === 0
                    return (
                      <div key={id} className="flex items-center justify-between py-2 px-3 rounded-md border border-zinc-200/40 dark:border-zinc-700/40 bg-muted/20">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{meta.name}</div>
                          <div className="text-[11px] text-muted-foreground">{meta.note}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            <span className="opacity-60">Modules: </span>
                            {isBillingOnly ? (
                              <code className="px-1 py-px rounded bg-muted/60 opacity-70">(no module impact)</code>
                            ) : (
                              grantedModules.map((m, i) => {
                                // Тумблер модуля главнее аддона (hasModule шаг 2b):
                                // показываем, что реально получит тенант, чтобы
                                // «аддон включён, а модуля нет» не выглядело багом.
                                const moduleOn = form.features.includes(m)
                                return (
                                  <span key={m}>
                                    {i > 0 ? ", " : ""}
                                    <code className={`px-1 py-px rounded ${
                                      isActive && !moduleOn
                                        ? "bg-amber-100 text-amber-800"
                                        : "bg-muted/60"
                                    }`}>{m}</code>
                                    {isActive && !moduleOn && (
                                      <span className="text-amber-700"> — выключен тумблером выше</span>
                                    )}
                                  </span>
                                )
                              })
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleAddon(id)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ml-3 flex-shrink-0 ${
                            isActive
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : "bg-transparent text-muted-foreground border border-zinc-200 dark:border-zinc-700 hover:bg-muted"
                          }`}
                        >
                          {isActive ? "on" : "off"}
                        </button>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>

            <div className="mt-5 pt-5 border-t border-zinc-200/60 dark:border-zinc-700/60 grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>AI daily budget (USD)</Label>
                <Input
                  type="number" step="0.5" min="0"
                  value={form.aiDailyBudgetUsd}
                  placeholder="5.00"
                  onChange={(e) => setForm({ ...form, aiDailyBudgetUsd: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Cap on Claude/GPT spend per day for this tenant. Empty = system default ($5).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("tenants.landingPage")}</Label>
                <Select
                  value={form.landingPath}
                  onChange={(e) => setForm({ ...form, landingPath: e.target.value })}
                >
                  <option value="">{t("tenants.landingPageAuto")}</option>
                  {/* Только страницы включённых модулей: вести вход на
                      выключенный модуль бессмысленно — гейт лэйаута его закроет. */}
                  {SIDEBAR_SECTIONS.flatMap((section) =>
                    section.items
                      .filter((item) => form.features.includes(item.moduleId))
                      .map((item) => (
                        <option key={item.href} value={item.href}>
                          {tNav(`groups.${section.group}`)} · {tNav(item.tKey)}
                        </option>
                      )),
                  )}
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {t("tenants.landingPageHint")}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Default language for AI emails</Label>
                <Select
                  value={form.orgLanguage}
                  onChange={(e) => setForm({ ...form, orgLanguage: e.target.value })}
                >
                  <option value="">Auto (ru)</option>
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                  <option value="az">Azərbaycan</option>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Fallback language for renewal / meeting-recap / social-reply when the contact has no preferredLanguage.
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Right column — Plan & Branding */}
        <div className="space-y-6">
          <Card className="p-5">
            <h3 className="text-base font-semibold mb-4">{t("tenants.planAndLimits")}</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("plan")}</Label>
                <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("maxUsers")}</Label>
                <Input
                  type="number"
                  value={form.maxUsers}
                  onChange={(e) => setForm({ ...form, maxUsers: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">{t("tenants.maxUsersHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("maxContacts")}</Label>
                <Input
                  type="number"
                  value={form.maxContacts}
                  onChange={(e) => setForm({ ...form, maxContacts: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">{t("tenants.maxUsersHint")}</p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-base font-semibold mb-4">{t("tenants.branding")}</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("tenants.primaryColor")}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                    className="w-10 h-10 rounded border border-zinc-200 dark:border-zinc-700 cursor-pointer"
                  />
                  <Input
                    value={form.primaryColor}
                    onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("tenants.logo") || "Logo"}</Label>
                {(logoPreview || form.logo) ? (
                  <div className="relative w-fit">
                    <img
                      src={logoPreview || form.logo}
                      alt="Logo preview"
                      className="h-16 max-w-[200px] object-contain rounded border border-zinc-200/50 dark:border-zinc-700/50 bg-muted/30 p-1"
                    />
                    <button
                      type="button"
                      onClick={removeLogo}
                      className="absolute -top-2 -right-2 rounded-full bg-destructive text-destructive-foreground p-0.5 hover:bg-destructive/80"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    {logoUploading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      </div>
                    )}
                  </div>
                ) : (
                  <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700/70 px-4 py-3 hover:bg-muted/30 transition-colors">
                    <Upload className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">PNG, JPG, WebP — max 2MB</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-base font-semibold mb-3">{t("tenants.info")}</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("status")}</dt>
                <dd>
                  <Badge variant={tenant.isActive ? "default" : "destructive"}>
                    {tenant.isActive ? t("active") : t("inactive")}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("tenants.server")}</dt>
                <dd className="capitalize">{tenant.serverType}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("created")}</dt>
                <dd>{new Date(tenant.createdAt).toLocaleDateString()}</dd>
              </div>
              {tenant.provisionedAt && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("provisioned")}</dt>
                  <dd>{new Date(tenant.provisionedAt).toLocaleDateString()}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}
