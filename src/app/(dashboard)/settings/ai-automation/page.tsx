"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MotionPage } from "@/components/ui/motion"
import {
  Bot, Sparkles, Shield, Eye, CheckCircle2, XCircle,
  Clock, Loader2, RefreshCw, ToggleLeft, ToggleRight,
  Mail, Send, MessageSquare, ChevronDown, HelpCircle, Flame, Tags, TrendingUp,
  AlertTriangle, BookOpen, GitMerge, CreditCard, Video, Megaphone, MessagesSquare,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DigestSubscriptionsPanel } from "@/components/digest-subscriptions-panel"
import type { AiAutomationFlag } from "@/lib/ai-feature-flags"

type Scenario = "acknowledge" | "followup" | "payment" | "renewal" | "hotLead" | "triage" | "stageAdvance" | "sentiment" | "kbClose" | "duplicate" | "creditLimit" | "meetingRecap" | "socialReply" | "socialViral"
type Mode = "shadow" | "live"

interface AiFeature {
  key: string
  label: string
  description: string
  category: "analytics" | "copilot" | "autopilot"
  scenario?: Scenario
  mode?: Mode
  enabled: boolean
}

interface AdvisorSettingsPayload {
  settings: {
    executionEnabled: boolean
    dailyLimit: number
    actionTypeDailyLimit: number
    maxAutonomyLevel: "L0" | "L1" | "L2" | "L3" | "L4"
  }
  readiness: {
    summary: {
      enabledModules: number
      disabledModules: number
      noAccessModules: number
      activeCollectors: number
      noDataCollectors: number
      failedCollectors: number
      disabledCollectors: number
      noPermissionCollectors: number
      overallStatus: "active" | "no_data" | "disabled" | "no_permission" | "collector_failed"
    }
    overview: {
      totalSignals: number
      critical: number
      high: number
      revenueAtRisk: number
      pendingActions: number
    }
    capabilities: Array<{
      key: string
      label: string
      status: "active" | "locked" | "no_access"
      reason?: string
    }>
    collectorHealth: Array<{
      domain: string
      domainLabel: string
      status: "active" | "no_data" | "disabled" | "no_permission" | "collector_failed"
      signalCount: number
      checkedAt: string
      reason?: string
    }>
    healthSnapshot: {
      generatedAt: string
      overallStatus: "active" | "no_data" | "disabled" | "no_permission" | "collector_failed"
      totalCollectors: number
      failedDomains: Array<{ domain: string; label: string; reason?: string | null; checkedAt: string }>
      noDataDomains: Array<{ domain: string; label: string; reason?: string | null; checkedAt: string }>
    }
  }
  monitoring: {
    collectorAlerts: Array<{
      id: string
      domain: string
      domainLabel: string
      severity: "critical"
      message: string
      checkedAt: string
    }>
    failedExecutions: Array<{
      id: string
      actionType: string
      entityType: string
      entityId: string
      domain: string
      title: string
      failureReason: string
      createdAt: string
      reviewedAt?: string | null
      executedAt?: string | null
    }>
  }
  playbooks: Array<{
    id: string
    name: string
    status: "disabled" | "enabled"
    approvalCount: number
    rejectionCount: number
    executionSuccessCount: number
    governance: {
      version: number
      ownerId?: string | null
      reviewDate?: string | null
      whyCandidate: string
      approvalHistory: Array<{
        id: string
        title: string
        approved: boolean | null
        executionStatus: string | null
        reviewedBy?: string | null
        reviewedAt?: string | null
        entityType: string
        entityId?: string | null
      }>
    }
  }>
  candidates: Array<{
    patternKey: string
    name: string
    domain: string
    actionType: string
    approvalCount: number
    rejectionCount: number
    executionSuccessCount: number
    whyCandidate: string
    approvalHistory: Array<{
      id: string
      title: string
      approved: boolean | null
      executionStatus: string | null
      reviewedBy?: string | null
      reviewedAt?: string | null
      entityType: string
      entityId?: string | null
    }>
    existingPlaybookId?: string
  }>
}

interface AdvisorSettingsError {
  status: number
  message: string
}

function formatAdvisorSettingsDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function approvalStatusKey(approved: boolean | null, executionStatus: string | null) {
  if (approved === false) return "advisorHistoryRejected"
  if (executionStatus === "executed") return "advisorHistoryExecuted"
  if (executionStatus === "failed") return "advisorHistoryFailed"
  if (executionStatus === "queued" || executionStatus === "executing") return "advisorHistoryQueued"
  return approved === true ? "advisorHistoryApproved" : "advisorHistoryReviewed"
}

// `key` is typed against the server-side allowlist (src/lib/ai-feature-flags.ts):
// a row added here without a matching entry there would be rejected at runtime by
// PATCH /api/v1/settings/ai-features, so make that a compile error instead.
const AI_FEATURE_KEYS: { key: AiAutomationFlag; labelKey: string; descKey: string; category: "analytics" | "copilot" | "autopilot"; scenario?: Scenario; mode?: Mode }[] = [
  { key: "ai_daily_briefing", labelKey: "dailyBriefing", descKey: "dailyBriefingDesc", category: "analytics" },
  { key: "ai_anomaly_detection", labelKey: "anomalyDetection", descKey: "anomalyDetectionDesc", category: "analytics" },
  { key: "ai_lead_scoring", labelKey: "leadScoring", descKey: "leadScoringDesc", category: "analytics" },
  { key: "ai_auto_acknowledge_shadow", labelKey: "autoAcknowledgeShadow", descKey: "autoAcknowledgeShadowDesc", category: "autopilot", scenario: "acknowledge", mode: "shadow" },
  { key: "ai_auto_followup_shadow", labelKey: "autoFollowupShadow", descKey: "autoFollowupShadowDesc", category: "autopilot", scenario: "followup", mode: "shadow" },
  { key: "ai_auto_payment_reminder_shadow", labelKey: "paymentReminderShadow", descKey: "paymentReminderShadowDesc", category: "autopilot", scenario: "payment", mode: "shadow" },
  { key: "ai_auto_acknowledge", labelKey: "autoAcknowledgeLive", descKey: "autoAcknowledgeLiveDesc", category: "autopilot", scenario: "acknowledge", mode: "live" },
  { key: "ai_auto_followup", labelKey: "autoFollowupLive", descKey: "autoFollowupLiveDesc", category: "autopilot", scenario: "followup", mode: "live" },
  { key: "ai_auto_payment_reminder", labelKey: "paymentReminderLive", descKey: "paymentReminderLiveDesc", category: "autopilot", scenario: "payment", mode: "live" },
  { key: "ai_auto_renewal_shadow", labelKey: "autoRenewalShadow", descKey: "autoRenewalShadowDesc", category: "autopilot", scenario: "renewal", mode: "shadow" },
  { key: "ai_auto_renewal", labelKey: "autoRenewalLive", descKey: "autoRenewalLiveDesc", category: "autopilot", scenario: "renewal", mode: "live" },
  { key: "ai_auto_hot_lead_shadow", labelKey: "autoHotLeadShadow", descKey: "autoHotLeadShadowDesc", category: "autopilot", scenario: "hotLead", mode: "shadow" },
  { key: "ai_auto_hot_lead", labelKey: "autoHotLeadLive", descKey: "autoHotLeadLiveDesc", category: "autopilot", scenario: "hotLead", mode: "live" },
  { key: "ai_auto_triage_shadow", labelKey: "autoTriageShadow", descKey: "autoTriageShadowDesc", category: "autopilot", scenario: "triage", mode: "shadow" },
  { key: "ai_auto_triage", labelKey: "autoTriageLive", descKey: "autoTriageLiveDesc", category: "autopilot", scenario: "triage", mode: "live" },
  { key: "ai_auto_stage_advance_shadow", labelKey: "autoStageAdvanceShadow", descKey: "autoStageAdvanceShadowDesc", category: "autopilot", scenario: "stageAdvance", mode: "shadow" },
  { key: "ai_auto_stage_advance", labelKey: "autoStageAdvanceLive", descKey: "autoStageAdvanceLiveDesc", category: "autopilot", scenario: "stageAdvance", mode: "live" },
  { key: "ai_auto_sentiment_shadow", labelKey: "autoSentimentShadow", descKey: "autoSentimentShadowDesc", category: "autopilot", scenario: "sentiment", mode: "shadow" },
  { key: "ai_auto_sentiment", labelKey: "autoSentimentLive", descKey: "autoSentimentLiveDesc", category: "autopilot", scenario: "sentiment", mode: "live" },
  { key: "ai_auto_kb_close_shadow", labelKey: "autoKbCloseShadow", descKey: "autoKbCloseShadowDesc", category: "autopilot", scenario: "kbClose", mode: "shadow" },
  { key: "ai_auto_kb_close", labelKey: "autoKbCloseLive", descKey: "autoKbCloseLiveDesc", category: "autopilot", scenario: "kbClose", mode: "live" },
  { key: "ai_auto_duplicate_shadow", labelKey: "autoDuplicateShadow", descKey: "autoDuplicateShadowDesc", category: "autopilot", scenario: "duplicate", mode: "shadow" },
  { key: "ai_auto_duplicate", labelKey: "autoDuplicateLive", descKey: "autoDuplicateLiveDesc", category: "autopilot", scenario: "duplicate", mode: "live" },
  { key: "ai_auto_credit_limit_shadow", labelKey: "autoCreditLimitShadow", descKey: "autoCreditLimitShadowDesc", category: "autopilot", scenario: "creditLimit", mode: "shadow" },
  { key: "ai_auto_credit_limit", labelKey: "autoCreditLimitLive", descKey: "autoCreditLimitLiveDesc", category: "autopilot", scenario: "creditLimit", mode: "live" },
  { key: "ai_auto_meeting_recap_shadow", labelKey: "autoMeetingRecapShadow", descKey: "autoMeetingRecapShadowDesc", category: "autopilot", scenario: "meetingRecap", mode: "shadow" },
  { key: "ai_auto_meeting_recap", labelKey: "autoMeetingRecapLive", descKey: "autoMeetingRecapLiveDesc", category: "autopilot", scenario: "meetingRecap", mode: "live" },
  { key: "ai_auto_social_reply_shadow", labelKey: "autoSocialReplyShadow", descKey: "autoSocialReplyShadowDesc", category: "autopilot", scenario: "socialReply", mode: "shadow" },
  { key: "ai_auto_social_reply", labelKey: "autoSocialReplyLive", descKey: "autoSocialReplyLiveDesc", category: "autopilot", scenario: "socialReply", mode: "live" },
  { key: "ai_auto_social_viral_shadow", labelKey: "autoSocialViralShadow", descKey: "autoSocialViralShadowDesc", category: "autopilot", scenario: "socialViral", mode: "shadow" },
  { key: "ai_auto_social_viral", labelKey: "autoSocialViralLive", descKey: "autoSocialViralLiveDesc", category: "autopilot", scenario: "socialViral", mode: "live" },
]

const SCENARIOS: { key: Scenario; titleKey: string; descKey: string; icon: LucideIcon; accent: string }[] = [
  { key: "creditLimit", titleKey: "scenarioCreditLimitTitle", descKey: "scenarioCreditLimitDesc", icon: CreditCard, accent: "text-red-600" },
  { key: "sentiment", titleKey: "scenarioSentimentTitle", descKey: "scenarioSentimentDesc", icon: AlertTriangle, accent: "text-orange-600" },
  { key: "hotLead", titleKey: "scenarioHotLeadTitle", descKey: "scenarioHotLeadDesc", icon: Flame, accent: "text-rose-500" },
  { key: "triage", titleKey: "scenarioTriageTitle", descKey: "scenarioTriageDesc", icon: Tags, accent: "text-indigo-500" },
  { key: "kbClose", titleKey: "scenarioKbCloseTitle", descKey: "scenarioKbCloseDesc", icon: BookOpen, accent: "text-cyan-500" },
  { key: "stageAdvance", titleKey: "scenarioStageAdvanceTitle", descKey: "scenarioStageAdvanceDesc", icon: TrendingUp, accent: "text-purple-500" },
  { key: "meetingRecap", titleKey: "scenarioMeetingRecapTitle", descKey: "scenarioMeetingRecapDesc", icon: Video, accent: "text-teal-500" },
  { key: "socialViral", titleKey: "scenarioSocialViralTitle", descKey: "scenarioSocialViralDesc", icon: Megaphone, accent: "text-pink-500" },
  { key: "socialReply", titleKey: "scenarioSocialReplyTitle", descKey: "scenarioSocialReplyDesc", icon: MessagesSquare, accent: "text-sky-500" },
  { key: "renewal", titleKey: "scenarioRenewalTitle", descKey: "scenarioRenewalDesc", icon: RefreshCw, accent: "text-emerald-500" },
  { key: "duplicate", titleKey: "scenarioDuplicateTitle", descKey: "scenarioDuplicateDesc", icon: GitMerge, accent: "text-slate-500" },
  { key: "acknowledge", titleKey: "scenarioAckTitle", descKey: "scenarioAckDesc", icon: Clock, accent: "text-amber-500" },
  { key: "followup", titleKey: "scenarioFollowupTitle", descKey: "scenarioFollowupDesc", icon: MessageSquare, accent: "text-blue-500" },
  { key: "payment", titleKey: "scenarioPaymentTitle", descKey: "scenarioPaymentDesc", icon: Mail, accent: "text-red-500" },
]

const ANALYTICS_PREVIEW_KEYS: Record<string, string> = {
  ai_daily_briefing: "previewDailyBriefing",
  ai_anomaly_detection: "previewAnomalyDetection",
  ai_lead_scoring: "previewLeadScoring",
}

export default function AiAutomationPage() {
  const { data: session, update } = useSession()
  const t = useTranslations("aiSettings")
  useAutoTour("aiAutomation")
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId
  const [features, setFeatures] = useState<AiFeature[]>([])
  const [budget, setBudget] = useState<{ spent: number; limit: number; remaining: number } | null>(null)
  const [budgetLimit, setBudgetLimit] = useState("")
  // A6 — granular AI limits (per-conversation, per-contact/day, output tokens).
  const [aiLimits, setAiLimits] = useState<{ maxRepliesPerConversation: string; maxRepliesPerContactPerDay: string; maxOutputTokens: string }>({ maxRepliesPerConversation: "", maxRepliesPerContactPerDay: "", maxOutputTokens: "" })
  const [savingLimits, setSavingLimits] = useState(false)
  const [stats, setStats] = useState<{ approvedThisMonth: number; rejectedThisMonth: number; pending: number; minutesSaved: number; byFeature: Record<string, number> } | null>(null)
  const [advisorSettings, setAdvisorSettings] = useState<AdvisorSettingsPayload | null>(null)
  const [advisorSettingsError, setAdvisorSettingsError] = useState<AdvisorSettingsError | null>(null)
  const [advisorDraft, setAdvisorDraft] = useState({
    executionEnabled: true,
    dailyLimit: "100",
    actionTypeDailyLimit: "25",
    maxAutonomyLevel: "L2" as AdvisorSettingsPayload["settings"]["maxAutonomyLevel"],
  })
  const [savingBudget, setSavingBudget] = useState(false)
  const [savingAdvisor, setSavingAdvisor] = useState(false)
  const [advisorBusyKey, setAdvisorBusyKey] = useState<string | null>(null)
  const [delivery, setDelivery] = useState({ telegramBotToken: "", telegramChatId: "", slackWebhookUrl: "", language: "ru" })
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [deliverySaved, setDeliverySaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null)

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (orgId) headers["x-organization-id"] = orgId

  const fetchData = async () => {
    setLoading(true)
    setAdvisorSettingsError(null)
    try {
      const [featuresRes, budgetRes, deliveryRes, statsRes, advisorRes] = await Promise.all([
        fetch("/api/v1/settings/ai-features", { headers }).then(r => r.json()).catch(() => null),
        fetch("/api/v1/settings/ai-budget", { headers }).then(r => r.json()).catch(() => null),
        fetch("/api/v1/settings/ai-delivery", { headers }).then(r => r.json()).catch(() => null),
        fetch("/api/v1/settings/ai-stats", { headers }).then(r => r.json()).catch(() => null),
        fetch("/api/v1/settings/ai-advisor", { headers }).then(async (r) => {
          const body = await r.json().catch(() => null)
          if (!r.ok) {
            setAdvisorSettings(null)
            setAdvisorSettingsError({
              status: r.status,
              message: typeof body?.message === "string" ? body.message : t("advisorSettingsUnavailableDesc"),
            })
            return null
          }
          return body
        }).catch(() => {
          setAdvisorSettings(null)
          setAdvisorSettingsError({ status: 0, message: t("advisorSettingsUnavailableDesc") })
          return null
        }),
      ])

      if (statsRes?.data) setStats(statsRes.data)
      if (advisorRes?.data) {
        const data = advisorRes.data as AdvisorSettingsPayload
        setAdvisorSettingsError(null)
        setAdvisorSettings(data)
        setAdvisorDraft({
          executionEnabled: data.settings.executionEnabled,
          dailyLimit: String(data.settings.dailyLimit),
          actionTypeDailyLimit: String(data.settings.actionTypeDailyLimit),
          maxAutonomyLevel: data.settings.maxAutonomyLevel,
        })
      }

      const orgFeatures: string[] = Array.isArray(featuresRes?.data?.features) ? featuresRes.data.features : []
      setFeatures(AI_FEATURE_KEYS.map(f => ({
        key: f.key,
        label: t(f.labelKey),
        description: t(f.descKey),
        category: f.category,
        scenario: f.scenario,
        mode: f.mode,
        enabled: orgFeatures.includes(f.key),
      })))

      if (budgetRes?.data) {
        if (budgetRes.data.limits) {
          setAiLimits({
            maxRepliesPerConversation: String(budgetRes.data.limits.maxRepliesPerConversation),
            maxRepliesPerContactPerDay: String(budgetRes.data.limits.maxRepliesPerContactPerDay),
            maxOutputTokens: String(budgetRes.data.limits.maxOutputTokens),
          })
        }
        setBudget(budgetRes.data)
        setBudgetLimit(String(budgetRes.data.limit))
      }

      if (deliveryRes?.data) {
        setDelivery(d => ({ ...d, ...deliveryRes.data }))
      }
    } catch {}
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void fetchData() }, [orgId])

  const toggleFeature = async (key: string, currentlyEnabled: boolean) => {
    setToggling(key)
    try {
      const action = currentlyEnabled ? "remove" : "add"
      await fetch("/api/v1/settings/ai-features", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ feature: key, action }),
      })
      setFeatures(prev => prev.map(f => f.key === key ? { ...f, enabled: !f.enabled } : f))
      // Refresh the session so `session.user.modules` reflects the toggled
      // feature immediately — nav (accessibleNavItems) re-gates without a reload.
      await update()
    } catch {}
    setToggling(null)
  }

  const saveBudgetLimit = async () => {
    const val = parseFloat(budgetLimit)
    if (isNaN(val) || val <= 0) return
    setSavingBudget(true)
    try {
      await fetch("/api/v1/settings/ai-budget", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ limit: val }),
      })
      setBudget(prev => prev ? { ...prev, limit: val, remaining: Math.max(0, val - prev.spent) } : prev)
    } catch {}
    setSavingBudget(false)
  }

  const saveAiLimits = async () => {
    const ints = {
      maxRepliesPerConversation: parseInt(aiLimits.maxRepliesPerConversation),
      maxRepliesPerContactPerDay: parseInt(aiLimits.maxRepliesPerContactPerDay),
      maxOutputTokens: parseInt(aiLimits.maxOutputTokens),
    }
    if (Object.values(ints).some((v) => !Number.isInteger(v) || v <= 0)) return
    setSavingLimits(true)
    try {
      await fetch("/api/v1/settings/ai-budget", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ aiLimits: ints }),
      })
    } catch {}
    setSavingLimits(false)
  }

  const saveAdvisorControls = async () => {
    setSavingAdvisor(true)
    try {
      const res = await fetch("/api/v1/settings/ai-advisor", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          executionEnabled: advisorDraft.executionEnabled,
          dailyLimit: Number(advisorDraft.dailyLimit),
          actionTypeDailyLimit: Number(advisorDraft.actionTypeDailyLimit),
          maxAutonomyLevel: advisorDraft.maxAutonomyLevel,
        }),
      }).then(r => r.json()).catch(() => null)
      if (res?.data) setAdvisorSettings(res.data)
    } catch {}
    setSavingAdvisor(false)
  }

  const promoteAdvisorCandidate = async (patternKey: string) => {
    setAdvisorBusyKey(patternKey)
    try {
      await fetch("/api/v1/settings/ai-advisor", {
        method: "POST",
        headers,
        body: JSON.stringify({ patternKey }),
      })
      await fetchData()
    } catch {}
    setAdvisorBusyKey(null)
  }

  const toggleAdvisorPlaybook = async (playbookId: string, status: "disabled" | "enabled") => {
    setAdvisorBusyKey(playbookId)
    try {
      const res = await fetch("/api/v1/settings/ai-advisor", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ playbookId, playbookStatus: status === "enabled" ? "disabled" : "enabled" }),
      }).then(r => r.json()).catch(() => null)
      if (res?.data) setAdvisorSettings(res.data)
    } catch {}
    setAdvisorBusyKey(null)
  }

  const saveDelivery = async () => {
    setSavingDelivery(true)
    setDeliverySaved(false)
    try {
      await fetch("/api/v1/settings/ai-delivery", {
        method: "PATCH",
        headers,
        body: JSON.stringify(delivery),
      })
      setDeliverySaved(true)
      setTimeout(() => setDeliverySaved(false), 3000)
    } catch {}
    setSavingDelivery(false)
  }

  if (loading) {
    return (
      <MotionPage>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </MotionPage>
    )
  }

  const grouped = {
    analytics: features.filter(f => f.category === "analytics"),
    copilot: features.filter(f => f.category === "copilot"),
    autopilot: features.filter(f => f.category === "autopilot"),
  }

  return (
    <MotionPage>
      <div className="flex flex-col items-start justify-between gap-3 mb-5 md:flex-row md:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6" /> {t("title")} <TourReplayButton tourId="aiAutomation" /> <HelpButton slug="ai-automation" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end">
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> {t("refresh")}
          </Button>
        </div>
      </div>

      {/* Hero: how AI works */}
      <Card data-tour-id="ai-hero" className="mb-6 border-primary/15 bg-gradient-to-br from-primary/[0.04] via-transparent to-transparent">
        <CardContent className="pt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {t("heroHowItWorks")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex gap-3 p-3 rounded-lg bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40">
              <div className="shrink-0 h-9 w-9 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <p className="text-sm font-semibold text-foreground">{t("heroAnalyticsTitle")}</p>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    {t("heroBadgeSafe")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{t("heroAnalyticsDesc")}</p>
              </div>
            </div>

            <div className="flex gap-3 p-3 rounded-lg bg-amber-50/70 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
              <div className="shrink-0 h-9 w-9 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <p className="text-sm font-semibold text-foreground">{t("heroShadowTitle")}</p>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                    {t("heroBadgeReview")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{t("heroShadowDesc")}</p>
              </div>
            </div>

            <div className="flex gap-3 p-3 rounded-lg bg-violet-50/70 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40">
              <div className="shrink-0 h-9 w-9 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center">
                <Bot className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <p className="text-sm font-semibold text-foreground">{t("heroLiveTitle")}</p>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400">
                    {t("heroBadgeAuto")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{t("heroLiveDesc")}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats: AI value this month */}
      {stats && (
        <Card className="mb-6">
          <CardContent className="pt-5">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
              <Sparkles className="h-4 w-4 text-violet-500" />
              {t("statsTitle")}
            </h3>
            {stats.approvedThisMonth === 0 && stats.rejectedThisMonth === 0 && stats.pending === 0 ? (
              <p className="text-xs text-muted-foreground">{t("statsEmptyHint")}</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="shrink-0 h-8 w-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-semibold leading-tight">{stats.approvedThisMonth}</p>
                    <p className="text-[11px] text-muted-foreground">{t("statsApproved")}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="shrink-0 h-8 w-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <XCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-semibold leading-tight">{stats.rejectedThisMonth}</p>
                    <p className="text-[11px] text-muted-foreground">{t("statsRejected")}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="shrink-0 h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-semibold leading-tight">{stats.pending}</p>
                    <p className="text-[11px] text-muted-foreground">{t("statsPending")}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="shrink-0 h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-semibold leading-tight">
                      {stats.minutesSaved < 60
                        ? t("statsMinutes", { n: stats.minutesSaved })
                        : t("statsHours", { h: Math.floor(stats.minutesSaved / 60), m: stats.minutesSaved % 60 })}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{t("statsTimeSaved")}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Budget Card */}
      {budget && (
        <Card data-tour-id="ai-budget" className="mb-6">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-violet-500" /> {t("budgetTitle")}
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label={t("budgetHelpTitle")} className="text-muted-foreground hover:text-foreground">
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 text-xs space-y-2">
                    <p className="font-semibold text-sm">{t("budgetHelpTitle")}</p>
                    <p className="leading-relaxed">{t("budgetHelpBody")}</p>
                    <p className="text-muted-foreground">{t("budgetHelpTypical")}</p>
                  </PopoverContent>
                </Popover>
              </h3>
              <Badge variant={budget.spent >= budget.limit ? "destructive" : budget.spent >= budget.limit * 0.8 ? "secondary" : "outline"} className="text-xs">
                ${budget.spent.toFixed(3)} / ${budget.limit.toFixed(2)}
              </Badge>
            </div>
            {/* Progress bar */}
            <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all ${
                  budget.spent >= budget.limit ? "bg-red-500" : budget.spent >= budget.limit * 0.8 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, (budget.spent / budget.limit) * 100)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">{t("dailyLimit")}: $</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={budgetLimit}
                onChange={e => setBudgetLimit(e.target.value)}
                className="h-7 w-20 text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 bg-background"
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveBudgetLimit} disabled={savingBudget}>
                {savingBudget ? "..." : t("save")}
              </Button>
              <span className="text-[10px] text-muted-foreground sm:ml-auto">{t("budgetRemaining")}: ${budget.remaining.toFixed(3)}</span>
            </div>
            {/* A6 — granular limits: one level below the daily USD cap. */}
            <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border/60 pt-3">
              {([
                ["maxRepliesPerConversation", t("limitPerConversation")],
                ["maxRepliesPerContactPerDay", t("limitPerContactDay")],
                ["maxOutputTokens", t("limitOutputTokens")],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                  {label}
                  <input
                    type="number"
                    min="1"
                    value={aiLimits[key]}
                    onChange={(e) => setAiLimits((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="h-7 w-24 rounded border border-zinc-200 bg-background px-2 text-xs dark:border-zinc-700"
                  />
                </label>
              ))}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveAiLimits} disabled={savingLimits}>
                {savingLimits ? "..." : t("save")}
              </Button>
              <span className="basis-full text-[10px] text-muted-foreground">{t("limitsHint")}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delivery Channels */}
      <Card data-tour-id="ai-delivery" className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4" /> {t("deliveryChannels")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("deliveryChannelsDesc")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Email info */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/30">
            <Mail className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Email</p>
              <p className="text-xs text-muted-foreground">{t("emailDeliveryDesc")}</p>
            </div>
            <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">{t("automatic")}</Badge>
          </div>

          {/* Telegram */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Send className="h-3.5 w-3.5 text-sky-500" />
              <span className="text-sm font-medium">Telegram</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" aria-label={t("telegramHelpTitle")} className="text-muted-foreground hover:text-foreground">
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 text-xs space-y-2">
                  <p className="font-semibold text-sm">{t("telegramHelpTitle")}</p>
                  <p>{t("telegramHelpStep1")}</p>
                  <p>{t("telegramHelpStep2")}</p>
                  <p>{t("telegramHelpStep3")}</p>
                </PopoverContent>
              </Popover>
              {delivery.telegramBotToken && delivery.telegramChatId && (
                <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">{t("configured")}</Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Bot Token"
                value={delivery.telegramBotToken}
                onChange={e => setDelivery(d => ({ ...d, telegramBotToken: e.target.value }))}
                className="h-8 text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 bg-background"
              />
              <input
                type="text"
                placeholder="Chat ID"
                value={delivery.telegramChatId}
                onChange={e => setDelivery(d => ({ ...d, telegramChatId: e.target.value }))}
                className="h-8 text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 bg-background"
              />
            </div>
          </div>

          {/* Slack */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-sm font-medium">Slack</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" aria-label={t("slackHelpTitle")} className="text-muted-foreground hover:text-foreground">
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 text-xs space-y-2">
                  <p className="font-semibold text-sm">{t("slackHelpTitle")}</p>
                  <p>{t("slackHelpStep1")}</p>
                  <p>{t("slackHelpStep2")}</p>
                  <p>{t("slackHelpStep3")}</p>
                </PopoverContent>
              </Popover>
              {delivery.slackWebhookUrl && (
                <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">{t("configured")}</Badge>
              )}
            </div>
            <input
              type="text"
              placeholder="Webhook URL (https://hooks.slack.com/...)"
              value={delivery.slackWebhookUrl}
              onChange={e => setDelivery(d => ({ ...d, slackWebhookUrl: e.target.value }))}
              className="h-8 w-full text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 bg-background"
            />
          </div>

          {/* Language */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{t("briefingLanguage")}:</span>
            <select
              value={delivery.language}
              onChange={e => setDelivery(d => ({ ...d, language: e.target.value }))}
              className="h-8 text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 bg-background"
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
              <option value="az">Azərbaycan</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveDelivery} disabled={savingDelivery}>
              {savingDelivery ? "..." : t("save")}
            </Button>
            {deliverySaved && <span className="text-xs text-green-600">{t("saved")}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Per-user subscription matrix — who gets which digest, how often,
          through which channels. Replaces the old hardcoded "everyone with
          role=admin/manager" rule for daily briefings, anomaly alerts and
          renewal reminders. */}
      <DigestSubscriptionsPanel />

      {advisorSettingsError && (
        <Card className="mb-6 border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-600" /> {t("advisorControlsTitle")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("advisorSettingsUnavailableDesc")}</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <Badge variant="outline" className="mb-2 text-[11px]">
                  {advisorSettingsError.status === 403 ? t("advisorSettingsNoPermission") : t("advisorSettingsUnavailable")}
                </Badge>
                <p className="max-w-2xl text-sm text-muted-foreground">{advisorSettingsError.message}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {advisorSettings && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" /> {t("advisorControlsTitle")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("advisorControlsDesc")}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <details className="rounded-lg border bg-muted/20 p-3.5">
              <summary className="cursor-pointer list-item">
                <div>
                  <p className="text-sm font-medium">{t("advisorLiveReadiness")}</p>
                  <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t("advisorLiveReadinessDesc")}</p>
                </div>
              </summary>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-md border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">{t("advisorSignals")}</p>
                  <p className="mt-1 text-lg font-semibold">{advisorSettings.readiness.overview.totalSignals}</p>
                </div>
                <div className="rounded-md border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">{t("advisorCriticalHigh")}</p>
                  <p className="mt-1 text-lg font-semibold">
                    {advisorSettings.readiness.overview.critical + advisorSettings.readiness.overview.high}
                  </p>
                </div>
                <div className="rounded-md border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">{t("advisorMoneyAtRisk")}</p>
                  <p className="mt-1 text-lg font-semibold">{advisorSettings.readiness.overview.revenueAtRisk.toLocaleString()} AZN</p>
                </div>
                <div className="rounded-md border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">{t("advisorPendingApprovals")}</p>
                  <p className="mt-1 text-lg font-semibold">{advisorSettings.readiness.overview.pendingActions}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                <div className="rounded-md border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">{t("advisorEnabledModules")}</p>
                  <p className="mt-1 text-base font-semibold">{advisorSettings.readiness.summary.enabledModules}</p>
                </div>
                <div className="rounded-md border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">{t("advisorActiveCollectors")}</p>
                  <p className="mt-1 text-base font-semibold">{advisorSettings.readiness.summary.activeCollectors}</p>
                </div>
                <div className="rounded-md border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">{t("advisorNoDataCollectors")}</p>
                  <p className="mt-1 text-base font-semibold">{advisorSettings.readiness.summary.noDataCollectors}</p>
                </div>
                <div className="rounded-md border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">{t("advisorDisabledCollectors")}</p>
                  <p className="mt-1 text-base font-semibold">{advisorSettings.readiness.summary.disabledCollectors + advisorSettings.readiness.summary.noPermissionCollectors}</p>
                </div>
                <div className="rounded-md border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">{t("advisorFailedCollectors")}</p>
                  <p className="mt-1 text-base font-semibold">{advisorSettings.readiness.summary.failedCollectors}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                {advisorSettings.readiness.collectorHealth.map((health) => (
                  <div key={health.domain} className="rounded-md border bg-background p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{health.domainLabel}</p>
                      <Badge variant={advisorHealthVariant(health.status)} className="text-[10px]">
                        {advisorHealthStatusLabel(health.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm font-semibold">{health.signalCount}</p>
                    <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">
                      {advisorHealthReason(health, t("advisorCollectorOk"), t("advisorCollectorFailed"))}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{t("advisorHealthSnapshot")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("advisorHealthSnapshotDesc", {
                        generatedAt: formatAdvisorSettingsDate(advisorSettings.readiness.healthSnapshot.generatedAt),
                        total: advisorSettings.readiness.healthSnapshot.totalCollectors,
                      })}
                    </p>
                  </div>
                  <Badge variant={advisorHealthVariant(advisorSettings.readiness.healthSnapshot.overallStatus)} className="text-[10px]">
                    {advisorHealthStatusLabel(advisorSettings.readiness.healthSnapshot.overallStatus)}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div className="rounded-md bg-muted/30 p-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground">{t("advisorNoDataDomains")}</p>
                    <p className="mt-1 text-xs">
                      {advisorSettings.readiness.healthSnapshot.noDataDomains.length > 0
                        ? advisorSettings.readiness.healthSnapshot.noDataDomains.map((item) => item.label).join(", ")
                        : t("advisorNoDataDomainsEmpty")}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground">{t("advisorFailedDomains")}</p>
                    <p className="mt-1 text-xs">
                      {advisorSettings.readiness.healthSnapshot.failedDomains.length > 0
                        ? advisorSettings.readiness.healthSnapshot.failedDomains.map((item) => item.label).join(", ")
                        : t("advisorFailedDomainsEmpty")}
                    </p>
                  </div>
                </div>
                {advisorSettings.monitoring.collectorAlerts.length > 0 ? (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50/60 p-2.5 dark:border-red-900/60 dark:bg-red-950/20">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <p className="text-xs font-semibold">{t("advisorCollectorAlerts")}</p>
                    </div>
                    <div className="mt-2 space-y-2">
                      {advisorSettings.monitoring.collectorAlerts.slice(0, 4).map((alert) => (
                        <div key={alert.id} className="grid gap-1 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{alert.domainLabel}</span>
                            <span className="text-[11px] text-muted-foreground">{formatAdvisorSettingsDate(alert.checkedAt)}</span>
                          </div>
                          <p className="text-muted-foreground">{alert.message}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>

            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
              <div className="rounded-lg border bg-card p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{t("advisorExecution")}</p>
                    <p className="text-xs text-muted-foreground">{t("advisorExecutionDesc")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdvisorDraft((draft) => ({ ...draft, executionEnabled: !draft.executionEnabled }))}
                    className="shrink-0"
                    aria-label={t("advisorExecution")}
                  >
                    {advisorDraft.executionEnabled ? (
                      <ToggleRight className="h-7 w-7 text-primary" />
                    ) : (
                      <ToggleLeft className="h-7 w-7 text-muted-foreground" />
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t("advisorMaxAutonomy")}</span>
                    <select
                      value={advisorDraft.maxAutonomyLevel}
                      onChange={(e) => setAdvisorDraft((draft) => ({ ...draft, maxAutonomyLevel: e.target.value as AdvisorSettingsPayload["settings"]["maxAutonomyLevel"] }))}
                      className="h-9 w-full rounded border border-zinc-200 bg-background px-2 text-sm dark:border-zinc-700"
                    >
                      {["L0", "L1", "L2", "L3", "L4"].map((level) => (
                        <option key={level} value={level}>{level}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t("advisorDailyCap")}</span>
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={advisorDraft.dailyLimit}
                      onChange={(e) => setAdvisorDraft((draft) => ({ ...draft, dailyLimit: e.target.value }))}
                      className="h-9 w-full rounded border border-zinc-200 bg-background px-2 text-sm dark:border-zinc-700"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t("advisorActionCap")}</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={advisorDraft.actionTypeDailyLimit}
                      onChange={(e) => setAdvisorDraft((draft) => ({ ...draft, actionTypeDailyLimit: e.target.value }))}
                      className="h-9 w-full rounded border border-zinc-200 bg-background px-2 text-sm dark:border-zinc-700"
                    />
                  </label>
                </div>

                <Button size="sm" variant="outline" onClick={saveAdvisorControls} disabled={savingAdvisor}>
                  {savingAdvisor ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {t("save")}
                </Button>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3.5">
                <p className="text-sm font-medium">{t("advisorPlaybooks")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("advisorPlaybooksDesc")}</p>
                <div className="mt-3 space-y-2">
                  {advisorSettings.playbooks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("advisorNoPlaybooks")}</p>
                  ) : advisorSettings.playbooks.slice(0, 4).map((playbook) => (
                    <div key={playbook.id} className="rounded-md border bg-background p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{playbook.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {t("advisorPlaybookStats", { approved: playbook.approvalCount, executed: playbook.executionSuccessCount })}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {t("advisorPlaybookGovernance", {
                              owner: playbook.governance.ownerId || t("advisorGovernanceUnassigned"),
                              reviewDate: playbook.governance.reviewDate ? formatAdvisorSettingsDate(playbook.governance.reviewDate) : t("advisorGovernanceNoReview"),
                              version: playbook.governance.version,
                            })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleAdvisorPlaybook(playbook.id, playbook.status)}
                          disabled={advisorBusyKey === playbook.id}
                          className="shrink-0"
                        >
                          {advisorBusyKey === playbook.id ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : playbook.status === "enabled" ? <ToggleRight className="h-6 w-6 text-primary" /> : <ToggleLeft className="h-6 w-6 text-muted-foreground" />}
                        </button>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{playbook.governance.whyCandidate}</p>
                      {playbook.governance.approvalHistory.length > 0 ? (
                        <div className="mt-2 space-y-1 border-t pt-2">
                          {playbook.governance.approvalHistory.slice(0, 2).map((history) => (
                            <p key={history.id} className="truncate text-[11px] text-muted-foreground">
                              {t(approvalStatusKey(history.approved, history.executionStatus))} · {history.title} · {formatAdvisorSettingsDate(history.reviewedAt)}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{t("advisorPromotions")}</p>
                  <p className="text-xs text-muted-foreground">{t("advisorPromotionsDesc")}</p>
                </div>
                <Badge variant="outline" className="text-[10px]">{advisorSettings.candidates.length}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {advisorSettings.candidates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("advisorNoPromotions")}</p>
                ) : advisorSettings.candidates.slice(0, 4).map((candidate) => (
                  <div key={candidate.patternKey} className="rounded-md border bg-muted/20 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{candidate.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t("advisorCandidateStats", { approved: candidate.approvalCount, rejected: candidate.rejectionCount, executed: candidate.executionSuccessCount })}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{candidate.whyCandidate}</p>
                        {candidate.approvalHistory.length > 0 ? (
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">
                            {t("advisorApprovalHistory")}: {candidate.approvalHistory.slice(0, 2).map((history) =>
                              `${t(approvalStatusKey(history.approved, history.executionStatus))} ${formatAdvisorSettingsDate(history.reviewedAt)}`
                            ).join(" · ")}
                          </p>
                        ) : null}
                      </div>
                      {candidate.existingPlaybookId ? (
                        <Badge variant="secondary" className="text-[10px]">{t("configured")}</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 text-xs"
                          onClick={() => promoteAdvisorCandidate(candidate.patternKey)}
                          disabled={advisorBusyKey === candidate.patternKey}
                        >
                          {advisorBusyKey === candidate.patternKey ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                          {t("advisorPromote")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-card p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{t("advisorFailedExecutionFeed")}</p>
                  <p className="text-xs text-muted-foreground">{t("advisorFailedExecutionFeedDesc")}</p>
                </div>
                <Badge variant={advisorSettings.monitoring.failedExecutions.length > 0 ? "destructive" : "outline"} className="text-[10px]">
                  {advisorSettings.monitoring.failedExecutions.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2">
                {advisorSettings.monitoring.failedExecutions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("advisorNoFailedExecutions")}</p>
                ) : advisorSettings.monitoring.failedExecutions.slice(0, 6).map((failure) => (
                  <div key={failure.id} className="rounded-md border bg-muted/20 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-medium">{failure.title}</p>
                      <Badge variant="outline" className="text-[10px]">{failure.actionType}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {failure.domain} · {failure.entityType}:{failure.entityId} · {formatAdvisorSettingsDate(failure.executedAt || failure.createdAt)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{failure.failureReason}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Feature Toggles */}
      <div data-tour-id="ai-toggles" className="space-y-6 mb-8">
        {grouped.analytics.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3 text-blue-600">
              <Eye className="h-4 w-4" /> {t("analytics")}
            </h2>
            <div className="grid gap-2">
              {grouped.analytics.map(f => {
                const previewKey = ANALYTICS_PREVIEW_KEYS[f.key]
                const isFeatExpanded = expandedFeature === f.key
                return (
                  <div
                    key={f.key}
                    className={`rounded-lg border transition-colors ${
                      f.enabled ? "bg-card border-zinc-200 dark:border-zinc-700" : "bg-muted/30 border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{f.label}</p>
                        <p className="text-xs text-muted-foreground">{f.description}</p>
                      </div>
                      <button
                        onClick={() => toggleFeature(f.key, f.enabled)}
                        disabled={toggling === f.key}
                        className="shrink-0 ml-4"
                      >
                        {toggling === f.key ? (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : f.enabled ? (
                          <ToggleRight className="h-6 w-6 text-primary" />
                        ) : (
                          <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                    {previewKey && (
                      <div className="px-3 pb-3">
                        <button
                          type="button"
                          onClick={() => setExpandedFeature(isFeatExpanded ? null : f.key)}
                          className="text-[11px] text-primary hover:underline flex items-center gap-1"
                        >
                          {isFeatExpanded ? t("featurePreviewHide") : t("featurePreview")}
                          <ChevronDown className={`h-3 w-3 transition-transform ${isFeatExpanded ? "rotate-180" : ""}`} />
                        </button>
                        {isFeatExpanded && (
                          <div className="mt-2 p-3 rounded-md bg-muted/60 border-l-[3px] border-blue-400">
                            <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide mb-1.5">
                              {t("featurePreviewLabel")}
                            </p>
                            <p className="text-xs text-foreground whitespace-pre-line leading-relaxed">
                              {t(previewKey as never)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {grouped.autopilot.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3 text-amber-600">
              <Bot className="h-4 w-4" /> {t("autopilot")}
            </h2>
            <div className="grid gap-3">
              {SCENARIOS.map(s => {
                const shadow = grouped.autopilot.find(f => f.scenario === s.key && f.mode === "shadow")
                const live = grouped.autopilot.find(f => f.scenario === s.key && f.mode === "live")
                if (!shadow || !live) return null
                const Icon = s.icon
                return (
                  <div key={s.key} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-3.5">
                    <div className="flex items-start gap-2.5 mb-3">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${s.accent}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t(s.titleKey as never)}</p>
                        <p className="text-xs text-muted-foreground">{t(s.descKey as never)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className={`flex items-center justify-between p-2.5 rounded-md transition-colors ${
                        shadow.enabled
                          ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50"
                          : "bg-muted/40 border border-transparent"
                      }`}>
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5">
                            <Shield className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                            <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">{t("modeReview")}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{t("modeReviewDesc")}</p>
                        </div>
                        <button
                          onClick={() => toggleFeature(shadow.key, shadow.enabled)}
                          disabled={toggling === shadow.key}
                          className="shrink-0"
                        >
                          {toggling === shadow.key ? (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          ) : shadow.enabled ? (
                            <ToggleRight className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                          )}
                        </button>
                      </div>

                      <div className={`flex items-center justify-between p-2.5 rounded-md transition-colors ${
                        live.enabled
                          ? "bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/50"
                          : "bg-muted/40 border border-transparent"
                      }`}>
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5">
                            <Bot className="h-3 w-3 text-violet-600 dark:text-violet-400 shrink-0" />
                            <span className="text-xs font-semibold text-violet-800 dark:text-violet-300">{t("modeAuto")}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{t("modeAutoDesc")}</p>
                        </div>
                        <button
                          onClick={() => toggleFeature(live.key, live.enabled)}
                          disabled={toggling === live.key}
                          className="shrink-0"
                        >
                          {toggling === live.key ? (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          ) : live.enabled ? (
                            <ToggleRight className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                          ) : (
                            <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </MotionPage>
  )
}

function advisorHealthVariant(status: AdvisorSettingsPayload["readiness"]["collectorHealth"][number]["status"]) {
  switch (status) {
    case "active":
      return "success"
    case "no_data":
      return "outline"
    case "disabled":
    case "no_permission":
      return "warning"
    case "collector_failed":
      return "destructive"
  }
}

function advisorHealthStatusLabel(status: AdvisorSettingsPayload["readiness"]["collectorHealth"][number]["status"]) {
  switch (status) {
    case "active":
      return "active"
    case "no_data":
      return "no data"
    case "disabled":
      return "disabled"
    case "no_permission":
      return "no access"
    case "collector_failed":
      return "failed"
  }
}

function advisorHealthReason(
  health: AdvisorSettingsPayload["readiness"]["collectorHealth"][number],
  okText: string,
  failedText: string,
) {
  if (health.status === "collector_failed") return failedText
  return health.reason || okText
}
