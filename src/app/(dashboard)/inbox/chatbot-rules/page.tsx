"use client"

/**
 * Phase 7 slice-1b — chatbot auto-reply admin. Direct-URL page (/inbox/chatbot-rules),
 * no nav link yet (same "verify before linking" stance as /inbox/v2 + /inbox/analytics).
 *
 * Built for NON-TECHNICAL users: plain-language sentence-style rule builder, fully
 * localized (ru/az/en via the `chatbotRules` message namespace), an inline "How it works"
 * guide, rotating "Did you know" tips, and an onboarding tour (`useAutoTour`).
 *
 * Manages the inbound auto-reply rules (slice-1 API) + the org-level master enable flag
 * (reuses the standard ai-features toggle — "chatbotAutoReply" in Organization.features,
 * a string[] of flags). Until the master is ON, rules never fire (the banner says so).
 */
import { useState, useEffect, useMemo, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Bot, Loader2, Trash2, Plus, Power, Lightbulb, ChevronDown, MessageSquareReply, MessagesSquare, AlertTriangle, Pencil, X, Target } from "lucide-react"
import { channelLabel } from "@/lib/inbox-channels"
import {
  CHATBOT_CHANNEL_DISABLED_PREFIX, CHATBOT_TRIGGER_TYPES, CHATBOT_STATUSES,
  CHATBOT_CHANNELS, INBOX_QUALIFICATION_BOARD_PREFIX, INBOX_QUALIFICATION_FLAG,
  isChatbotChannelEnabled, triggerNeedsValue,
} from "@/lib/chatbot-engine"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

const ENABLE_FLAG = "chatbotAutoReply"
// Channels the auto-reply engine can actually SEND on (sendChannelReply). The rule's
// channel filter offers only these — offering email/sms would be a dead option.
// tiktok IS sendable: replies bridge out through Chatwoot (sendChannelReply "tiktok" case),
// and the chatwoot webhook runs the keyword engine for inbound TikTok DMs.
const SENDABLE_CHANNELS = CHATBOT_CHANNELS.filter((c) =>
  ["telegram", "whatsapp", "facebook", "instagram", "vkontakte", "tiktok"].includes(c),
)

interface Rule {
  id: string
  name: string
  status: string
  channelTypes: string[]
  triggerType: string
  triggerValue: string | null
  responseText: string
  priority: number
  matchCount: number
  createdAt: string
}
interface DivisionOption { id: string; name: string; key: string; isDepartment?: boolean; isActive?: boolean }

const STATUS_TINT: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  paused: "bg-muted text-foreground/60",
}

const TIP_KEYS = ["tip1", "tip2", "tip3"] as const

export default function ChatbotRulesPage() {
  const t = useTranslations("chatbotRules")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const headers = useMemo(
    () => (orgId ? { "x-organization-id": String(orgId), "Content-Type": "application/json" } : { "Content-Type": "application/json" }) as Record<string, string>,
    [orgId],
  )
  useAutoTour("chatbotRules")

  const [rules, setRules] = useState<Rule[]>([])
  const [enabled, setEnabled] = useState(false)
  const [features, setFeatures] = useState<string[]>([])
  const [divisions, setDivisions] = useState<DivisionOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [tipIdx, setTipIdx] = useState(0)

  // create form
  const [name, setName] = useState("")
  const [triggerType, setTriggerType] = useState<string>("contains")
  const [triggerValue, setTriggerValue] = useState("")
  const [responseText, setResponseText] = useState("")
  const [channelTypes, setChannelTypes] = useState<string[]>([])
  const [priority, setPriority] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rRes, fRes, dRes] = await Promise.all([
        fetch("/api/v1/inbox/chatbot-rules", { headers }),
        fetch("/api/v1/settings/ai-features", { headers }),
        fetch("/api/v1/divisions", { headers }),
      ])
      const rJson = await rRes.json()
      if (rJson.success) setRules(rJson.data || [])
      const fJson = await fRes.json()
      const feats: string[] = Array.isArray(fJson?.data?.features) ? fJson.data.features : []
      setFeatures(feats)
      setEnabled(feats.includes(ENABLE_FLAG))
      const dJson = await dRes.json().catch(() => null)
      setDivisions((dJson?.data?.divisions ?? []).filter(
        (division: DivisionOption) => division.isActive !== false && !division.isDepartment,
      ))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [headers])

  useEffect(() => { load() }, [load, session])

  const toggleMaster = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/v1/settings/ai-features", {
        method: "PATCH", headers,
        body: JSON.stringify({ feature: ENABLE_FLAG, action: enabled ? "remove" : "add" }),
      })
      const json = await res.json()
      const feats: string[] = Array.isArray(json?.data?.features) ? json.data.features : []
      setFeatures(feats)
      setEnabled(feats.includes(ENABLE_FLAG))
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  const canCreate = name.trim() && responseText.trim() && (!triggerNeedsValue(triggerType) || triggerValue.trim())

  const resetForm = () => {
    setName(""); setTriggerValue(""); setResponseText(""); setChannelTypes([])
    setPriority(0); setTriggerType("contains"); setEditingId(null)
  }

  const saveRule = async () => {
    if (!canCreate) return
    setBusy(true)
    try {
      const res = await fetch(editingId ? `/api/v1/inbox/chatbot-rules/${editingId}` : "/api/v1/inbox/chatbot-rules", {
        method: editingId ? "PATCH" : "POST", headers,
        body: JSON.stringify({
          name: name.trim(), ...(!editingId ? { status: "active" } : {}), channelTypes, triggerType,
          triggerValue: triggerNeedsValue(triggerType) ? triggerValue.trim() : null,
          responseText: responseText.trim(), priority,
        }),
      })
      if (res.ok) {
        resetForm()
        await load()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  const editRule = (rule: Rule) => {
    setEditingId(rule.id)
    setName(rule.name)
    setTriggerType(rule.triggerType)
    setTriggerValue(rule.triggerValue ?? "")
    setResponseText(rule.responseText)
    setChannelTypes(rule.channelTypes)
    setPriority(rule.priority)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const toggleAutoReplyChannel = async (channel: string) => {
    const currentlyEnabled = isChatbotChannelEnabled(features, channel)
    const feature = `${CHATBOT_CHANNEL_DISABLED_PREFIX}${channel}`
    setBusy(true)
    try {
      const res = await fetch("/api/v1/settings/ai-features", {
        method: "PATCH", headers,
        body: JSON.stringify({ feature, action: currentlyEnabled ? "add" : "remove" }),
      })
      const json = await res.json()
      setFeatures(Array.isArray(json?.data?.features) ? json.data.features : features)
    } finally {
      setBusy(false)
    }
  }

  const patchFeature = async (feature: string, action: "add" | "remove") => {
    const res = await fetch("/api/v1/settings/ai-features", {
      method: "PATCH", headers, body: JSON.stringify({ feature, action }),
    })
    const json = await res.json()
    const next = Array.isArray(json?.data?.features) ? json.data.features as string[] : features
    setFeatures(next)
    return next
  }

  const qualificationBoardFlag = features.find((feature) => feature.startsWith(INBOX_QUALIFICATION_BOARD_PREFIX))
  const selectedQualificationBoardId = qualificationBoardFlag?.slice(INBOX_QUALIFICATION_BOARD_PREFIX.length) ?? ""
  const qualificationEnabled = features.includes(INBOX_QUALIFICATION_FLAG)

  const selectQualificationBoard = async (boardId: string) => {
    setBusy(true)
    try {
      if (qualificationBoardFlag) await patchFeature(qualificationBoardFlag, "remove")
      if (boardId) await patchFeature(`${INBOX_QUALIFICATION_BOARD_PREFIX}${boardId}`, "add")
    } finally {
      setBusy(false)
    }
  }

  const toggleQualification = async () => {
    if (!qualificationEnabled && !selectedQualificationBoardId) return
    setBusy(true)
    try {
      await patchFeature(INBOX_QUALIFICATION_FLAG, qualificationEnabled ? "remove" : "add")
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (id: string, status: string) => {
    setBusy(true)
    try {
      await fetch(`/api/v1/inbox/chatbot-rules/${id}`, { method: "PATCH", headers, body: JSON.stringify({ status }) })
      await load()
    } catch (e) { console.error(e) } finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await fetch(`/api/v1/inbox/chatbot-rules/${id}`, { method: "DELETE", headers })
      await load()
    } catch (e) { console.error(e) } finally { setBusy(false) }
  }

  const toggleChannel = (ch: string) =>
    setChannelTypes((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]))

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Bot className="h-5 w-5" /> {t("title")}<HelpButton slug="chatbot-rules" variant="label" /></h1>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">{t("subtitle")}</p>
        </div>
        <TourReplayButton tourId="chatbotRules" />
      </header>

      {/* How it works — collapsible guide */}
      <div className="border rounded-lg bg-muted/30">
        <button
          onClick={() => setGuideOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium"
        >
          <span className="flex items-center gap-2"><MessagesSquare className="h-4 w-4 text-primary" /> {t("guideTitle")}</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", guideOpen && "rotate-180")} />
        </button>
        {guideOpen && (
          <div className="px-4 pb-4 space-y-2 text-[13px] text-muted-foreground border-t pt-3">
            <p>{t("guideIntro")}</p>
            <ol className="space-y-1.5 list-none">
              {["guideStep1", "guideStep2", "guideStep3", "guideStep4"].map((k, i) => (
                <li key={k} className="flex gap-2">
                  <span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold grid place-items-center">{i + 1}</span>
                  <span>{t(k)}</span>
                </li>
              ))}
            </ol>
            <div className="rounded-md bg-card border px-3 py-2 text-foreground/80 mt-2">
              <span className="font-medium">{t("exampleLabel")}: </span>{t("exampleBody")}
            </div>
          </div>
        )}
      </div>

      {/* Master enable */}
      <div data-tour-id="cb-master" className={cn("border rounded-lg p-4 flex items-center justify-between gap-3", enabled ? "bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/40" : "bg-card")}>
        <div className="flex items-center gap-3">
          <Power className={cn("h-5 w-5 shrink-0", enabled ? "text-emerald-600" : "text-muted-foreground")} />
          <div>
            <div className="text-sm font-medium">{enabled ? t("masterOnTitle") : t("masterOffTitle")}</div>
            <div className="text-[11px] text-muted-foreground">{enabled ? t("masterOnDesc") : t("masterOffDesc")}</div>
          </div>
        </div>
        <Button onClick={toggleMaster} disabled={busy} variant={enabled ? "outline" : "default"} size="sm">
          {enabled ? t("turnOff") : t("turnOn")}
        </Button>
      </div>

      {enabled && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">{t("channelSwitchesTitle")}</p>
            <p className="text-[11px] text-muted-foreground">{t("channelSwitchesHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SENDABLE_CHANNELS.map((channel) => {
              const channelEnabled = isChatbotChannelEnabled(features, channel)
              return (
                <button
                  key={channel}
                  type="button"
                  disabled={busy}
                  onClick={() => toggleAutoReplyChannel(channel)}
                  aria-pressed={channelEnabled}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                    channelEnabled
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : "text-muted-foreground",
                  )}
                >
                  {channelLabel(channel)} · {channelEnabled ? t("channelOn") : t("channelOff")}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Target className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
          <div className="flex-1">
            <p className="text-sm font-medium">{t("qualificationTitle")}</p>
            <p className="text-[11px] text-muted-foreground">{t("qualificationHint")}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={qualificationEnabled ? "outline" : "default"}
            disabled={busy || (!qualificationEnabled && !selectedQualificationBoardId)}
            onClick={toggleQualification}
          >
            {qualificationEnabled ? t("turnOff") : t("turnOn")}
          </Button>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("qualificationBoardLabel")}</span>
          <select
            value={selectedQualificationBoardId}
            onChange={(event) => selectQualificationBoard(event.target.value)}
            disabled={busy || qualificationEnabled}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{t("qualificationBoardPlaceholder")}</option>
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>{division.key} — {division.name}</option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-muted-foreground">{t("qualificationRulesHint")}</p>
      </div>

      {/* Create form — sentence-style */}
      <div data-tour-id="cb-form" className="border rounded-lg bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold flex items-center gap-1.5">
              {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingId ? t("editRule") : t("newRule")}
            </div>
            {editingId && (
              <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" /> {t("cancelEdit")}
              </button>
            )}
          </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("nameLabel")}</label>
          <Input placeholder={t("namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
        </div>

        {/* WHEN */}
        <div data-tour-id="cb-trigger" className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><MessagesSquare className="h-3.5 w-3.5" /> {t("whenLabel")}</label>
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <span className="text-muted-foreground">{t("whenPrefix")}</span>
            <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm font-medium">
              {CHATBOT_TRIGGER_TYPES.map((tt) => <option key={tt} value={tt}>{t(`trigger_${tt}`)}</option>)}
            </select>
            {triggerNeedsValue(triggerType) && (
              <Input
                placeholder={t(triggerType === "contains" ? "keywordsPlaceholder" : "textPlaceholder")}
                value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} className="h-9 text-sm flex-1 min-w-[200px]"
              />
            )}
          </div>
          {triggerType === "contains" && <p className="text-[11px] text-muted-foreground">{t("keywordsHint")}</p>}
        </div>

        {/* REPLY */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><MessageSquareReply className="h-3.5 w-3.5" /> {t("replyLabel")}</label>
          <textarea
            placeholder={t("replyPlaceholder")} value={responseText} onChange={(e) => setResponseText(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[64px]"
          />
        </div>

        {/* CHANNELS */}
        <div data-tour-id="cb-channels" className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("channelsLabel")}</label>
          <div className="flex flex-wrap items-center gap-2">
            {SENDABLE_CHANNELS.map((ch) => (
              <button
                key={ch} onClick={() => toggleChannel(ch)} type="button"
                className={cn("px-2.5 py-1 rounded-full text-[11px] border transition-colors",
                  channelTypes.includes(ch) ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:bg-muted")}
              >
                {channelLabel(ch)}
              </button>
            ))}
            <span className="text-[11px] text-muted-foreground">{channelTypes.length === 0 ? t("channelsAll") : ""}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">{t("priorityLabel")}</label>
            <Input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)} className="h-8 w-16 text-sm" title={t("priorityHint")} />
          </div>
          <Button onClick={saveRule} disabled={busy || !canCreate} size="sm">
            {editingId ? t("saveRule") : t("createRule")}
          </Button>
        </div>
      </div>

      {/* Did you know */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-900/10 px-4 py-2.5">
        <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 text-[12px] text-amber-900/80 dark:text-amber-200/80">
          <span className="font-semibold">{t("didYouKnow")}</span> {t(TIP_KEYS[tipIdx])}
        </div>
        <button onClick={() => setTipIdx((i) => (i + 1) % TIP_KEYS.length)} className="text-[11px] text-amber-700/70 hover:text-amber-700 shrink-0">
          {t("nextTip")} →
        </button>
      </div>

      {/* Rules list */}
      <div data-tour-id="cb-rules" className="border rounded-lg bg-card">
        <div className="px-4 py-3 border-b text-sm font-semibold">{t("rulesTitle")} ({rules.length})</div>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rules.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground/60">{t("noRules")}</div>
        ) : (
          <div className="divide-y">
            {rules.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_TINT[r.status] ?? "bg-muted")}>{t(`status_${r.status}`)}</span>
                    {r.priority !== 0 && <span className="text-[10px] text-muted-foreground">{t("priorityShort")}{r.priority}</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    <span>{t(`trigger_${r.triggerType}`)}{r.triggerValue ? ` "${r.triggerValue}"` : ""}</span>
                    {" → "}{r.responseText.slice(0, 60)}{r.responseText.length > 60 ? "…" : ""}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                    {r.channelTypes.length ? r.channelTypes.map(channelLabel).join(", ") : t("channelsAll")} · {t("matchedCount", { count: r.matchCount })}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => editRule(r)} disabled={busy} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title={t("editRule")}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <select
                    value={r.status} onChange={(e) => setStatus(r.id, e.target.value)} disabled={busy}
                    className="h-7 rounded-md border bg-background px-1.5 text-[11px]"
                  >
                    {CHATBOT_STATUSES.map((s) => <option key={s} value={s}>{t(`status_${s}`)}</option>)}
                  </select>
                  <button onClick={() => remove(r.id)} disabled={busy} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-600" title={t("delete")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active rules exist but master is OFF — actionable nudge for the non-technical user. */}
      {!enabled && rules.some((r) => r.status === "active") && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/15 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <span className="text-[12px] text-amber-900/85 dark:text-amber-200/85">{t("masterOffWarning")}</span>
        </div>
      )}
    </div>
  )
}
