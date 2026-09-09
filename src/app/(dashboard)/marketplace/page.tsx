"use client"

/**
 * P9 App Marketplace — dashboard catalog page.
 *
 * `/marketplace` lists public Apps from the catalog. Each tile shows
 * tenant install state and the manifest capabilities that will be
 * scheduled by the install plan.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  Activity,
  Brain,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  MapPin,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Package,
  Plus,
  Power,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HelpButton } from "@/components/help/help-button"
import { cn } from "@/lib/utils"

interface ManifestSettingSummary {
  key: string
  label: string
  type: "string" | "number" | "boolean" | "secret"
  required: boolean
  defaultValue?: string | number | boolean
}

interface ManifestWebhookSummary {
  credentialRef?: string
}

interface AppManifestSummary {
  capabilities?: {
    customFields?: unknown[]
    webhookSubscriptions?: ManifestWebhookSummary[]
    eventSubscriptions?: unknown[]
    settingsKeys?: ManifestSettingSummary[]
  }
  requirements?: {
    namedCredentialNames?: string[]
    modules?: unknown[]
  }
}

type CapabilityAction = "request_access" | "hide" | "show" | "disable" | "enable"

interface AppRow {
  id: string
  slug: string
  name: string
  version: string
  summary: string | null
  vendor: string
  category: string | null
  iconUrl: string | null
  docsUrl: string | null
  isFirstParty: boolean
  manifest: AppManifestSummary | null
  installation: {
    id: string
    installedVersion: string
    config: Record<string, unknown>
    status: "active" | "disabled"
    installedAt: string
  } | null
  capability: {
    id: string
    label: string
    kind: string
    billing: string
    status: "included" | "enabled" | "hidden" | "demo" | "requested" | "requires_plan" | "setup_required" | "disabled"
    reason: string
    actions: string[]
    enabled: boolean
    visibleInMenu: boolean
  } | null
}

type CredentialDraft = {
  id?: string
  exists: boolean
  baseUrl: string
  authType: "bearer" | "basic" | "api_key_header" | "none"
  authConfig?: Record<string, unknown>
  secret: string
}

const FILTER_ALL = "__all__"
const FILTER_INSTALLED = "__installed__"
const UNCATEGORIZED = "__uncategorized__"

const CATEGORY_ORDER = [
  "Sales",
  "Marketing",
  "Omni-channel",
  "Support",
  "Service",
  "Finance",
  "Contracts",
  "Analytics",
  "Data Quality",
  "Security",
  "Integrations",
  "Field Sales",
  "Operations",
]

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  Sales: "sales",
  Marketing: "marketing",
  "Omni-channel": "omnichannel",
  Support: "support",
  Service: "service",
  Finance: "finance",
  Contracts: "contracts",
  Analytics: "analytics",
  "Data Quality": "dataQuality",
  Security: "security",
  Integrations: "integrations",
  "Field Sales": "fieldSales",
  Operations: "operations",
}

const PRESENTATION_BY_SLUG: Record<string, { icon: LucideIcon; tone: string; accent: string }> = {
  "slack-deal-notifier": {
    icon: MessageSquare,
    tone: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300",
    accent: "bg-violet-500",
  },
  "stripe-webhook-bridge": {
    icon: CreditCard,
    tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",
    accent: "bg-sky-500",
  },
  "customer-health-score": {
    icon: Activity,
    tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
    accent: "bg-emerald-500",
  },
  "lead-scoring-rules": {
    icon: Brain,
    tone: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300",
    accent: "bg-orange-500",
  },
  "duplicate-lead-guard": {
    icon: Copy,
    tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
    accent: "bg-rose-500",
  },
  "sla-escalation-pack": {
    icon: Clock,
    tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
    accent: "bg-amber-500",
  },
  "whatsapp-conversation-sync": {
    icon: MessageCircle,
    tone: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300",
    accent: "bg-green-500",
  },
  "campaign-attribution-kit": {
    icon: Megaphone,
    tone: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/30 dark:text-fuchsia-300",
    accent: "bg-fuchsia-500",
  },
  "contract-renewal-alerts": {
    icon: FileText,
    tone: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300",
    accent: "bg-indigo-500",
  },
  "sales-forecast-snapshot": {
    icon: TrendingUp,
    tone: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
    accent: "bg-blue-500",
  },
  "web-to-lead-capture-kit": {
    icon: Globe,
    tone: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300",
    accent: "bg-cyan-500",
  },
  "audit-log-exporter": {
    icon: Shield,
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    accent: "bg-slate-500",
  },
  "field-visit-planner": {
    icon: MapPin,
    tone: "bg-lime-50 text-lime-700 dark:bg-lime-950/30 dark:text-lime-300",
    accent: "bg-lime-500",
  },
}

const FALLBACK_PRESENTATION = {
  icon: Package,
  tone: "bg-muted text-muted-foreground",
  accent: "bg-muted-foreground",
}

export default function MarketplacePage() {
  const t = useTranslations("marketplacePage")
  const [apps, setApps] = useState<AppRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState(FILTER_ALL)
  const [setupApp, setSetupApp] = useState<AppRow | null>(null)
  const [setupValues, setSetupValues] = useState<Record<string, string | number | boolean>>({})
  const [credentialValues, setCredentialValues] = useState<Record<string, CredentialDraft>>({})
  const [setupSaving, setSetupSaving] = useState(false)

  const categoryLabel = (category: string | null) => {
    if (!category) return t("category.uncategorized")
    const labelKey = CATEGORY_LABEL_KEYS[category]
    return labelKey ? t(`category.${labelKey}` as Parameters<typeof t>[0]) : category
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/v1/apps", { signal })
      const body: { apps?: AppRow[] } = await res.json()
      if (body.apps) setApps(body.apps)
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(t("toast.loadFailed"))
      }
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const install = async (app: AppRow) => {
    setBusyId(app.id)
    setError(null)
    try {
      const res = await fetch(`/api/v1/apps/${app.id}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: {} }),
      })
      const body: { error?: string; missing?: string[] } = await res.json()
      if (!res.ok) {
        setError(`${body.error || t("toast.installFailed")}${body.missing ? ` ${t("toast.missingConfig", { keys: body.missing.join(", ") })}` : ""}`)
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const toggleStatus = async (app: AppRow) => {
    if (!app.installation) return
    const next = app.installation.status === "active" ? "disabled" : "active"
    setBusyId(app.id)
    setError(null)
    try {
      const res = await fetch(`/api/v1/apps/${app.id}/install`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        setError(body.error || t("toast.toggleFailed", { status: res.status }))
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const updateCapability = async (app: AppRow, action: CapabilityAction) => {
    if (!app.capability) return
    setBusyId(app.id)
    setError(null)
    try {
      const res = await fetch("/api/v1/settings/capabilities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityId: app.capability.id, action }),
      })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        setError(body.error || t("toast.capabilityActionFailed", { status: res.status }))
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const openSetup = async (app: AppRow) => {
    const values: Record<string, string | number | boolean> = {}
    const currentConfig = app.installation?.config ?? {}
    for (const setting of app.manifest?.capabilities?.settingsKeys ?? []) {
      if (setting.type === "secret") {
        values[setting.key] = ""
        continue
      }
      const current = currentConfig[setting.key]
      values[setting.key] = typeof current === "string" || typeof current === "number" || typeof current === "boolean"
        ? current
        : setting.defaultValue ?? (setting.type === "boolean" ? false : "")
    }

    const credentialNames = credentialNamesForApp(app)
    let existingByName = new Map<string, {
      id: string
      name: string
      isActive: boolean
      baseUrl: string
      authType: CredentialDraft["authType"]
      authConfig?: Record<string, unknown>
    }>()
    try {
      const res = await fetch("/api/v1/named-credentials")
      const body: {
        credentials?: Array<{
          id: string
          name: string
          isActive: boolean
          baseUrl: string
          authType: string
          authConfig?: Record<string, unknown>
        }>
      } = await res.json()
      existingByName = new Map((body.credentials ?? [])
        .filter((credential) => credential.isActive)
        .map((credential) => [
          credential.name,
          {
            id: credential.id,
            name: credential.name,
            isActive: credential.isActive,
            baseUrl: credential.baseUrl,
            authType: credentialAuthType(credential.authType),
            authConfig: credential.authConfig,
          },
        ]))
    } catch {
      existingByName = new Map()
    }

    setSetupValues(values)
    setCredentialValues(Object.fromEntries(credentialNames.map((name) => {
      const defaults = defaultCredentialDraft(name)
      const existing = existingByName.get(name)
      return [name, existing
        ? {
            ...defaults,
            id: existing.id,
            exists: true,
            baseUrl: existing.baseUrl,
            authType: existing.authType,
            authConfig: existing.authConfig,
            secret: "",
          }
        : defaults]
    })))
    setSetupApp(app)
  }

  const saveSetup = async () => {
    if (!setupApp) return
    setSetupSaving(true)
    setBusyId(setupApp.id)
    setError(null)
    try {
      for (const [name, draft] of Object.entries(credentialValues)) {
        const baseUrl = draft.baseUrl.trim()
        const secret = draft.secret.trim()
        const hasSecret = draft.authType === "none" || secret.length > 0
        if (!baseUrl || (!draft.exists && !hasSecret)) {
          setError(t("toast.credentialIncomplete", { name }))
          return
        }

        const authConfig = draft.authType === "api_key_header"
          ? { headerName: "X-API-Key" }
          : {}
        const payload: Record<string, unknown> = {
          baseUrl,
          authType: draft.authType,
          authConfig,
        }
        if (draft.authType !== "none" && secret.length > 0) payload.secret = secret

        const res = await fetch(draft.exists && draft.id
          ? `/api/v1/named-credentials/${draft.id}`
          : "/api/v1/named-credentials", {
          method: draft.exists && draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft.exists && draft.id ? payload : { name, ...payload }),
        })
        if (!res.ok && res.status !== 409) {
          const body: { error?: string } = await res.json().catch(() => ({}))
          setError(body.error || t("toast.credentialFailed", { name, status: res.status }))
          return
        }
      }

      const config: Record<string, unknown> = {}
      for (const setting of setupApp.manifest?.capabilities?.settingsKeys ?? []) {
        const value = setupValues[setting.key]
        if (setting.type === "secret" && value === "") continue
        config[setting.key] = value
      }

      const res = await fetch(`/api/v1/apps/${setupApp.id}/install`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      })
      if (!res.ok) {
        const body: { error?: string; details?: string[] } = await res.json().catch(() => ({}))
        setError(`${body.error || t("toast.setupFailed", { status: res.status })}${body.details ? ` ${body.details.join(", ")}` : ""}`)
        return
      }
      setSetupApp(null)
      await load()
    } finally {
      setSetupSaving(false)
      setBusyId(null)
    }
  }

  const toggleLifecycle = async (app: AppRow) => {
    const action: CapabilityAction = app.installation?.status === "disabled" ? "enable" : "disable"
    if (app.capability?.actions.includes(action)) {
      await updateCapability(app, action)
      return
    }
    await toggleStatus(app)
  }

  const uninstall = async (app: AppRow) => {
    const copy = getLocalizedAppCopy(app, t)
    if (!confirm(t("confirm.uninstall", { name: copy.name }))) return
    setBusyId(app.id)
    setError(null)
    try {
      const res = await fetch(`/api/v1/apps/${app.id}/install`, { method: "DELETE" })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        setError(body.error || t("toast.uninstallFailed", { status: res.status }))
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const app of apps) {
      counts.set(app.category || UNCATEGORIZED, (counts.get(app.category || UNCATEGORIZED) ?? 0) + 1)
    }
    return counts
  }, [apps])

  const categories = useMemo(() => {
    const existing = new Set(apps.map(app => app.category || UNCATEGORIZED))
    const ordered = CATEGORY_ORDER.filter(category => existing.has(category))
    const extras = Array.from(existing)
      .filter(category => category !== UNCATEGORIZED && !CATEGORY_ORDER.includes(category))
      .sort((a, b) => a.localeCompare(b))
    if (existing.has(UNCATEGORIZED)) extras.push(UNCATEGORIZED)
    return [...ordered, ...extras]
  }, [apps])

  const visibleApps = useMemo(() => {
    const q = query.trim().toLowerCase()
    return apps.filter(app => {
      if (activeFilter === FILTER_INSTALLED && !app.installation) return false
      if (
        activeFilter !== FILTER_ALL &&
        activeFilter !== FILTER_INSTALLED &&
        (app.category || UNCATEGORIZED) !== activeFilter
      ) {
        return false
      }
      if (!q) return true
      const copy = getLocalizedAppCopy(app, t)
      return [
        copy.name,
        copy.summary,
        app.name,
        app.summary,
        app.vendor,
        app.category,
      ].some(value => value?.toLowerCase().includes(q))
    })
  }, [activeFilter, apps, query, t])

  const installedCount = apps.filter(app => app.installation).length
  const officialCount = apps.filter(app => app.isFirstParty).length
  const demoCount = apps.filter(app => app.capability?.status === "demo").length

  return (
    <div className="max-w-7xl space-y-5 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {t("header.title")}
            <HelpButton slug="marketplace" variant="label" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("header.subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:min-w-[420px]">
          <CatalogStat value={apps.length} label={t("stats.apps")} />
          <CatalogStat value={installedCount} label={t("stats.installed")} />
          <CatalogStat value={demoCount || officialCount} label={demoCount ? t("stats.demo") : t("stats.official")} />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative lg:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t("filters.searchPlaceholder")}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SlidersHorizontal className="h-4 w-4" />
            <span>{t("filters.label")}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <FilterChip
            active={activeFilter === FILTER_ALL}
            label={t("filters.all")}
            count={apps.length}
            onClick={() => setActiveFilter(FILTER_ALL)}
          />
          <FilterChip
            active={activeFilter === FILTER_INSTALLED}
            label={t("filters.installed")}
            count={installedCount}
            onClick={() => setActiveFilter(FILTER_INSTALLED)}
          />
          {categories.map(category => (
            <FilterChip
              key={category}
              active={activeFilter === category}
              label={category === UNCATEGORIZED ? t("category.uncategorized") : categoryLabel(category)}
              count={categoryCounts.get(category) ?? 0}
              onClick={() => setActiveFilter(category)}
            />
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="min-h-[248px] animate-pulse rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="h-11 w-11 rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
              </div>
              <div className="mt-6 space-y-2">
                <div className="h-3 rounded bg-muted" />
                <div className="h-3 w-5/6 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : apps.length === 0 ? (
        <EmptyState icon={Package} title={t("state.empty")} />
      ) : visibleApps.length === 0 ? (
        <EmptyState icon={Search} title={t("state.noResults")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleApps.map(app => (
            <AppTile
              key={app.id}
              app={app}
              busy={busyId === app.id}
              categoryLabel={categoryLabel(app.category)}
              onInstall={() => install(app)}
              onToggle={() => toggleLifecycle(app)}
              onUninstall={() => uninstall(app)}
              onConfigure={() => openSetup(app)}
              onCapabilityAction={(action) => updateCapability(app, action)}
            />
          ))}
        </div>
      )}
      <SetupDialog
        app={setupApp}
        values={setupValues}
        credentials={credentialValues}
        saving={setupSaving}
        onClose={() => setSetupApp(null)}
        onSave={saveSetup}
        onValueChange={(key, value) => setSetupValues(current => ({ ...current, [key]: value }))}
        onCredentialChange={(name, patch) => setCredentialValues(current => ({
          ...current,
          [name]: { ...current[name], ...patch },
        }))}
      />
    </div>
  )
}

function CatalogStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-zinc-200 bg-background text-foreground hover:border-primary/40 hover:bg-primary/5 dark:border-zinc-700"
      )}
    >
      <span className="max-w-[180px] truncate">{label}</span>
      <span className={cn(
        "rounded-full px-1.5 text-xs",
        active ? "bg-white/20 text-primary-foreground" : "bg-muted text-muted-foreground"
      )}>
        {count}
      </span>
    </button>
  )
}

function EmptyState({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <Icon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{title}</p>
    </div>
  )
}

function SetupDialog({
  app,
  values,
  credentials,
  saving,
  onClose,
  onSave,
  onValueChange,
  onCredentialChange,
}: {
  app: AppRow | null
  values: Record<string, string | number | boolean>
  credentials: Record<string, CredentialDraft>
  saving: boolean
  onClose: () => void
  onSave: () => void
  onValueChange: (key: string, value: string | number | boolean) => void
  onCredentialChange: (name: string, patch: Partial<CredentialDraft>) => void
}) {
  const t = useTranslations("marketplacePage")
  const settings = app?.manifest?.capabilities?.settingsKeys ?? []
  const credentialNames = app ? credentialNamesForApp(app) : []
  const appName = app ? getLocalizedAppCopy(app, t).name : ""

  return (
    <Dialog open={app !== null} onOpenChange={(open) => { if (!open) onClose() }} widthClassName="max-w-3xl">
      {app ? (
        <>
          <DialogHeader>
            <DialogTitle>{t("setup.title", { name: appName })}</DialogTitle>
            <DialogDescription>{t("setup.description")}</DialogDescription>
          </DialogHeader>
          <DialogContent className="space-y-5">
            {settings.length > 0 ? (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">{t("setup.settingsTitle")}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {settings.map((setting) => (
                    <label key={setting.key} className="space-y-1.5 text-sm">
                      <span className="flex items-center gap-1 font-medium">
                        {setting.label}
                        {setting.required ? <span className="text-red-500">*</span> : null}
                      </span>
                      {setting.type === "boolean" ? (
                        <button
                          type="button"
                          onClick={() => onValueChange(setting.key, values[setting.key] !== true)}
                          className={cn(
                            "flex h-10 w-full items-center justify-between rounded-md border px-3 text-left",
                            values[setting.key] === true ? "border-primary bg-primary/5" : "border-input bg-background",
                          )}
                        >
                          <span>{values[setting.key] === true ? t("setup.booleanOn") : t("setup.booleanOff")}</span>
                          <span className={cn("h-2.5 w-2.5 rounded-full", values[setting.key] === true ? "bg-primary" : "bg-muted-foreground")} />
                        </button>
                      ) : (
                        <Input
                          type={setting.type === "number" ? "number" : setting.type === "secret" ? "password" : "text"}
                          value={String(values[setting.key] ?? "")}
                          placeholder={setting.defaultValue !== undefined ? String(setting.defaultValue) : undefined}
                          onChange={(event) => {
                            const raw = event.target.value
                            onValueChange(setting.key, setting.type === "number" ? Number(raw) : raw)
                          }}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </section>
            ) : null}

            {credentialNames.length > 0 ? (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">{t("setup.credentialsTitle")}</h3>
                <div className="space-y-3">
                  {credentialNames.map((name) => {
                    const draft = credentials[name] ?? defaultCredentialDraft(name)
                    return (
                      <div key={name} className="rounded-lg border p-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{name}</div>
                            <div className="text-xs text-muted-foreground">
                              {draft.exists ? t("setup.credentialExists") : t("setup.credentialMissing")}
                            </div>
                          </div>
                          <Badge variant={draft.exists ? "success" : "warning"}>
                            {draft.exists ? t("setup.ready") : t("setup.required")}
                          </Badge>
                        </div>
                        <div className="grid gap-3 md:grid-cols-[1fr_150px]">
                          <label className="space-y-1.5 text-sm">
                            <span className="font-medium">{t("setup.baseUrl")}</span>
                            <Input
                              value={draft.baseUrl}
                              onChange={(event) => onCredentialChange(name, { baseUrl: event.target.value })}
                              placeholder="https://api.example.com"
                            />
                          </label>
                          <label className="space-y-1.5 text-sm">
                            <span className="font-medium">{t("setup.authType")}</span>
                            <select
                              value={draft.authType}
                              onChange={(event) => onCredentialChange(name, { authType: event.target.value as CredentialDraft["authType"] })}
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                              <option value="bearer">Bearer</option>
                              <option value="api_key_header">API key</option>
                              <option value="basic">Basic</option>
                              <option value="none">None</option>
                            </select>
                          </label>
                          {draft.authType !== "none" ? (
                            <label className="space-y-1.5 text-sm md:col-span-2">
                              <span className="font-medium">{t("setup.secret")}</span>
                              <Input
                                type="password"
                                value={draft.secret}
                                onChange={(event) => onCredentialChange(name, { secret: event.target.value })}
                                placeholder={draft.exists ? t("setup.secretExistingPlaceholder") : t("setup.secretPlaceholder")}
                              />
                            </label>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}
          </DialogContent>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {t("setup.cancel")}
            </Button>
            <Button onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {t("setup.save")}
            </Button>
          </DialogFooter>
        </>
      ) : null}
    </Dialog>
  )
}

function AppTile({
  app,
  busy,
  categoryLabel,
  onInstall,
  onToggle,
  onUninstall,
  onConfigure,
  onCapabilityAction,
}: {
  app: AppRow
  busy: boolean
  categoryLabel: string
  onInstall: () => void
  onToggle: () => void
  onUninstall: () => void
  onConfigure: () => void
  onCapabilityAction: (action: CapabilityAction) => void
}) {
  const t = useTranslations("marketplacePage")
  const installed = app.installation !== null
  const disabled = app.installation?.status === "disabled"
  const copy = getLocalizedAppCopy(app, t)
  const presentation = PRESENTATION_BY_SLUG[app.slug] ?? FALLBACK_PRESENTATION
  const Icon = presentation.icon
  const capabilities = getCapabilityLabels(app, t)
  const requiresSetup = appRequiresSetup(app)
  const capability = app.capability
  const capabilityManaged = capability !== null
  const canInstallDirectly = !capabilityManaged
  const canViewDemo = capability?.actions.includes("view_demo") === true
  const canRequestAccess = capability?.actions.includes("request_access") === true
  const canConfigure = installed && (requiresSetup || capability?.actions.includes("configure") === true)
  const menuVisibilityAction = capability?.actions.includes("show")
    ? "show"
    : capability?.actions.includes("hide")
      ? "hide"
      : null

  return (
    <div className="group relative flex min-h-[248px] flex-col rounded-lg border bg-card p-4 transition-colors hover:border-primary/30">
      <div className={cn("absolute inset-x-0 top-0 h-1 rounded-t-lg", presentation.accent)} />

      <div className="flex items-start gap-3">
        {app.iconUrl ? (
          // Custom icon URLs are vendor-controlled catalog rows curated by us.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.iconUrl} alt="" className="h-11 w-11 rounded-lg object-cover" />
        ) : (
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", presentation.tone)}>
            <Icon className="h-5 w-5" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate font-semibold leading-6">{copy.name}</h3>
                {installed ? (
                  <Badge variant={disabled ? "warning" : "success"} className="shrink-0">
                    {disabled ? t("status.disabled") : t("status.installed")}
                  </Badge>
                ) : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {app.vendor} · v{app.installation?.installedVersion ?? app.version}
              </p>
            </div>
            {installed ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline">{categoryLabel}</Badge>
        {app.isFirstParty ? <Badge variant="brand">{t("badge.firstParty")}</Badge> : null}
        {capability ? (
          <Badge variant={capabilityBadgeVariant(capability.status)} title={capability.reason}>
            {t(`capabilityStatus.${capability.status}` as Parameters<typeof t>[0])}
          </Badge>
        ) : null}
        {requiresSetup ? <Badge variant="warning">{t("badge.requiresSetup")}</Badge> : null}
      </div>

      {copy.summary ? (
        <p className="mt-3 line-clamp-3 min-h-[60px] text-sm leading-5 text-muted-foreground">
          {copy.summary}
        </p>
      ) : (
        <div className="mt-3 min-h-[60px]" />
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {capabilities.map(capability => (
          <span key={capability} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            {capability}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        {installed ? (
          <>
            {app.installation && app.installation.installedVersion !== app.version ? (
              <Badge variant="warning">{t("badge.catalogVersion", { version: app.version })}</Badge>
            ) : null}
            {canConfigure ? (
              <Button size="sm" variant="ghost" onClick={onConfigure} disabled={busy} title={t("actions.configure")}>
                <Settings2 className="h-4 w-4" />
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onToggle} disabled={busy} title={disabled ? t("actions.enable") : t("actions.disable")}>
              <Power className="h-4 w-4" />
            </Button>
            {menuVisibilityAction ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onCapabilityAction(menuVisibilityAction)}
                disabled={busy}
                title={menuVisibilityAction === "show" ? t("actions.show") : t("actions.hide")}
              >
                {menuVisibilityAction === "show" ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onUninstall} disabled={busy} title={t("actions.uninstall")}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </>
        ) : (
          canInstallDirectly ? (
            <Button size="sm" onClick={onInstall} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              {busy ? t("actions.installing") : t("actions.install")}
            </Button>
          ) : (
            <>
              {canViewDemo ? (
                <Button size="sm" variant="outline" asChild title={capability?.reason}>
                  <Link href={`/marketplace/demo/${capability.id}`}>
                    {t("actions.viewDemo")}
                  </Link>
                </Button>
              ) : null}
              {canRequestAccess ? (
                <Button
                  size="sm"
                  variant={canViewDemo ? "secondary" : "outline"}
                  disabled={busy}
                  title={capability?.reason}
                  onClick={() => onCapabilityAction("request_access")}
                >
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  {t("actions.requestAccess")}
                </Button>
              ) : null}
              {!canViewDemo && !canRequestAccess ? (
                <Button size="sm" variant="outline" disabled title={capability?.reason}>
                  {t(`capabilityStatus.${capability?.status ?? "disabled"}` as Parameters<typeof t>[0])}
                </Button>
              ) : null}
            </>
          )
        )}
        <div className="flex-1" />
        {app.docsUrl ? (
          <a
            href={app.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("actions.docs")}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

function capabilityBadgeVariant(status: NonNullable<AppRow["capability"]>["status"]) {
  switch (status) {
    case "included":
    case "enabled":
      return "success"
    case "hidden":
    case "setup_required":
      return "warning"
    case "demo":
      return "info"
    case "requested":
      return "brand"
    case "requires_plan":
    case "disabled":
      return "outline"
  }
}

function getLocalizedAppCopy(app: AppRow, t: ReturnType<typeof useTranslations>) {
  const nameKey = `apps.${app.slug}.name` as Parameters<typeof t>[0]
  const summaryKey = `apps.${app.slug}.summary` as Parameters<typeof t>[0]
  return {
    name: t.has(nameKey) ? t(nameKey) : app.name,
    summary: t.has(summaryKey) ? t(summaryKey) : app.summary,
  }
}

function getCapabilityLabels(app: AppRow, t: ReturnType<typeof useTranslations>) {
  const capabilities = app.manifest?.capabilities
  const labels: string[] = []
  if (arrayLength(capabilities?.customFields) > 0) labels.push(t("capability.fields"))
  if (arrayLength(capabilities?.eventSubscriptions) > 0) labels.push(t("capability.automation"))
  if (arrayLength(capabilities?.webhookSubscriptions) > 0) labels.push(t("capability.webhook"))
  if (arrayLength(capabilities?.settingsKeys) > 0) labels.push(t("capability.settings"))
  return labels.length > 0 ? labels : [t("capability.catalog")]
}

function appRequiresSetup(app: AppRow) {
  const settings = app.manifest?.capabilities?.settingsKeys
  const requiresSettings = Array.isArray(settings) && settings.some(setting => {
    return Boolean(setting && typeof setting === "object" && "required" in setting && setting.required)
  })
  return (
    requiresSettings ||
    arrayLength(app.manifest?.requirements?.namedCredentialNames) > 0 ||
    arrayLength(app.manifest?.requirements?.modules) > 0
  )
}

function credentialNamesForApp(app: AppRow): string[] {
  const names = new Set<string>()
  for (const name of app.manifest?.requirements?.namedCredentialNames ?? []) {
    if (typeof name === "string" && name.length > 0) names.add(name)
  }
  for (const webhook of app.manifest?.capabilities?.webhookSubscriptions ?? []) {
    if (typeof webhook?.credentialRef === "string" && webhook.credentialRef.length > 0) {
      names.add(webhook.credentialRef)
    }
  }
  return [...names].sort()
}

function defaultCredentialDraft(name: string): CredentialDraft {
  if (name === "slack_bot") {
    return {
      exists: false,
      baseUrl: "https://slack.com/api",
      authType: "bearer",
      secret: "",
    }
  }
  if (name === "erp_api") {
    return {
      exists: false,
      baseUrl: "",
      authType: "bearer",
      secret: "",
    }
  }
  return {
    exists: false,
    baseUrl: "",
    authType: "bearer",
    secret: "",
  }
}

function credentialAuthType(value: string): CredentialDraft["authType"] {
  return value === "basic" || value === "api_key_header" || value === "none"
    ? value
    : "bearer"
}

function arrayLength(value: unknown[] | undefined) {
  return Array.isArray(value) ? value.length : 0
}
