"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  UserPlus, Users, Trophy, Ticket, AlertTriangle, Clock,
  ArrowLeft, Sparkles, ChevronRight, PhoneMissed, Check, AlertCircle, Globe,
  type LucideIcon,
} from "lucide-react"

interface TemplateAction {
  actionType: string
  actionConfig: Record<string, unknown>
  actionOrder: number
}
interface Template {
  id: string
  nameKey: string
  descriptionKey: string
  category: string
  icon: string
  entityType: string
  triggerEvent: string
  actions: TemplateAction[]
  appliedCount: number
  isApplied: boolean
  requiresSms: boolean
  canRun: boolean
}

interface CustomField {
  subject?: string
  body?: string
  message?: string
  title?: string
  delayMinutes?: number
}

const ICONS: Record<string, LucideIcon> = {
  UserPlus,
  Users,
  Trophy,
  Ticket,
  AlertTriangle,
  Clock,
  PhoneMissed,
  Globe,
}

const CATEGORY_STYLES: Record<string, string> = {
  sales:
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800",
  support:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800",
  marketing:
    "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800",
  operations:
    "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800",
}

export default function WorkflowTemplatesPage() {
  const router = useRouter()
  const t = useTranslations("workflowTemplates")
  useAutoTour("workflowTemplatesSettings")
  const [templates, setTemplates] = useState<Template[]>([])
  const [applying, setApplying] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [smsConfigured, setSmsConfigured] = useState(true)
  const [previewTpl, setPreviewTpl] = useState<Template | null>(null)
  const [customizations, setCustomizations] = useState<Record<string, CustomField>>({})
  const [forceApply, setForceApply] = useState(false)

  const load = () => {
    setLoading(true)
    fetch("/api/v1/workflows/templates")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setTemplates(data.data)
          setSmsConfigured(data.meta?.smsProviderConfigured ?? true)
        }
      })
      .catch(() => toast.error(t("applyFailed")))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openPreview = (tpl: Template) => {
    setPreviewTpl(tpl)
    setCustomizations({})
    setForceApply(tpl.isApplied) // pre-check "re-apply" if already applied
  }

  const applyTemplate = async () => {
    if (!previewTpl) return
    setApplying(previewTpl.id)
    try {
      const res = await fetch("/api/v1/workflows/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: previewTpl.id,
          customizations,
          force: forceApply,
        }),
      })
      const data = await res.json()
      if (res.status === 409 && data.code === "already_applied") {
        toast.error(t("alreadyApplied"))
        setForceApply(true)
        return
      }
      if (res.status === 422 && data.code === "sms_not_configured") {
        toast.error(t("smsRequired"))
        return
      }
      if (data.success) {
        toast.success(t("appliedSuccess"))
        setPreviewTpl(null)
        router.push("/settings/workflows")
      } else {
        toast.error(data.error || t("applyFailed"))
      }
    } catch {
      toast.error(t("applyFailed"))
    } finally {
      setApplying(null)
    }
  }

  const grouped = templates.reduce<Record<string, Template[]>>((acc, tpl) => {
    if (!acc[tpl.category]) acc[tpl.category] = []
    acc[tpl.category].push(tpl)
    return acc
  }, {})

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6" data-tour-id="workflow-templates-header">
        <Link
          href="/settings/workflows"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToWorkflows")}
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 p-2.5 text-white shadow-sm">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              {t("title")}
              <HelpButton slug="workflow-templates" variant="label" />
              <TourReplayButton tourId="workflowTemplatesSettings" />
            </h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
      </div>

      {!smsConfigured && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">{t("smsBannerTitle")}</p>
            <p className="text-amber-800 dark:text-amber-300/80 mt-0.5">
              {t("smsBannerBody")}{" "}
              <Link href="/settings/voip" className="underline font-medium">
                {t("smsBannerAction")}
              </Link>
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-tour-id="workflow-templates-list">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 rounded-lg bg-muted/30 animate-pulse" aria-hidden="true" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-card px-6 py-14 text-center text-muted-foreground dark:border-zinc-700" data-tour-id="workflow-templates-list">
          <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="font-medium text-foreground">{t("empty")}</p>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6">{t("emptyHint")}</p>
          <Button asChild variant="outline" className="mt-5">
            <Link href="/settings/workflows">{t("emptyAction")}</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-8" data-tour-id="workflow-templates-list">
          {Object.entries(grouped).map(([category, items]) => (
            <section key={category}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                {t(`categories.${category}`)}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((tpl) => {
                  const Icon = ICONS[tpl.icon] || Sparkles
                  return (
                    <div
                      key={tpl.id}
                      data-tour-id="workflow-templates-card"
                      className="group relative rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 hover:border-primary/50 hover:shadow-sm transition-all flex flex-col"
                    >
                      {tpl.isApplied && (
                        <div className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 rounded-full px-2 py-0.5">
                          <Check className="h-3 w-3" />
                          {t("alreadyAppliedBadge", { count: tpl.appliedCount })}
                        </div>
                      )}
                      <div className="flex items-start gap-3 mb-3">
                        <div className="rounded-md bg-primary/10 p-2 text-primary shrink-0">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0 pr-16">
                          <h3 className="font-medium text-sm leading-tight">{t(tpl.nameKey)}</h3>
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            <Badge
                              variant="outline"
                              className={`text-[10px] capitalize ${CATEGORY_STYLES[category] || ""}`}
                            >
                              {t(`categories.${category}`)}
                            </Badge>
                            {tpl.requiresSms && !tpl.canRun && (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800"
                                title={t("requiresSms")}
                              >
                                <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                                {t("smsNeeded")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed flex-1 mb-4">
                        {t(tpl.descriptionKey)}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-4">
                        <span className="font-mono bg-muted/50 rounded px-1.5 py-0.5">
                          {tpl.entityType}.{tpl.triggerEvent}
                        </span>
                        <ChevronRight className="h-3 w-3" />
                        <span>
                          {tpl.actions.length} {t("actionsCount")}
                        </span>
                      </div>
                      <Button size="sm" className="w-full" onClick={() => openPreview(tpl)}>
                        {tpl.isApplied ? t("reviewAgain") : t("preview")}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Preview + customize modal */}
      <Dialog open={!!previewTpl} onOpenChange={(open) => !open && setPreviewTpl(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {previewTpl && (
            <>
              <DialogHeader>
                <DialogTitle>{t(previewTpl.nameKey)}</DialogTitle>
                <DialogDescription>{t(previewTpl.descriptionKey)}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-muted-foreground">{t("previewTrigger")}:</span>
                    <code className="font-mono bg-background rounded px-1.5 py-0.5">
                      {previewTpl.entityType}.{previewTpl.triggerEvent}
                    </code>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground">{t("previewActions")}:</div>
                  {previewTpl.actions.map((action, idx) => {
                    const cfg = action.actionConfig as Record<string, string | undefined>
                    const custom = customizations[String(idx)] || {}
                    const setCustom = (patch: CustomField) =>
                      setCustomizations({ ...customizations, [String(idx)]: { ...custom, ...patch } })
                    return (
                      <div key={idx} className="rounded-md border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {action.actionType}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">#{idx + 1}</span>
                        </div>
                        {cfg.subject !== undefined && (
                          <div className="space-y-1">
                            <Label className="text-[11px]">{t("fieldSubject")}</Label>
                            <Input
                              defaultValue={cfg.subject}
                              onChange={(e) => setCustom({ subject: e.target.value })}
                              className="text-xs h-8"
                            />
                          </div>
                        )}
                        {cfg.body !== undefined && (
                          <div className="space-y-1">
                            <Label className="text-[11px]">{t("fieldBody")}</Label>
                            <Textarea
                              defaultValue={cfg.body}
                              onChange={(e) => setCustom({ body: e.target.value })}
                              className="text-xs min-h-[60px]"
                              rows={3}
                            />
                          </div>
                        )}
                        {cfg.message !== undefined && (
                          <div className="space-y-1">
                            <Label className="text-[11px]">{t("fieldMessage")}</Label>
                            <Textarea
                              defaultValue={cfg.message}
                              onChange={(e) => setCustom({ message: e.target.value })}
                              className="text-xs min-h-[60px]"
                              rows={2}
                            />
                          </div>
                        )}
                        {cfg.title !== undefined && !cfg.subject && !cfg.message && (
                          <div className="space-y-1">
                            <Label className="text-[11px]">{t("fieldTitle")}</Label>
                            <Input
                              defaultValue={cfg.title}
                              onChange={(e) => setCustom({ title: e.target.value })}
                              className="text-xs h-8"
                            />
                          </div>
                        )}
                        {(cfg.delayMinutes !== undefined || action.actionType === "send_sms") && (
                          <div className="space-y-1">
                            <Label className="text-[11px]">{t("fieldDelayMinutes")}</Label>
                            <Input
                              type="number"
                              min={0}
                              max={1440}
                              defaultValue={(cfg.delayMinutes as unknown as number) ?? 0}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10)
                                setCustom({ delayMinutes: Number.isFinite(v) && v >= 0 ? v : 0 })
                              }}
                              className="text-xs h-8"
                            />
                            <p className="text-[10px] text-muted-foreground">
                              {t("fieldDelayHint")}
                            </p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {previewTpl.isApplied && (
                  <label className="flex items-start gap-2 text-xs cursor-pointer rounded-md bg-amber-50 dark:bg-amber-950/30 p-2.5 border border-amber-200 dark:border-amber-900">
                    <input
                      type="checkbox"
                      checked={forceApply}
                      onChange={(e) => setForceApply(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-amber-900 dark:text-amber-200">
                      {t("forceApplyLabel")} ({previewTpl.appliedCount}×)
                    </span>
                  </label>
                )}

                {previewTpl.requiresSms && !previewTpl.canRun && (
                  <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-2.5 border border-amber-200 dark:border-amber-900 text-xs">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                    <span className="text-amber-900 dark:text-amber-200">{t("smsRequired")}</span>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setPreviewTpl(null)}>
                  {t("cancel")}
                </Button>
                <Button
                  onClick={applyTemplate}
                  disabled={
                    applying === previewTpl.id ||
                    (previewTpl.requiresSms && !previewTpl.canRun) ||
                    (previewTpl.isApplied && !forceApply)
                  }
                >
                  {applying === previewTpl.id ? t("applying") : t("useTemplate")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
