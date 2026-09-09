"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { HelpButton } from "@/components/help/help-button"
import { Input } from "@/components/ui/input"
import {
  Plus, Search, Pencil, Trash2, Play, Pause, Mail, Phone, CheckSquare,
  ChevronDown, ChevronUp, ChevronRight, Users, Zap, Check, PhoneOff, SkipForward, UserPlus, Ban, Clock, MessageSquare, MessageCircle,
  BarChart3, Trophy,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { canManageSequenceSettings } from "@/lib/sequence-settings-access"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SequenceStep {
  id: string
  stepOrder: number
  type: "email" | "call" | "task" | "sms" | "whatsapp"
  delayDays: number
  subject: string | null
  body: string | null
  isActive: boolean
  /** E1 — email steps only: ride the enrollment's thread or start a new one */
  threadMode?: "continue" | "new"
}

interface SalesSequence {
  id: string
  name: string
  description: string | null
  isActive: boolean
  exitOnReply: boolean
  replyReaction?: "stop" | "pause" | "continue" | null
  exitOnMeeting: boolean
  exitOnDealClosed: boolean
  autoEnrollSources: string[]
  workdaysOnly: boolean
  createdAt: string
  steps: SequenceStep[]
  _count: { enrollments: number }
}

interface SequenceAnalytics {
  sequenceId: string
  total: number
  replied: number
  replyRate: number
  meetings: number
  avgTouchesToReply: number | null
}

interface OrgAnalytics {
  activeEnrollments: number
  total: number
  replied: number
  replyRate: number
  meetings: number
  avgTouchesToReply: number | null
}

interface FunnelStep {
  stepOrder: number
  type: string
  subject: string | null
  reached: number
  activeHere?: number
}
interface FunnelSequence {
  sequenceId: string
  name: string
  entered: number
  steps: FunnelStep[]
}
interface LeaderboardRow {
  ownerId: string | null
  ownerName: string | null
  total: number
  replied: number
  meetings: number
  replyRate: number
}

interface TouchItem {
  enrollmentId: string
  entityType: "lead" | "contact"
  entityId: string
  entityName: string
  entityCompany: string | null
  entityPhone: string | null
  entityEmail: string | null
  entityHref: string
  sequenceId: string
  sequenceName: string
  stepNumber: number
  stepCount: number
  stepType: "email" | "call" | "task" | "sms" | "whatsapp"
  stepSubject: string | null
  stepBody: string | null
  dueAt: string | null
  overdue: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const stepTypeIcon = (type: string) => {
  if (type === "email") return <Mail className="h-3.5 w-3.5 text-blue-500" />
  if (type === "call") return <Phone className="h-3.5 w-3.5 text-green-500" />
  if (type === "sms") return <MessageSquare className="h-3.5 w-3.5 text-teal-500" />
  if (type === "whatsapp") return <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
  return <CheckSquare className="h-3.5 w-3.5 text-purple-500" />
}

const STEP_TYPES = ["email", "call", "sms", "whatsapp", "task"] as const

// ─── Touch Queue (the manager's "touches today") ─────────────────────────────

const touchIconClasses = {
  email: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  call: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  sms: "bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400",
  whatsapp: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
  task: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
} as const

interface DailyLimit {
  limit: number | null
  sentToday: number
  remaining: number | null
  reached: boolean
  singleActiveEnrollment?: boolean
}

function TouchQueue({ reloadToken, onChanged }: { reloadToken: number; onChanged: () => void }) {
  const t = useTranslations("sequencesPage")
  const { data: session } = useSession()
  const role = session?.user?.role
  const isManager = canManageSequenceSettings(role)
  const [touches, setTouches] = useState<TouchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [composerTouch, setComposerTouch] = useState<TouchItem | null>(null)
  const [limit, setLimit] = useState<DailyLimit | null>(null)
  const [editingLimit, setEditingLimit] = useState(false)
  const [limitInput, setLimitInput] = useState("")

  const fetchLimit = async () => {
    try {
      const res = await fetch("/api/v1/sequences/settings")
      const data = await res.json()
      if (data.success) setLimit(data.data)
    } catch { /* non-critical banner */ }
  }
  useEffect(() => { fetchLimit() }, [reloadToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveLimit = async (value: number | null) => {
    try {
      const res = await fetch("/api/v1/sequences/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyEmailLimit: value }),
      })
      const data = await res.json()
      if (data.success) { setLimit(data.data); setEditingLimit(false) }
      else setError(data.error ?? t("touches.actionFailed"))
    } catch {
      setError(t("touches.actionFailed"))
    }
  }

  // E6 — toggle single-active-enrollment policy.
  const toggleSingleActive = async (value: boolean) => {
    try {
      const res = await fetch("/api/v1/sequences/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ singleActiveEnrollment: value }),
      })
      const data = await res.json()
      if (data.success) setLimit(data.data)
      else setError(data.error ?? t("touches.actionFailed"))
    } catch {
      setError(t("touches.actionFailed"))
    }
  }
  // Monotonic fetch id: a slow older response must not overwrite a newer queue
  // snapshot (complete() refetches can race each other).
  const fetchSeq = useRef(0)

  const fetchTouches = async () => {
    const seq = ++fetchSeq.current
    try {
      const tzOffset = new Date().getTimezoneOffset()
      const res = await fetch(`/api/v1/sequences/touches?owner=me&tzOffset=${tzOffset}`)
      const data = await res.json()
      if (seq !== fetchSeq.current) return // a newer fetch already landed
      if (!res.ok || !data.success) {
        setError(data.error ?? t("touches.loadFailed"))
        return
      }
      setError("")
      setTouches(data.data.touches)
    } catch {
      if (seq === fetchSeq.current) setError(t("touches.loadFailed"))
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }

  useEffect(() => { fetchTouches() }, [reloadToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const complete = async (touch: TouchItem, outcome: "done" | "no_answer" | "skipped" | "opt_out") => {
    setBusyId(touch.enrollmentId)
    setError("")
    try {
      const res = await fetch(`/api/v1/sequences/enrollments/${touch.enrollmentId}/complete-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? t("touches.actionFailed"))
        // 409 = the runner or another user already advanced this touch — the
        // queue on screen is stale either way, refresh it.
        if (res.status === 409) await fetchTouches()
        return
      }
      await fetchTouches()
      onChanged()
    } catch {
      setError(t("touches.actionFailed"))
    } finally {
      setBusyId(null)
    }
  }

  const snooze = async (touch: TouchItem) => {
    setBusyId(touch.enrollmentId)
    setError("")
    try {
      const res = await fetch(`/api/v1/sequences/${touch.sequenceId}/enrollments/${touch.enrollmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snoozeDays: 1 }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? t("touches.actionFailed"))
        if (res.status === 409) await fetchTouches()
        return
      }
      await fetchTouches()
      onChanged()
    } catch {
      setError(t("touches.actionFailed"))
    } finally {
      setBusyId(null)
    }
  }

  const overdueCount = touches.filter((touch) => touch.overdue).length

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b">
        <h2 className="font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          {t("touches.title")}
          {touches.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">
              {touches.length}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          {overdueCount > 0 && (
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              {t("touches.overdueCount", { count: overdueCount })}
            </span>
          )}
          {/* E4 — daily send-limit banner + inline editor (managers/admins) */}
          {editingLimit ? (
            <span className="flex items-center gap-1.5 text-xs">
              <input
                type="number"
                min={1}
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                placeholder={t("dailyLimit.placeholder")}
                className="w-20 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-background"
              />
              <button
                onClick={() => {
                  const raw = limitInput.trim()
                  if (!raw) { saveLimit(null); return } // empty → clear the cap
                  const n = Number(raw)
                  // Reject garbage instead of letting NaN serialize to null (which would silently unlimit).
                  if (!Number.isFinite(n) || n < 1) { setError(t("dailyLimit.invalid")); return }
                  saveLimit(Math.floor(n))
                }}
                className="text-primary font-medium"
              >{t("dailyLimit.save")}</button>
              <button onClick={() => setEditingLimit(false)} className="text-muted-foreground">✕</button>
            </span>
          ) : (
            <button
              onClick={() => { if (isManager) { setLimitInput(limit?.limit ? String(limit.limit) : ""); setEditingLimit(true) } }}
              disabled={!isManager}
              className={cn(
                "text-xs px-2 py-0.5 rounded-full font-medium",
                limit?.reached ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : limit?.limit ? "bg-muted text-muted-foreground"
                  : "text-muted-foreground/70",
                isManager && "hover:bg-muted",
              )}
              title={t("dailyLimit.hint")}
            >
              {limit?.limit
                ? t("dailyLimit.usage", { sent: limit.sentToday, limit: limit.limit })
                : t("dailyLimit.unlimited")}
            </button>
          )}
          {/* E6 — single active enrollment per person (managers/admins) */}
          {isManager && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title={t("singleActive.hint")}>
              <input
                type="checkbox"
                checked={!!limit?.singleActiveEnrollment}
                onChange={(e) => toggleSingleActive(e.target.checked)}
                className="rounded"
              />
              {t("singleActive.label")}
            </label>
          )}
        </div>
      </div>
      {limit?.reached && (
        <p className="px-5 py-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 border-b">
          {t("dailyLimit.reachedBanner")}
        </p>
      )}
      {error && <p className="px-5 py-2 text-sm text-destructive border-b">{error}</p>}
      {loading ? (
        <p className="px-5 py-6 text-sm text-muted-foreground text-center">{t("loading")}</p>
      ) : touches.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground text-center">{t("touches.empty")}</p>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {touches.map((touch) => (
            <div key={touch.enrollmentId} className="flex items-center gap-3 px-5 py-3">
              <div className={cn("h-8 w-8 rounded-lg grid place-items-center shrink-0", touchIconClasses[touch.stepType])}>
                {touch.stepType === "email" ? <Mail className="h-4 w-4" />
                  : touch.stepType === "call" ? <Phone className="h-4 w-4" />
                  : touch.stepType === "sms" ? <MessageSquare className="h-4 w-4" />
                  : touch.stepType === "whatsapp" ? <MessageCircle className="h-4 w-4" />
                  : <CheckSquare className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {/* Name links to the person's record so the manager works the touch without hunting. */}
                  <a href={touch.entityHref} className="hover:text-primary hover:underline">{touch.entityName}</a>
                  {touch.entityCompany && <span className="text-muted-foreground font-normal"> · {touch.entityCompany}</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {touch.sequenceName} · {t("touches.stepOf", { current: touch.stepNumber, total: touch.stepCount })}
                  {touch.stepSubject && <> — {touch.stepSubject}</>}
                </p>
                {/* Contact affordance: one-tap channel action so the manager never
                    hunts for the number. call→tel, sms→sms:, whatsapp→wa.me, email→mailto. */}
                {(() => {
                  const needsPhone = touch.stepType === "call" || touch.stepType === "sms" || touch.stepType === "whatsapp"
                  const needsEmail = touch.stepType === "email"
                  if (needsPhone && touch.entityPhone) {
                    const p = touch.entityPhone
                    const href = touch.stepType === "sms" ? `sms:${p}` : touch.stepType === "whatsapp" ? `https://wa.me/${p.replace(/[^\d]/g, "")}` : `tel:${p}`
                    const cls = touch.stepType === "sms" ? "text-teal-700 dark:text-teal-400" : touch.stepType === "whatsapp" ? "text-emerald-700 dark:text-emerald-400" : "text-green-700 dark:text-green-400"
                    const Icon = touch.stepType === "sms" ? MessageSquare : touch.stepType === "whatsapp" ? MessageCircle : Phone
                    return (
                      <p className="text-xs mt-0.5">
                        <a href={href} target={touch.stepType === "whatsapp" ? "_blank" : undefined} rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 hover:underline", cls)}>
                          <Icon className="h-3 w-3" /> {p}
                        </a>
                      </p>
                    )
                  }
                  if (needsEmail && touch.entityEmail) {
                    return (
                      <p className="text-xs mt-0.5">
                        <a href={`mailto:${touch.entityEmail}`} className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:underline">
                          <Mail className="h-3 w-3" /> {touch.entityEmail}
                        </a>
                      </p>
                    )
                  }
                  if (needsPhone || needsEmail) {
                    return <p className="text-xs mt-0.5 text-muted-foreground italic">{t("touches.noContact")}</p>
                  }
                  return null
                })()}
              </div>
              <span
                className={cn(
                  "text-xs font-medium shrink-0",
                  touch.overdue ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
                )}
              >
                {touch.overdue ? t("touches.overdue") : t("touches.dueToday")}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {touch.stepType === "email" ? (
                  <Button size="sm" disabled={busyId === touch.enrollmentId} onClick={() => setComposerTouch(touch)}>
                    <Mail className="h-3.5 w-3.5 mr-1" /> {t("touches.compose")}
                  </Button>
                ) : (
                  <Button size="sm" disabled={busyId === touch.enrollmentId} onClick={() => complete(touch, "done")}>
                    <Check className="h-3.5 w-3.5 mr-1" /> {t("touches.markDone")}
                  </Button>
                )}
                {touch.stepType === "call" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === touch.enrollmentId}
                    onClick={() => complete(touch, "no_answer")}
                    title={t("touches.noAnswer")}
                  >
                    <PhoneOff className="h-3.5 w-3.5" />
                  </Button>
                )}
                {/* E3 — «не звоните/не пишите мне больше»: suppress + stop */}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === touch.enrollmentId}
                  onClick={() => complete(touch, "opt_out")}
                  title={t("touches.optOut")}
                  className="text-destructive hover:text-destructive"
                >
                  <Ban className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === touch.enrollmentId}
                  onClick={() => snooze(touch)}
                  title={t("touches.snooze")}
                >
                  <Clock className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === touch.enrollmentId}
                  onClick={() => complete(touch, "skipped")}
                  title={t("touches.skip")}
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {composerTouch && (
        <EmailComposer
          touch={composerTouch}
          onClose={() => setComposerTouch(null)}
          onSent={() => { setComposerTouch(null); fetchTouches(); fetchLimit(); onChanged() }}
          onMarkSent={async () => { const t2 = composerTouch; setComposerTouch(null); if (t2) await complete(t2, "done") }}
        />
      )}
    </div>
  )
}

// ─── Email composer (email step actually sends via the org's SMTP/Resend) ────

/** Fill {{contact_name}} / {{company_name}} etc. from the touch, client-side. */
function fillVars(text: string, touch: TouchItem): string {
  const first = touch.entityName.split(/\s+/)[0] ?? touch.entityName
  const map: Record<string, string> = {
    contact_name: touch.entityName,
    recipient_name: touch.entityName,
    first_name: first,
    company_name: touch.entityCompany ?? "",
    company: touch.entityCompany ?? "",
    email: touch.entityEmail ?? "",
  }
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in map ? map[k] : m))
}

function EmailComposer({ touch, onClose, onSent, onMarkSent }: {
  touch: TouchItem
  onClose: () => void
  onSent: () => void
  onMarkSent: () => void
}) {
  const t = useTranslations("sequencesPage")
  const [subject, setSubject] = useState(fillVars(touch.stepSubject ?? "", touch))
  const [body, setBody] = useState(fillVars(touch.stepBody ?? "", touch))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [smtpDown, setSmtpDown] = useState(false)

  const send = async () => {
    if (!touch.entityEmail) { setError(t("composer.noEmail")); return }
    setSending(true)
    setError("")
    try {
      const res = await fetch(`/api/v1/sequences/enrollments/${touch.enrollmentId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The textarea is plain text; send as simple HTML (newlines → <br>).
        body: JSON.stringify({ subject, body: body.replace(/\n/g, "<br>") }),
      })
      if (res.ok) { onSent(); return }
      const b = await res.json().catch(() => ({}))
      if (res.status === 502) setSmtpDown(true) // mail not configured / failed — offer manual fallback
      if (res.status === 429 && b.limitReached) { setError(t("dailyLimit.reachedBanner")); return }
      setError(b.error ?? t("composer.sendFailed"))
    } catch {
      setError(t("composer.sendFailed"))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">{t("composer.title", { name: touch.entityName })}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3 flex-1 overflow-y-auto">
          <div className="text-xs text-muted-foreground">
            {t("composer.to")}: <span className="font-medium text-foreground">{touch.entityEmail ?? "—"}</span>
          </div>
          {!touch.entityEmail && <p className="text-sm text-destructive">{t("composer.noEmail")}</p>}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">{t("composer.subject")}</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">{t("composer.body")}</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-md px-3 py-2 bg-background resize-y"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {smtpDown && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              {t("composer.smtpDown")}
              <div className="mt-2 flex gap-2">
                <a
                  href={`mailto:${touch.entityEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
                  className="underline font-medium"
                >
                  {t("composer.openMailClient")}
                </a>
                <button onClick={onMarkSent} className="underline font-medium">{t("composer.markSent")}</button>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={sending}>{t("form.cancel")}</Button>
          <Button onClick={send} disabled={sending || !touch.entityEmail}>
            {sending ? t("composer.sending") : t("composer.send")}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Participants tab (who is in this sequence, and where) ───────────────────

interface Participant {
  id: string
  entityType: "lead" | "contact"
  entityName: string | null
  entityCompany: string | null
  entityHref: string
  ownerName: string | null
  stepNumber: number
  stepCount: number
  status: string
  nextStepAt: string | null
  lastOutcome: string | null
  exitReason: string | null
  replied: boolean
  meetingBooked: boolean
}

const partStatusClasses: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  stopped: "bg-muted text-muted-foreground",
}

function ParticipantsTab({ sequenceId }: { sequenceId: string }) {
  const t = useTranslations("sequencesPage")
  const [rows, setRows] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("") // "" = all
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const q = filter ? `?status=${filter}` : ""
      const res = await fetch(`/api/v1/sequences/${sequenceId}/enrollments${q}`)
      const data = await res.json()
      if (res.ok && data.success) setRows(data.data)
    } catch {
      // participants are read-only decoration on the card; leave empty on failure
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [sequenceId, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (p: Participant, status: string) => {
    setBusyId(p.id)
    try {
      const res = await fetch(`/api/v1/sequences/${sequenceId}/enrollments/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (res.ok) await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="border-t bg-muted/20">
      <div className="flex items-center gap-1.5 px-5 py-2.5 flex-wrap">
        {["", "active", "paused", "completed", "stopped"].map((s) => (
          <button
            key={s || "all"}
            onClick={() => setFilter(s)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full font-medium",
              filter === s ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground border border-zinc-200 dark:border-zinc-700"
            )}
          >
            {s ? t(`participants.status.${s}` as never) : t("participants.all")}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="px-5 py-4 text-sm text-muted-foreground text-center">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground text-center">{t("participants.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left font-medium px-5 py-2">{t("participants.who")}</th>
                <th className="text-left font-medium px-3 py-2">{t("participants.step")}</th>
                <th className="text-left font-medium px-3 py-2">{t("participants.owner")}</th>
                <th className="text-left font-medium px-3 py-2">{t("participants.statusCol")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-5 py-2">
                    <a href={p.entityHref} className="font-medium hover:text-primary hover:underline">{p.entityName ?? "—"}</a>
                    {p.entityCompany && <span className="text-muted-foreground text-xs"> · {p.entityCompany}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{p.stepNumber}/{p.stepCount}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{p.ownerName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", partStatusClasses[p.status] ?? "")}>
                      {t(`participants.status.${p.status}` as never)}
                    </span>
                    {p.replied && <span className="ml-1 text-xs text-green-600 dark:text-green-400">💬</span>}
                    {p.meetingBooked && <span className="ml-1 text-xs">📅</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {p.status === "active" && (
                      <button disabled={busyId === p.id} onClick={() => setStatus(p, "paused")} title={t("participants.pause")} className="text-muted-foreground hover:text-foreground p-1">
                        <Pause className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {p.status === "paused" && (
                      <button disabled={busyId === p.id} onClick={() => setStatus(p, "active")} title={t("participants.resume")} className="text-muted-foreground hover:text-foreground p-1">
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {(p.status === "active" || p.status === "paused") && (
                      <button disabled={busyId === p.id} onClick={() => setStatus(p, "stopped")} title={t("participants.stop")} className="text-muted-foreground hover:text-destructive p-1">
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Expanded card body: Steps | Participants tabs ───────────────────────────

function SequenceExpanded({ seq }: { seq: SalesSequence }) {
  const t = useTranslations("sequencesPage")
  const [tab, setTab] = useState<"steps" | "participants">("steps")

  return (
    <div className="border-t">
      <div className="flex items-center gap-4 px-5 pt-2.5 text-sm">
        <button
          onClick={() => setTab("steps")}
          className={cn("pb-2 -mb-px border-b-2 font-medium", tab === "steps" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t("tabs.steps")}
        </button>
        <button
          onClick={() => setTab("participants")}
          className={cn("pb-2 -mb-px border-b-2 font-medium", tab === "participants" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t("tabs.participants")}
        </button>
      </div>
      {tab === "steps" ? (
        seq.steps.length > 0 ? (
          <div className="px-5 py-3 bg-muted/20 space-y-2">
            {seq.steps.map((step, idx) => (
              <div key={step.id} className="flex items-start gap-3 text-sm">
                <div className="flex items-center gap-1 shrink-0 mt-0.5 w-8">
                  {stepTypeIcon(step.type)}
                  <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{t(`stepType.${step.type}` as never)}</span>
                  {step.subject && <span className="text-muted-foreground ml-1">— {step.subject}</span>}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {step.delayDays === 0 ? t("card.sameDay") : t("card.delayDays", { days: step.delayDays })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-3 text-sm text-muted-foreground bg-muted/20">{t("card.noStepsEdit")}</div>
        )
      ) : (
        <ParticipantsTab sequenceId={seq.id} />
      )}
    </div>
  )
}

// ─── Enroll Dialog ────────────────────────────────────────────────────────────

interface EnrollCandidate {
  id: string
  name: string
  company: string | null
}

function EnrollDialog({ sequence, onClose, onEnrolled }: {
  sequence: SalesSequence
  onClose: () => void
  onEnrolled: () => void
}) {
  const t = useTranslations("sequencesPage")
  const [entityType, setEntityType] = useState<"lead" | "contact">("lead")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<EnrollCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let cancelled = false
    setSearching(true) // synchronously: no "nothing found" flash during the debounce
    const timer = setTimeout(async () => {
      try {
        const url = entityType === "lead"
          ? `/api/v1/leads?search=${encodeURIComponent(query)}&limit=8`
          : `/api/v1/contacts?search=${encodeURIComponent(query)}&limit=8`
        const res = await fetch(url)
        const data = await res.json()
        if (cancelled) return
        if (res.ok && data.success) {
          const items = entityType === "lead"
            ? (data.data.leads ?? []).map((l: { id: string; contactName: string; companyName: string | null }) => ({
                id: l.id, name: l.contactName, company: l.companyName ?? null,
              }))
            : (data.data.contacts ?? []).map((c: { id: string; fullName: string; company?: { name: string } | null }) => ({
                id: c.id, name: c.fullName, company: c.company?.name ?? null,
              }))
          setResults(items)
        } else {
          setResults([])
        }
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [entityType, query])

  const enroll = async (candidate: EnrollCandidate) => {
    setBusyId(candidate.id)
    setMessage("")
    try {
      const res = await fetch(`/api/v1/sequences/${sequence.id}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId: candidate.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setMessage(t("enroll.alreadyEnrolled", { name: candidate.name }))
        return
      }
      if (!res.ok) {
        setMessage(body.error ?? t("enroll.failed"))
        return
      }
      setMessage(t("enroll.enrolled", { name: candidate.name }))
      onEnrolled()
    } catch {
      setMessage(t("enroll.failed"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">{t("enroll.title", { name: sequence.name })}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3 flex-1 overflow-y-auto">
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 text-sm font-medium">
            {(["lead", "contact"] as const).map((et) => (
              <button
                key={et}
                onClick={() => { setEntityType(et); setResults([]) }}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5",
                  entityType === et ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {et === "lead" ? t("enroll.typeLead") : t("enroll.typeContact")}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("enroll.searchPlaceholder")}
              className="pl-9"
              autoFocus
            />
          </div>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          {searching ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("loading")}</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("enroll.noResults")}</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              {results.map((candidate) => (
                <div key={candidate.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{candidate.name}</p>
                    {candidate.company && <p className="text-xs text-muted-foreground truncate">{candidate.company}</p>}
                  </div>
                  <Button size="sm" variant="outline" disabled={busyId === candidate.id} onClick={() => enroll(candidate)}>
                    <UserPlus className="h-3.5 w-3.5 mr-1" /> {t("enroll.button")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sequence Form Modal ──────────────────────────────────────────────────────

type FormStep = Omit<SequenceStep, "id"> & { id?: string }

interface SequenceFormProps {
  initial?: SalesSequence
  onSave: (data: {
    name: string; description: string; isActive: boolean
    exitOnReply: boolean; replyReaction?: "stop" | "pause" | "continue" | null; exitOnMeeting: boolean; exitOnDealClosed: boolean
    autoEnrollSources: string[]; workdaysOnly: boolean
    steps: FormStep[]
  }) => Promise<void>
  onClose: () => void
}

function SequenceForm({ initial, onSave, onClose }: SequenceFormProps) {
  const t = useTranslations("sequencesPage")
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [replyReaction, setReplyReaction] = useState<"stop" | "pause" | "continue">(
    initial?.replyReaction ?? ((initial?.exitOnReply ?? true) ? "stop" : "continue"),
  )
  const [exitOnMeeting, setExitOnMeeting] = useState(initial?.exitOnMeeting ?? true)
  const [exitOnDealClosed, setExitOnDealClosed] = useState(initial?.exitOnDealClosed ?? true)
  const [autoEnrollSources, setAutoEnrollSources] = useState((initial?.autoEnrollSources ?? []).join(", "))
  const [workdaysOnly, setWorkdaysOnly] = useState(initial?.workdaysOnly ?? false)
  const [steps, setSteps] = useState<FormStep[]>(
    (initial?.steps ?? []).map((s) => ({
      id: s.id,
      stepOrder: s.stepOrder,
      type: s.type,
      delayDays: s.delayDays,
      subject: s.subject,
      body: s.body,
      isActive: s.isActive,
      threadMode: s.threadMode ?? "continue",
    }))
  )
  // The list endpoint returns ACTIVE steps only. When editing, re-load the full
  // sequence (GET /[id] returns inactive steps too) so a save can't silently drop
  // them. Save stays disabled until this resolves, and FAILS CLOSED: if the
  // reload errors we keep Save disabled rather than save the active-only seed.
  const [stepsLoading, setStepsLoading] = useState(!!initial?.id)
  const [stepsLoadError, setStepsLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const seqId = initial?.id
    if (!seqId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/sequences/${seqId}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || !data.success) {
          // Could not load the full step set (incl. inactive). Saving now would
          // delete the inactive steps, so block the save and tell the user.
          setStepsLoadError(true)
          setError(t("form.stepsLoadError"))
          return
        }
        setSteps(
          (data.data.steps ?? []).map((s: SequenceStep) => ({
            id: s.id,
            stepOrder: s.stepOrder,
            type: s.type,
            delayDays: s.delayDays,
            subject: s.subject,
            body: s.body,
            isActive: s.isActive,
            threadMode: s.threadMode ?? "continue",
          }))
        )
      } catch {
        if (!cancelled) {
          setStepsLoadError(true)
          setError(t("form.stepsLoadError"))
        }
      } finally {
        if (!cancelled) setStepsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initial?.id])

  const addStep = () => {
    const order = steps.length + 1
    setSteps([...steps, { stepOrder: order, type: "email", delayDays: order === 1 ? 0 : 1, subject: null, body: null, isActive: true, threadMode: "continue" }])
  }

  const removeStep = (idx: number) => {
    const updated = steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i + 1 }))
    setSteps(updated)
  }

  // E5 — reorder a step; renumbers stepOrder so the saved sequence matches the
  // displayed order. dir -1 = up, +1 = down (no-op at the ends).
  // NOTE: like removeStep / toggling isActive, this shifts positional indices —
  // in-flight enrollments track currentStep as an index, so editing the step
  // list of a RUNNING sequence remaps what each active enrollment does next.
  // That is the existing behavior of the whole step editor, not new here.
  const moveStep = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setSteps(next.map((s, i) => ({ ...s, stepOrder: i + 1 })))
  }

  const updateStep = (idx: number, patch: Partial<FormStep>) => {
    setSteps(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const handleSave = async () => {
    if (!name.trim()) { setError(t("form.nameRequired")); return }
    // Defense-in-depth: never save while the full step set is unknown (Save is
    // also disabled in this state) — a save here would drop inactive steps.
    if (stepsLoading || stepsLoadError) { setError(t("form.stepsLoadError")); return }
    if (isActive && steps.filter((step) => step.isActive).length === 0) {
      setError(t("form.activeNeedsStep"))
      return
    }
    setSaving(true)
    setError("")
    try {
      await onSave({ name: name.trim(), description: description.trim(), isActive, exitOnReply: replyReaction === "stop", replyReaction, exitOnMeeting, exitOnDealClosed, autoEnrollSources: autoEnrollSources.split(",").map((v) => v.trim()).filter(Boolean), workdaysOnly, steps })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("form.saveFailed"))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-lg">{initial ? t("form.editTitle") : t("form.newTitle")}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid gap-3">
            <label className="text-sm font-medium">{t("form.nameLabel")}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("form.namePlaceholder")} />
          </div>

          <div className="grid gap-3">
            <label className="text-sm font-medium">{t("form.descriptionLabel")}</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("form.descriptionPlaceholder")} />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="isActive" className="text-sm">{t("form.activeLabel")}</label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">{t("form.activeHint")}</p>

          {/* Auto-exit rules */}
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-2">
            <h3 className="text-sm font-semibold">{t("form.exitHeading")}</h3>
            {/* E2 — reply reaction: stop | pause | continue */}
            <label className="flex items-center gap-2 text-sm">
              <span>{t("form.replyReactionLabel")}</span>
              <select
                value={replyReaction}
                onChange={(e) => setReplyReaction(e.target.value as "stop" | "pause" | "continue")}
                className="text-sm border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-background"
              >
                <option value="stop">{t("form.replyStop")}</option>
                <option value="pause">{t("form.replyPause")}</option>
                <option value="continue">{t("form.replyContinue")}</option>
              </select>
            </label>
            {([
              ["exitOnMeeting", exitOnMeeting, setExitOnMeeting],
              ["exitOnDealClosed", exitOnDealClosed, setExitOnDealClosed],
            ] as const).map(([key, value, setter]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => setter(e.target.checked)}
                  className="rounded"
                />
                {t(`form.${key}` as never)}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">{t("form.exitHint")}</p>
          </div>

          {/* Auto-enroll by lead source */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">{t("form.autoEnrollLabel")}</label>
            <Input
              value={autoEnrollSources}
              onChange={(e) => setAutoEnrollSources(e.target.value)}
              placeholder={t("form.autoEnrollPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("form.autoEnrollHint")}</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={workdaysOnly} onChange={(e) => setWorkdaysOnly(e.target.checked)} className="rounded" />
            {t("form.workdaysOnly")}
          </label>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{t("form.stepsHeading", { count: steps.length })}</h3>
              <Button size="sm" variant="outline" onClick={addStep}>
                <Plus className="h-3.5 w-3.5 mr-1" /> {t("form.addStep")}
              </Button>
            </div>

            {stepsLoading && (
              <p className="text-xs text-muted-foreground mb-2">{t("loading")}</p>
            )}

            {steps.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-lg">
                {t("form.noStepsHint")}
              </p>
            )}

            <div className="space-y-3">
              {steps.map((step, idx) => (
                <div key={idx} className={cn("border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-3", step.isActive ? "bg-muted/30" : "bg-muted/10 opacity-70")}>
                  <div className="flex items-center gap-2">
                    {/* E5 — reorder controls */}
                    <span className="flex flex-col -my-1">
                      <button
                        type="button"
                        onClick={() => moveStep(idx, -1)}
                        disabled={idx === 0}
                        title={t("form.moveUp")}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 leading-none"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStep(idx, 1)}
                        disabled={idx === steps.length - 1}
                        title={t("form.moveDown")}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 leading-none"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </span>
                    <span className="text-xs font-medium text-muted-foreground w-6">#{idx + 1}</span>
                    <select
                      value={step.type}
                      onChange={(e) => updateStep(idx, { type: e.target.value as FormStep["type"] })}
                      className="text-sm border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-background"
                    >
                      {STEP_TYPES.map((stType) => (
                        <option key={stType} value={stType}>{t(`stepType.${stType}` as never)}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={step.isActive}
                        onChange={(e) => updateStep(idx, { isActive: e.target.checked })}
                        className="rounded"
                      />
                      {t("form.activeLabel")}
                    </label>
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-xs text-muted-foreground">{t("form.delayLabel")}</span>
                      <input
                        type="number"
                        min={0}
                        value={step.delayDays}
                        onChange={(e) => updateStep(idx, { delayDays: Number(e.target.value) })}
                        className="w-16 text-sm border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-background"
                      />
                      <span className="text-xs text-muted-foreground">{t("form.daysSuffix")}</span>
                    </div>
                    <button onClick={() => removeStep(idx)} className="ml-2 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {/* E1 — how the email relates to the enrollment's thread; step 1 always starts it */}
                  {step.type === "email" && idx > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{t("form.threadModeLabel")}</span>
                      <select
                        value={step.threadMode ?? "continue"}
                        onChange={(e) => updateStep(idx, { threadMode: e.target.value as "continue" | "new" })}
                        className="text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-background"
                      >
                        <option value="continue">{t("form.threadContinue")}</option>
                        <option value="new">{t("form.threadNew")}</option>
                      </select>
                    </div>
                  )}
                  <Input
                    value={step.subject ?? ""}
                    onChange={(e) => updateStep(idx, { subject: e.target.value || null })}
                    placeholder={step.type === "email" ? t("form.subjectPlaceholder") : t("form.titlePlaceholder")}
                    className="text-sm"
                  />
                  <textarea
                    value={step.body ?? ""}
                    onChange={(e) => updateStep(idx, { body: e.target.value || null })}
                    placeholder={step.type === "email" ? t("form.emailBodyPlaceholder") : t("form.descriptionBodyPlaceholder")}
                    rows={2}
                    className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-md px-3 py-2 bg-background resize-none"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("form.cancel")}</Button>
          <Button onClick={handleSave} disabled={saving || stepsLoading || stepsLoadError}>
            {saving ? t("form.saving") : t("form.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Insights: step funnel + rep leaderboard ────────────────────────────────

function CadenceInsights({ funnel, leaderboard }: { funnel: FunnelSequence[]; leaderboard: LeaderboardRow[] }) {
  const t = useTranslations("sequencesPage")
  const rows = leaderboard.filter((r) => r.total > 0)

  return (
    <>
      {/* Rep leaderboard */}
      {rows.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">{t("insights.leaderboardTitle")}</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t("insights.leaderboardHint")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-zinc-200 dark:border-zinc-700">
                  <th className="py-2 pr-4 font-medium">{t("insights.colOwner")}</th>
                  <th className="py-2 px-4 font-medium text-right">{t("insights.colEnrollments")}</th>
                  <th className="py-2 px-4 font-medium text-right">{t("insights.colReplied")}</th>
                  <th className="py-2 px-4 font-medium text-right">{t("insights.colMeetings")}</th>
                  <th className="py-2 pl-4 font-medium text-right">{t("insights.colReplyRate")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ownerId ?? "unassigned"} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                    <td className="py-2 pr-4">{r.ownerName ?? t("insights.unassigned")}</td>
                    <td className="py-2 px-4 text-right tabular-nums">{r.total}</td>
                    <td className="py-2 px-4 text-right tabular-nums">{r.replied}</td>
                    <td className="py-2 px-4 text-right tabular-nums">{r.meetings}</td>
                    <td className="py-2 pl-4 text-right tabular-nums font-medium">{r.replyRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step funnel — one block per sequence with steps */}
      {funnel.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{t("insights.funnelTitle")}</h3>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">{t("insights.funnelHint")}</p>
          {funnel.map((seq) => (
            <div key={seq.sequenceId} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium truncate">{seq.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">{t("insights.funnelEntered", { count: seq.entered })}</span>
              </div>
              <div className="space-y-1.5">
                {seq.steps.map((step, i) => {
                  const pct = seq.entered > 0 ? Math.round((step.reached / seq.entered) * 100) : 0
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="shrink-0 w-5 text-muted-foreground">{stepTypeIcon(step.type)}</span>
                      <span className="text-xs text-muted-foreground w-10 shrink-0">#{step.stepOrder}</span>
                      <div className="flex-1 h-5 rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-primary/70 rounded" style={{ width: `${pct}%` }} />
                      </div>
                      {/* E5 — how many are waiting AT this step right now */}
                      {(step.activeHere ?? 0) > 0 && (
                        <span
                          className="text-[11px] tabular-nums shrink-0 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
                          title={t("insights.stepActiveHint")}
                        >
                          {t("insights.stepActiveHere", { count: step.activeHere ?? 0 })}
                        </span>
                      )}
                      <span className="text-xs tabular-nums w-24 text-right shrink-0">{t("insights.stepReached", { count: step.reached })}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SequencesPage() {
  const t = useTranslations("sequencesPage")
  const [sequences, setSequences] = useState<SalesSequence[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<SalesSequence | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SalesSequence | null>(null)
  const [enrollTarget, setEnrollTarget] = useState<SalesSequence | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState("")
  const [touchReload, setTouchReload] = useState(0)
  const [orgStats, setOrgStats] = useState<OrgAnalytics | null>(null)
  const [seqStats, setSeqStats] = useState<Map<string, SequenceAnalytics>>(new Map())
  const [funnel, setFunnel] = useState<FunnelSequence[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
  const [showInsights, setShowInsights] = useState(false)

  const hasLoadedRef = useRef(false)
  const fetchSequences = async () => {
    if (!hasLoadedRef.current) setLoading(true) // refreshes must not flash the whole list
    try {
      const res = await fetch("/api/v1/sequences")
      const data = await res.json()
      if (data.success) setSequences(data.data)
      hasLoadedRef.current = true
    } finally {
      setLoading(false)
    }
  }

  const fetchAnalytics = async () => {
    try {
      const res = await fetch("/api/v1/sequences/analytics")
      const data = await res.json()
      if (res.ok && data.success) {
        setOrgStats(data.data.org)
        setSeqStats(new Map(data.data.sequences.map((s: SequenceAnalytics) => [s.sequenceId, s])))
        setFunnel(data.data.funnel ?? [])
        setLeaderboard(data.data.leaderboard ?? [])
      }
    } catch {
      // analytics are decorative — the page works without them
    }
  }

  useEffect(() => { fetchSequences(); fetchAnalytics() }, [])

  const filtered = sequences.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description ?? "").toLowerCase().includes(search.toLowerCase())
  )

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSave = async (data: Parameters<SequenceFormProps["onSave"]>[0]) => {
    const url = editTarget ? `/api/v1/sequences/${editTarget.id}` : "/api/v1/sequences"
    const method = editTarget ? "PATCH" : "POST"
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? t("form.requestFailed"))
    }
    setShowForm(false)
    setEditTarget(null)
    await fetchSequences()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await fetch(`/api/v1/sequences/${deleteTarget.id}`, { method: "DELETE" })
    setDeleteTarget(null)
    await fetchSequences()
  }

  const toggleActive = async (seq: SalesSequence) => {
    setActionError("")
    const res = await fetch(`/api/v1/sequences/${seq.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !seq.isActive }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setActionError(body.error ?? t("actions.toggleFailed"))
      return
    }
    await fetchSequences()
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            {t("title")}
            <HelpButton slug="sequences" variant="label" />
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
          <Plus className="h-4 w-4 mr-2" /> {t("newSequence")}
        </Button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {actionError}
        </div>
      )}

      {/* Touch queue — what the manager should do today */}
      <TouchQueue reloadToken={touchReload} onChanged={() => { fetchSequences(); fetchAnalytics() }} />

      {/* Stats row — cadence effectiveness */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: t("stats.total"), value: String(sequences.length) },
          { label: t("stats.activeEnrollments"), value: orgStats ? String(orgStats.activeEnrollments) : "—" },
          { label: t("stats.replyRate"), value: orgStats ? `${orgStats.replyRate}%` : "—" },
          { label: t("stats.meetings"), value: orgStats ? String(orgStats.meetings) : "—" },
          { label: t("stats.avgTouches"), value: orgStats?.avgTouchesToReply != null ? String(orgStats.avgTouchesToReply) : "—" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-bold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Insights — step funnel + rep leaderboard (collapsible; decorative) */}
      {(funnel.length > 0 || leaderboard.some((r) => r.total > 0)) && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card">
          <button
            type="button"
            onClick={() => setShowInsights((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium"
          >
            <BarChart3 className="h-4 w-4 text-primary" />
            {showInsights ? t("insights.hide") : t("insights.show")}
            {showInsights ? <ChevronDown className="h-4 w-4 ml-auto" /> : <ChevronRight className="h-4 w-4 ml-auto" />}
          </button>
          {showInsights && (
            <div className="border-t border-zinc-200 dark:border-zinc-700 p-4 space-y-6">
              <CadenceInsights funnel={funnel} leaderboard={leaderboard} />
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">{t("loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-xl">
          <Zap className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="font-medium">{t("empty.title")}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {t("empty.description")}
          </p>
          <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
            <Plus className="h-4 w-4 mr-2" /> {t("newSequence")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((seq) => {
            const expanded = expandedIds.has(seq.id)
            const activeStepCount = seq.steps.length
            const needsStepsBeforeActivate = !seq.isActive && activeStepCount === 0
            return (
              <div key={seq.id} className="border border-zinc-200 dark:border-zinc-700 rounded-xl bg-card overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-3 px-5 py-4">
                  <button onClick={() => toggleExpand(seq.id)} className="text-muted-foreground hover:text-foreground shrink-0">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{seq.name}</span>
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium",
                          seq.isActive
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {seq.isActive ? t("status.active") : t("status.inactive")}
                      </span>
                    </div>
                    {seq.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{seq.description}</p>
                    )}
                    {activeStepCount === 0 && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        {seq.isActive ? t("card.activeNoSteps") : t("card.activationNeedsSteps")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0">
                    <span className="flex items-center gap-1">
                      <CheckSquare className="h-3.5 w-3.5" />
                      {t("card.stepCount", { count: seq.steps.length })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {t("card.enrolledCount", { count: seq._count.enrollments })}
                    </span>
                    {(() => {
                      const stats = seqStats.get(seq.id)
                      if (!stats || stats.total === 0) return null
                      return (
                        <span className="hidden lg:flex items-center gap-1" title={t("card.statsTitle")}>
                          <span className="text-green-600 dark:text-green-400 font-medium">{stats.replyRate}%</span>
                          {t("card.repliesShort")}
                          {stats.meetings > 0 && (
                            <span className="ml-1">· {t("card.meetingsShort", { count: stats.meetings })}</span>
                          )}
                        </span>
                      )
                    })()}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {seq.isActive && seq.steps.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEnrollTarget(seq)}
                        title={t("enroll.button")}
                      >
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        {t("enroll.button")}
                      </Button>
                    )}
                    {needsStepsBeforeActivate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setEditTarget(seq); setShowForm(true) }}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        {t("actions.addSteps")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={seq.isActive ? "outline" : "default"}
                        onClick={() => toggleActive(seq)}
                        title={seq.isActive ? t("actions.deactivate") : t("actions.activate")}
                      >
                        {seq.isActive ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                        {seq.isActive ? t("actions.deactivate") : t("actions.activate")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditTarget(seq); setShowForm(true) }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(seq)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Expanded: Steps | Participants tabs */}
                {expanded && <SequenceExpanded seq={seq} />}
              </div>
            )
          })}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <SequenceForm
          initial={editTarget ?? undefined}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
        />
      )}

      {/* Enroll dialog */}
      {enrollTarget && (
        <EnrollDialog
          sequence={enrollTarget}
          onClose={() => setEnrollTarget(null)}
          onEnrolled={() => { setTouchReload((n) => n + 1); fetchSequences() }}
        />
      )}

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={t("delete.title")}
        description={deleteTarget ? t("delete.description", { name: deleteTarget.name }) : undefined}
        onConfirm={handleDelete}
      />
    </div>
  )
}
