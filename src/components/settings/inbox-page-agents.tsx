"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Building2, Check, Copy, Loader2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/**
 * «ИИ-агент»: one agent per page (owner 2026-11-13, by the approved mock-up). The list on the left
 * is «Общий» plus every page the inbox AI answers on; the right side is the agent of whatever is
 * picked. «Общий» shows the organisation's editor that was here before (`children`); a page shows
 * its own switch, schedule, hours and — when it has one — its own agent.
 *
 * A page without an agent of its own is answered by the common one; nothing here changes that
 * until «Создать на основе общего» is pressed and saved.
 */

type AgentFields = { systemPrompt: string; knowledgeBase: string; greeting: string; replyLanguage: "az" | "ru" | "en" | null }
type Interval = { start: string; end: string }
type Day = { enabled: boolean; intervals: Interval[] }
type Schedule = Partial<Record<string, Day>>
type Hours = { timezone: string; schedule: Schedule }
type AiSchedule = "always" | "inside_hours" | "outside_hours"
type PageRow = {
  channelConfigId: string
  channelType: string
  name: string
  isActive: boolean
  aiOn: boolean
  replyHeld?: boolean
  aiSchedule: AiSchedule
  agent: AgentFields | null
  hours: Hours | null
}

const COMMON = "__common__"
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", telegram: "Telegram", vkontakte: "VKontakte", chatwoot: "TikTok",
}
const EMPTY_AGENT: AgentFields = { systemPrompt: "", knowledgeBase: "", greeting: "", replyLanguage: null }

function defaultHours(timezone: string): Hours {
  const schedule: Schedule = {}
  for (const day of DAYS) {
    schedule[day] = { enabled: day !== "sat" && day !== "sun", intervals: [{ start: "09:00", end: "18:00" }] }
  }
  return { timezone, schedule }
}

export function InboxPageAgents({ children, onReplyModeChanged }: {
  /** The organisation's own editor, shown while «Общий» is picked. */
  children: ReactNode
  /** The reply matrix on the same screen shows the same switch; it reloads when this fires. */
  onReplyModeChanged?: () => void
}) {
  const t = useTranslations("settings")
  const [pages, setPages] = useState<PageRow[]>([])
  const [commonAgent, setCommonAgent] = useState<AgentFields | null>(null)
  const [defaultTimezone, setDefaultTimezone] = useState("Asia/Baku")
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>(COMMON)
  // The page being edited, as it is on screen. Nothing is sent until «Сохранить».
  const [draft, setDraft] = useState<PageRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/settings/inbox-page-agents")
      if (!res.ok) return
      const json = await res.json()
      setPages(json.data?.pages ?? [])
      setCommonAgent(json.data?.commonAgent ?? null)
      setDefaultTimezone(json.data?.defaultTimezone ?? "Asia/Baku")
    } catch {
      // The list stays as it was; the common editor below still works.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const panelRef = useRef<HTMLDivElement>(null)

  const pick = (key: string) => {
    setSelected(key)
    setSavedAt(0)
    // The list is long: a row picked near its end leaves the panel above the screen. Bring the
    // panel's top back, but only when it is actually out of sight — a click on a row beside a
    // visible panel must not move the page.
    requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const top = panel.getBoundingClientRect().top
      if (top < 0 || top > window.innerHeight * 0.6) panel.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    const page = pages.find((p) => p.channelConfigId === key)
    setDraft(page ? { ...page, agent: page.agent ? { ...page.agent } : null, hours: page.hours ? structuredClone(page.hours) : null } : null)
  }

  const save = async () => {
    if (!draft) return
    const original = pages.find((p) => p.channelConfigId === draft.channelConfigId)
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/settings/inbox-page-agents/${encodeURIComponent(draft.channelConfigId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: draft.agent, aiOn: draft.aiOn, aiSchedule: draft.aiSchedule, hours: draft.hours }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        toast.error(json?.error || t("pageAgentSaveFailed"))
        return
      }
      setPages((rows) => rows.map((row) => (row.channelConfigId === draft.channelConfigId ? draft : row)))
      setSavedAt(Date.now())
      if (original && original.aiOn !== draft.aiOn) onReplyModeChanged?.()
    } catch {
      toast.error(t("pageAgentSaveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const patchAgent = (patch: Partial<AgentFields>) =>
    setDraft((d) => (d && d.agent ? { ...d, agent: { ...d.agent, ...patch } } : d))
  const patchDay = (day: string, patch: Partial<Day>) =>
    setDraft((d) => {
      if (!d?.hours) return d
      const current = d.hours.schedule[day] ?? { enabled: false, intervals: [{ start: "09:00", end: "18:00" }] }
      return { ...d, hours: { ...d.hours, schedule: { ...d.hours.schedule, [day]: { ...current, ...patch } } } }
    })

  const groups = pages.reduce<Record<string, PageRow[]>>((acc, page) => {
    ;(acc[page.channelType] ??= []).push(page)
    return acc
  }, {})

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]" data-testid="inbox-page-agents">
      <div className="rounded-lg border bg-card p-2 self-start">
        <p className="px-2 pb-1 pt-1 text-xs text-muted-foreground">{t("pageAgentListTitle")}</p>
        <button
          type="button"
          onClick={() => pick(COMMON)}
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left", selected === COMMON ? "bg-primary/10" : "hover:bg-muted")}
        >
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t("pageAgentCommon")}</span>
            <span className="block text-xs text-muted-foreground">{t("pageAgentCommonHint")}</span>
          </span>
        </button>
        {loading && <p className="px-2 py-2 text-xs text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin" /></p>}
        {Object.entries(groups).map(([type, rows]) => (
          <div key={type}>
            <p className="px-2 pb-1 pt-3 text-xs text-muted-foreground">{PLATFORM_LABEL[type] ?? type}</p>
            {rows.map((page) => (
              <button
                key={page.channelConfigId}
                type="button"
                onClick={() => pick(page.channelConfigId)}
                data-testid={`page-agent-row-${page.channelConfigId}`}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left", selected === page.channelConfigId ? "bg-primary/10" : "hover:bg-muted")}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{page.name}</span>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px]", page.agent ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground")}>
                  {page.agent ? t("pageAgentOwn") : t("pageAgentUsesCommon")}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div ref={panelRef} className="min-w-0 scroll-mt-20">
        {selected === COMMON || !draft ? children : (
          <div className="space-y-5 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-semibold">{t("pageAgentTitle", { name: draft.name })}</h2>
              <p className="text-sm text-muted-foreground">{t("pageAgentSubtitle")}</p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <Label className="font-medium">{t("pageAgentAiOn")}</Label>
                <p className="text-xs text-muted-foreground">{draft.aiOn ? t("pageAgentAiOnHint") : t("pageAgentAiOffHint")}</p>
              </div>
              <Switch checked={draft.aiOn} onCheckedChange={(aiOn) => setDraft({ ...draft, aiOn })} />
            </div>

            {draft.replyHeld && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                {t("pageAgentReplyHeld")}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>{t("pageAgentSchedule")}</Label>
                <Select value={draft.aiSchedule} onChange={(e) => setDraft({ ...draft, aiSchedule: e.target.value as AiSchedule })}>
                  <option value="always">{t("pageAgentScheduleAlways")}</option>
                  <option value="inside_hours">{t("pageAgentScheduleInside")}</option>
                  <option value="outside_hours">{t("pageAgentScheduleOutside")}</option>
                </Select>
              </div>
              <div>
                <Label>{t("pageAgentHours")}</Label>
                <Select
                  value={draft.hours ? "own" : "inherit"}
                  onChange={(e) => setDraft({ ...draft, hours: e.target.value === "own" ? (draft.hours ?? defaultHours(defaultTimezone)) : null })}
                >
                  <option value="inherit">{t("pageAgentHoursInherit")}</option>
                  <option value="own">{t("pageAgentHoursOwn")}</option>
                </Select>
              </div>
            </div>

            {draft.hours && (
              <div className="space-y-1.5 rounded-md border p-3">
                {DAYS.map((day) => {
                  const value = draft.hours?.schedule[day] ?? { enabled: false, intervals: [{ start: "09:00", end: "18:00" }] }
                  const interval = value.intervals[0] ?? { start: "09:00", end: "18:00" }
                  return (
                    <div key={day} className="flex items-center gap-3">
                      <label className="flex w-28 items-center gap-2 text-sm">
                        <input type="checkbox" checked={value.enabled} onChange={(e) => patchDay(day, { enabled: e.target.checked })} />
                        {t(`pageAgentDay_${day}`)}
                      </label>
                      <Input type="time" className="w-28" disabled={!value.enabled} value={interval.start}
                        onChange={(e) => patchDay(day, { intervals: [{ ...interval, start: e.target.value }] })} />
                      <span className="text-muted-foreground">—</span>
                      <Input type="time" className="w-28" disabled={!value.enabled} value={interval.end}
                        onChange={(e) => patchDay(day, { intervals: [{ ...interval, end: e.target.value }] })} />
                    </div>
                  )
                })}
                <p className="pt-1 text-xs text-muted-foreground">{t("pageAgentTimezone", { timezone: draft.hours.timezone })}</p>
              </div>
            )}

            {draft.agent ? (
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{t("pageAgentOwnTitle")}</h3>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setDraft({ ...draft, agent: null })}>
                    <Undo2 className="h-4 w-4" /> {t("pageAgentBackToCommon")}
                  </Button>
                </div>
                <div>
                  <Label>{t("fieldPrompt")}</Label>
                  <Textarea rows={5} value={draft.agent.systemPrompt} onChange={(e) => patchAgent({ systemPrompt: e.target.value })} />
                </div>
                <div>
                  <Label>{t("fieldKnowledge")}</Label>
                  <Textarea rows={6} value={draft.agent.knowledgeBase} onChange={(e) => patchAgent({ knowledgeBase: e.target.value })} />
                  <p className="mt-1 text-xs text-muted-foreground">{t("fieldKnowledgeHelp")}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>{t("fieldReplyLanguage")}</Label>
                    <Select value={draft.agent.replyLanguage ?? ""} onChange={(e) => patchAgent({ replyLanguage: (e.target.value || null) as AgentFields["replyLanguage"] })}>
                      <option value="">{t("replyLanguageAuto")}</option>
                      <option value="az">{t("replyLanguageAz")}</option>
                      <option value="ru">{t("replyLanguageRu")}</option>
                      <option value="en">{t("replyLanguageEn")}</option>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("fieldGreeting")}</Label>
                    <Input value={draft.agent.greeting} onChange={(e) => patchAgent({ greeting: e.target.value })} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-5 text-center">
                <p className="font-medium">{t("pageAgentNoneTitle")}</p>
                <p className="mb-3 mt-1 text-sm text-muted-foreground">{t("pageAgentNoneHint")}</p>
                <Button type="button" variant="outline" className="gap-1.5" onClick={() => setDraft({ ...draft, agent: { ...(commonAgent ?? EMPTY_AGENT) } })}>
                  <Copy className="h-4 w-4" /> {t("pageAgentCreateFromCommon")}
                </Button>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="button" onClick={save} disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("saveBtn")}
              </Button>
              {savedAt > 0 && <span className="flex items-center gap-1 text-sm text-emerald-600"><Check className="h-4 w-4" /> {t("saved")}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
