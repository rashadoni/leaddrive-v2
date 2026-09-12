"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Bot,
  CirclePause,
  Clock3,
  FileWarning,
  History,
  Loader2,
  MessageCircleMore,
  RefreshCw,
  ShieldCheck,
  TicketCheck,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"
import { updateOrganizationFeature } from "@/lib/client/organization-features"

type LatestChange = {
  id: string
  actor: string | null
  previousEnabled: boolean | null
  newEnabled: boolean | null
  changedAt: string
}

type SettingsState = {
  enabled: boolean
  organization: { id: string; name: string }
  latestChange: LatestChange | null
}

type SaveNotice = { kind: "success" | "error"; text: string; retryEnabled: boolean | null }

const CONSEQUENCES = [
  { key: "tickets", icon: TicketCheck, timing: "immediate" },
  { key: "complaints", icon: FileWarning, timing: "immediate" },
  { key: "portalChat", icon: MessageCircleMore, timing: "immediate" },
  { key: "whatsapp", icon: MessageCircleMore, timing: "immediate" },
  { key: "background", icon: Clock3, timing: "nextJob" },
] as const

function parseSettings(body: unknown): SettingsState {
  const value = body as { data?: SettingsState }
  if (!value?.data || typeof value.data.enabled !== "boolean") {
    throw new Error("support_ai_settings_invalid_response")
  }
  return value.data
}

export function SupportAiSettingsClient() {
  const t = useTranslations("supportAiSettings")
  const locale = useLocale()
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadRetryable, setLoadRetryable] = useState(true)
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const requestRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setLoadError(false)
    setLoadRetryable(true)

    try {
      const response = await fetch("/api/v1/support/ai-settings", {
        cache: "no-store",
        signal: controller.signal,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const requestError = new Error("support_ai_settings_load_failed") as Error & { status?: number }
        requestError.status = response.status
        throw requestError
      }
      setSettings(parseSettings(body))
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") {
        setLoadError(true)
        setLoadRetryable((error as { status?: number }).status !== 403)
      }
    } finally {
      if (requestRef.current === controller) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => requestRef.current?.abort()
  }, [load])

  const save = async (nextEnabled: boolean) => {
    if (saving || !settings) return
    const previous = settings
    setSaving(true)
    setNotice(null)
    setSettings({ ...previous, enabled: nextEnabled })

    try {
      const features = await updateOrganizationFeature(
        SUPPORT_AI_DISABLED_FEATURE,
        !nextEnabled,
      )
      const serverEnabled = !features.includes(SUPPORT_AI_DISABLED_FEATURE)
      setSettings((current) => current ? { ...current, enabled: serverEnabled } : current)

      try {
        const response = await fetch("/api/v1/support/ai-settings", { cache: "no-store" })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error("support_ai_settings_verify_failed")
        const verified = parseSettings(body)
        setSettings(verified)
        setNotice({ kind: "success", text: verified.enabled ? t("enabledToast") : t("disabledToast"), retryEnabled: null })
        toast.success(verified.enabled ? t("enabledToast") : t("disabledToast"))
      } catch {
        // The mutation already returned authoritative feature state. Keep it;
        // only the secondary audit projection failed to refresh.
        const text = serverEnabled ? t("enabledToast") : t("disabledToast")
        setNotice({ kind: "success", text, retryEnabled: null })
        toast.success(text)
      }
    } catch {
      setSettings(previous)
      setNotice({ kind: "error", text: t("saveError"), retryEnabled: nextEnabled })
      toast.error(t("saveError"), {
        action: { label: t("retry"), onClick: () => void save(nextEnabled) },
      })
    } finally {
      setSaving(false)
    }
  }

  const requestToggle = (nextEnabled: boolean) => {
    if (saving || !settings) return
    if (!nextEnabled) setConfirmDisable(true)
    else void save(true)
  }

  const confirmAndDisable = () => {
    setConfirmDisable(false)
    void save(false)
  }

  const retrySave = () => {
    const retryEnabled = notice?.retryEnabled
    if (typeof retryEnabled === "boolean") void save(retryEnabled)
  }

  const formatDate = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
  }

  if (loading && !settings) {
    return (
      <div className="mx-auto max-w-4xl space-y-4" aria-busy="true" aria-label={t("loadingLabel")} data-testid="support-ai-settings-loading">
        <div className="h-12 max-w-xl animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-28 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      </div>
    )
  }

  if (loadError && !settings) {
    return (
      <section className="mx-auto max-w-2xl rounded-lg border p-5 text-center" role="alert" data-testid="support-ai-settings-error" data-retryable={loadRetryable ? "true" : "false"}>
        <CirclePause className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{t("loadErrorTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("loadError")}</p>
        {loadRetryable && <Button className="mt-4 min-h-11" variant="outline" onClick={() => void load()} data-testid="support-ai-settings-retry">
          <RefreshCw aria-hidden="true" />
          {t("retry")}
        </Button>}
      </section>
    )
  }

  if (!settings) return null

  const { enabled, organization, latestChange } = settings

  return (
    <SupportPageShell
      data-testid="support-ai-settings-workspace"
      data-state={saving ? "saving" : "ready"}
      data-enabled={enabled ? "true" : "false"}
      width="narrow"
      title={t("title")}
      description={t("description")}
      leading={<Bot className="h-5 w-5" aria-hidden="true" />}
    >

      {notice && (
        <div role="status" aria-live="polite" className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${notice.kind === "error" ? "border-destructive/40 text-destructive" : ""}`} data-testid="support-ai-settings-notice" data-kind={notice.kind}>
          <span className="flex-1">{notice.text}</span>
          {notice.retryEnabled !== null && <Button type="button" variant="outline" className="min-h-10" onClick={retrySave} disabled={saving} data-testid="support-ai-settings-save-retry"><RefreshCw aria-hidden="true" />{t("retry")}</Button>}
        </div>
      )}

      <section className="rounded-lg border bg-background" aria-labelledby="support-ai-master-title">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="support-ai-master-title" className="text-sm font-semibold">{t("masterTitle")}</h2>
              <Badge data-testid="support-ai-master-status" variant="outline" className="bg-muted/40">
                {enabled ? t("statusOn") : t("statusOff")}
              </Badge>
            </div>
            <p id="support-ai-master-hint" className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground sm:text-sm">
              {enabled ? t("masterHintOn") : t("masterHintOff")}
            </p>
          </div>
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-lg border px-3 sm:justify-start">
            <span className="text-sm font-medium">{saving ? t("saving") : enabled ? t("switchOn") : t("switchOff")}</span>
            {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
            <Switch
              data-testid="support-ai-master-switch"
              className="relative before:absolute before:-inset-x-1.5 before:-inset-y-3 before:content-[''] motion-reduce:transition-none [&>span]:motion-reduce:transition-none"
              checked={enabled}
              onCheckedChange={requestToggle}
              disabled={saving}
              aria-label={t("switchLabel")}
              aria-describedby="support-ai-master-hint"
            />
          </div>
        </div>
        <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("manualTitle")}</span>{" "}{t("manualDescription")}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-background" aria-labelledby="support-ai-consequence-title">
        <div className="border-b px-4 py-3">
          <h2 id="support-ai-consequence-title" className="text-sm font-semibold">{t("coverageTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("coverageDescription")}</p>
        </div>
        <div className="divide-y">
          {CONSEQUENCES.map(({ key, icon: Icon, timing }) => (
            <div key={key} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1.3fr)_auto] sm:items-center" data-testid="support-ai-consequence" data-consequence={key}>
              <div className="flex items-center gap-2.5">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-medium">{t(`${key}Title`)}</h3>
              </div>
              <p className="text-xs leading-5 text-muted-foreground sm:text-sm">{t(`${key}Description`)}</p>
              <span className="w-fit rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {t(`${timing}Label`)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-background p-4" aria-labelledby="support-ai-unaffected-title" data-testid="support-ai-unaffected">
          <div className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 id="support-ai-unaffected-title" className="text-sm font-semibold">{t("unaffectedTitle")}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("unaffectedDescription")}</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border bg-background p-4" aria-labelledby="support-ai-audit-title" data-testid="support-ai-audit" data-state={latestChange ? "recorded" : "empty"}>
          <div className="flex gap-2.5">
            <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="support-ai-audit-title" className="text-sm font-semibold">{t("auditTitle")}</h2>
              {latestChange ? (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t("auditChange")}</dt>
                  <dd>{latestChange.previousEnabled === null || latestChange.newEnabled === null
                    ? t("auditChanged")
                    : `${latestChange.previousEnabled ? t("statusOn") : t("statusOff")} → ${latestChange.newEnabled ? t("statusOn") : t("statusOff")}`}</dd>
                  <dt className="text-muted-foreground">{t("auditActor")}</dt>
                  <dd className="truncate">{latestChange.actor || t("auditUnknownActor")}</dd>
                  <dt className="text-muted-foreground">{t("auditOrganization")}</dt>
                  <dd className="truncate">{organization.name}</dd>
                  <dt className="text-muted-foreground">{t("auditTime")}</dt>
                  <dd><time dateTime={latestChange.changedAt}>{formatDate(latestChange.changedAt)}</time></dd>
                </dl>
              ) : (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("auditEmpty")}</p>
              )}
            </div>
          </div>
        </section>
      </div>

      <p className="sr-only" aria-live="polite">
        {saving ? t("saving") : enabled ? t("enabledLive") : t("disabledLive")}
      </p>

      <Dialog open={confirmDisable} onOpenChange={(open) => !saving && setConfirmDisable(open)} widthClassName="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("confirmTitle")}</DialogTitle>
          <DialogDescription>{t("confirmDescription")}</DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-3 py-3" data-testid="support-ai-disable-dialog">
          <div className="rounded-lg border p-3 text-sm">
            <p><span className="font-medium">{t("immediateLabel")}:</span> {t("confirmImmediate")}</p>
            <p className="mt-2"><span className="font-medium">{t("nextJobLabel")}:</span> {t("confirmNextJob")}</p>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{t("confirmUnaffected")}</p>
        </DialogContent>
        <DialogFooter className="flex-col-reverse sm:flex-row">
          <Button className="min-h-11 w-full sm:w-auto" variant="outline" onClick={() => setConfirmDisable(false)} data-dialog-initial-focus>
            {t("cancel")}
          </Button>
          <Button data-testid="support-ai-confirm-disable" className="min-h-11 w-full sm:w-auto" variant="destructive" onClick={confirmAndDisable}>
            {t("confirmAction")}
          </Button>
        </DialogFooter>
      </Dialog>
    </SupportPageShell>
  )
}
