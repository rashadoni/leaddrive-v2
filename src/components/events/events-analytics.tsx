"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { MiniLineChart } from "@/components/charts/mini-charts"
import { APP_DOMAIN, MARKETING_DOMAIN } from "@/lib/domains"
import { cn } from "@/lib/utils"
import { formatDate as localeFormatDate } from "@/lib/format-date"
import {
  CalendarDays,
  MapPin,
  Users,
  Video,
  Building2,
  Plus,
  Copy,
  Mail,
  CalendarCheck,
  CheckCircle2,
  XCircle,
  Send,
  Eye,
  TrendingUp,
  DollarSign,
  BarChart3,
  Landmark,
  UserCheck,
  Mic2,
  Shield,
  Star,
  Heart,
  Link2,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react"

// ─── Types ──────────────────────────────────────────────────────────────────

interface Event {
  id: string
  name: string
  type: string
  status: string
  startDate?: string
  endDate?: string
  location?: string
  isOnline?: boolean
  capacity?: number
  registeredCount?: number
  budget?: number
  description?: string
  createdAt: string
}

interface EventsAnalyticsProps {
  events: Event[]
}

// ─── Mock data ──────────────────────────────────────────────────────────────

const MOCK_ATTENDEES = [
  { id: "a1", name: "Ramin Əliyev", company: "TechAz", role: "Speaker", initials: "RƏ" },
  { id: "a2", name: "Leyla Hüseynova", company: "DataSoft", role: "Organizer", initials: "LH" },
  { id: "a3", name: "Orxan Məmmədov", company: "CloudBaku", role: "VIP", initials: "OM" },
  { id: "a4", name: "Nigar İsmayılova", company: "LeadDrive", role: "Attendee", initials: "Nİ" },
  { id: "a5", name: "Farid Həsənov", company: "AzInnovate", role: "Sponsor", initials: "FH" },
  { id: "a6", name: "Aynur Quliyeva", company: "StartHub", role: "Attendee", initials: "AQ" },
  { id: "a7", name: "Elvin Rzayev", company: "BakuDev", role: "Speaker", initials: "ER" },
  { id: "a8", name: "Səbinə Nəsirova", company: "DigiServ", role: "VIP", initials: "SN" },
]

const MOCK_BUDGET = {
  total: 8500,
  spent: 6200,
  revenue: 22400,
  roiPercent: 261,
  perAttendee: 52,
}

const MOCK_CALENDAR = [
  { id: "c1", name: "DevOps Meetup #12", date: "2026-04-12", location: "Coworking Hub", attendees: 45, status: "open" },
  { id: "c2", name: "AI/ML Workshop", date: "2026-04-18", location: "Zoom", attendees: 120, status: "planned" },
  { id: "c3", name: "Startup Pitch Day", date: "2026-04-25", location: "Hilton Baku", attendees: 200, status: "open" },
  { id: "c4", name: "Cloud Migration Conf", date: "2026-05-03", location: "Ofis", attendees: 80, status: "planned" },
  { id: "c5", name: "CTO Networking", date: "2026-05-10", location: "Landmark", attendees: 35, status: "completed" },
]

const MOCK_REGISTRATION_CHART_DATA = [5, 12, 18, 25, 33, 42, 56, 68, 80, 95, 108, 120]

const MOCK_INVITE_STATS = {
  sent: 240,
  opened: 186,
  confirmed: 120,
  declined: 18,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function formatDate(dateStr: string | undefined, locale: string): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  return localeFormatDate(d, locale, { day: "numeric", month: "short", year: "numeric" })
}

function formatShortDate(dateStr: string, locale: string): string {
  const d = new Date(dateStr)
  return localeFormatDate(d, locale, { day: "numeric", month: "short" })
}

const STATUS_MAP: Record<string, { labelKey: string; className: string }> = {
  open: { labelKey: "statusRegistrationOpen", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  planned: { labelKey: "statusPlanned", className: "bg-primary/10 text-primary border-primary/20" },
  completed: { labelKey: "statusCompleted", className: "bg-muted text-muted-foreground border-zinc-200 dark:border-zinc-700" },
  cancelled: { labelKey: "statusCancelled", className: "bg-red-500/10 text-red-400 border-red-500/20" },
}

const ROLE_STYLES: Record<string, string> = {
  Speaker: "bg-[hsl(var(--ai-from))]/10 text-[hsl(var(--ai-from))] border-[hsl(var(--ai-from))]/20",
  Organizer: "bg-primary/10 text-primary border-primary/20",
  VIP: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Attendee: "bg-muted text-muted-foreground border-zinc-200 dark:border-zinc-700",
  Sponsor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  Speaker: <Mic2 className="w-3 h-3" />,
  Organizer: <Shield className="w-3 h-3" />,
  VIP: <Star className="w-3 h-3" />,
  Attendee: <UserCheck className="w-3 h-3" />,
  Sponsor: <Heart className="w-3 h-3" />,
}

const CALENDAR_DOT_COLORS: Record<string, string> = {
  open: "bg-emerald-400",
  planned: "bg-primary",
  completed: "bg-muted-foreground/40",
}

// ─── Helpers: ICS generation ───────────────────────────────────────────────

function generateICS(event: Event): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const toICSDate = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`

  const start = event.startDate ? new Date(event.startDate) : now
  const end = event.endDate ? new Date(event.endDate) : new Date(start.getTime() + 3600000)

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LeadDrive CRM//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `DTSTAMP:${toICSDate(now)}`,
    `UID:${event.id}@${APP_DOMAIN}`,
    `SUMMARY:${event.name.replace(/[,;\\]/g, " ")}`,
    event.location ? `LOCATION:${event.location.replace(/[,;\\]/g, " ")}` : "",
    event.description ? `DESCRIPTION:${event.description.replace(/\n/g, "\\n").replace(/[,;\\]/g, " ")}` : "",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n")
}

function downloadICS(event: Event) {
  const ics = generateICS(event)
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${event.name.replace(/[^a-zA-Z0-9а-яА-ЯəüöğıçşƏÜÖĞİÇŞ ]/g, "").replace(/\s+/g, "_")}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Invite Modal ──────────────────────────────────────────────────────────

function InviteModal({ event, onClose }: { event: Event; onClose: () => void }) {
  const t = useTranslations("events")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [emails, setEmails] = useState("")
  const [subject, setSubject] = useState(`${t("inviteSubjectPrefix")}: ${event.name}`)
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; total: number; smtpConfigured: boolean } | null>(null)
  const [error, setError] = useState("")

  const handleSend = async () => {
    const emailList = emails.split(/[,;\n]+/).map(e => e.trim()).filter(Boolean)
    if (emailList.length === 0) { setError(t("enterEmails")); return }

    setSending(true)
    setError("")
    setResult(null)
    try {
      // First, add participants if they don't exist
      for (const email of emailList) {
        await fetch(`/api/v1/events/${event.id}/participants`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: email.split("@")[0],
            email,
            role: "attendee",
            status: "registered",
            source: "invited",
          }),
        }).catch(() => {})
      }

      // Get all participants with matching emails
      const pRes = await fetch(`/api/v1/events/${event.id}/participants`)
      const pData = await pRes.json()
      const participants = pData.data || []
      const matchedIds = participants
        .filter((p: any) => p.email && emailList.includes(p.email.toLowerCase()))
        .map((p: any) => p.id)

      // Send invites
      const res = await fetch(`/api/v1/events/${event.id}/participants`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_invites",
          participantIds: matchedIds.length > 0 ? matchedIds : participants.map((p: any) => p.id),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setResult(data.data)
      } else {
        setError(data.error || tc("errorGeneric"))
      }
    } catch {
      setError(tc("errorNetwork"))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-violet-600 to-purple-600">
          <div className="flex items-center gap-2 text-white">
            <Mail className="w-5 h-5" />
            <h2 className="text-base font-semibold">{t("sendInvitation")}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/20 text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Event info */}
        <div className="px-6 py-3 bg-muted/30 border-b flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
            <CalendarDays className="w-5 h-5 text-violet-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{event.name}</p>
            <p className="text-xs text-muted-foreground">
              {event.startDate ? localeFormatDate(event.startDate, locale, { dateStyle: "medium" }) : "—"}
              {event.location ? ` · ${event.location}` : ""}
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-4">
          {/* To */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email *</label>
            <textarea
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm min-h-[60px] resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              placeholder={t("inviteEmailsPlaceholder")}
              value={emails}
              onChange={e => setEmails(e.target.value)}
            />
          </div>

          {/* Subject */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t("emailSubject")}</label>
            <input
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              value={subject}
              onChange={e => setSubject(e.target.value)}
            />
          </div>

          {/* Message */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t("personalMessage")}</label>
            <textarea
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              placeholder={t("personalMessagePlaceholder")}
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>

          {/* Info */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2.5">
            <CalendarDays className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-400" />
            <span>{t("inviteICSNote")}</span>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-900/10 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {t("invitesSentResult", { sent: result.sent, total: result.total })}
              {!result.smtpConfigured && (
                <span className="text-amber-600 ml-1">({t("smtpNotConfigured")})</span>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          >
            {result ? tc("close") : tc("cancel")}
          </button>
          {!result && (
            <button
              onClick={handleSend}
              disabled={sending || !emails.trim()}
              className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {sending ? tc("sending") : t("sendInvites")}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EventsAnalytics({ events }: EventsAnalyticsProps) {
  const t = useTranslations("events")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    events.length > 0 ? events[0].id : null
  )

  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)

  const selectEvent = (id: string) => {
    setSelectedEventId(id)
    setConfirmed(false)
  }

  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? events[0]

  const handleConfirmAll = async () => {
    if (!selectedEvent) return
    setConfirming(true)
    try {
      const res = await fetch(`/api/v1/events/${selectedEvent.id}/confirm-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (res.ok) setConfirmed(true)
    } catch { /* ignore */ }
    finally { setConfirming(false) }
  }

  const totalEvents = events.length
  const openCount = events.filter((e) => e.status === "open").length
  const plannedCount = events.filter((e) => e.status === "planned").length
  const completedCount = events.filter((e) => e.status === "completed").length

  const capacity = selectedEvent?.capacity ?? 150
  const registered = selectedEvent?.registeredCount ?? 120

  return (
    <div className="space-y-4">
      {/* ── Top Row: Events List + Attendees ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: Events list (wider) */}
        <div className="lg:col-span-3 bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-violet-400" />
              {t("title")}
            </h3>
            <button className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors">
              <Plus className="w-3.5 h-3.5" />
              {t("newEvent")}
            </button>
          </div>

          {events.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">{t("noEventsYet")}</div>
          ) : (
            <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
              {events.map((ev) => {
                const st = STATUS_MAP[ev.status] ?? STATUS_MAP.planned
                const isSelected = ev.id === selectedEventId
                return (
                  <button
                    key={ev.id}
                    onClick={() => selectEvent(ev.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      isSelected
                        ? "bg-violet-500/10 border border-violet-500/20"
                        : "hover:bg-muted/50 border border-transparent"
                    )}
                  >
                    {/* Icon */}
                    <div className={cn(
                      "shrink-0 w-9 h-9 rounded-lg flex items-center justify-center",
                      ev.isOnline ? "bg-blue-500/10" : "bg-emerald-500/10"
                    )}>
                      {ev.isOnline ? (
                        <Video className="w-4 h-4 text-blue-400" />
                      ) : (
                        <Building2 className="w-4 h-4 text-emerald-400" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{ev.name}</span>
                        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-700 shrink-0", st.className)}>
                          {t(st.labelKey)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          {formatDate(ev.startDate, locale)}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {ev.isOnline ? "Zoom" : ev.location || t("location")}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {ev.registeredCount ?? 0}/{ev.capacity ?? "—"}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Attendees for selected event */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">
              {t("participants")} — {selectedEvent?.name ?? "—"}
            </h3>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 tabular-nums">
              {registered}/{capacity}
            </span>
          </div>

          <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
            {MOCK_ATTENDEES.map((att) => (
              <div key={att.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors">
                {/* Avatar */}
                <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-violet-300">{att.initials}</span>
                </div>
                {/* Name + company */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{att.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{att.company}</p>
                </div>
                {/* Role badge */}
                <span className={cn(
                  "shrink-0 flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
                  ROLE_STYLES[att.role] ?? ROLE_STYLES.Attendee
                )}>
                  {ROLE_ICONS[att.role]}
                  {t(`role${att.role}`)}
                </span>
              </div>
            ))}
          </div>

          {/* Bottom stats */}
          <div className="mt-4 pt-3 border-t grid grid-cols-4 gap-2">
            {[
              { label: t("inviteSent"), value: MOCK_INVITE_STATS.sent, icon: <Send className="w-3 h-3" />, color: "text-blue-400" },
              { label: t("inviteOpened"), value: MOCK_INVITE_STATS.opened, icon: <Eye className="w-3 h-3" />, color: "text-amber-400" },
              { label: t("inviteConfirmed"), value: MOCK_INVITE_STATS.confirmed, icon: <CheckCircle2 className="w-3 h-3" />, color: "text-emerald-400" },
              { label: t("inviteDeclined"), value: MOCK_INVITE_STATS.declined, icon: <XCircle className="w-3 h-3" />, color: "text-red-400" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className={cn("flex items-center justify-center gap-1 text-xs mb-0.5", s.color)}>
                  {s.icon}
                  <span className="font-bold tabular-nums">{s.value}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom Row: Budget + Calendar + Registration ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Budget & ROI */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            {t("budgetAndRoi")}
          </h3>

          <div className="space-y-3">
            {/* Budget row */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{t("budget")}</span>
                <span className="font-bold tabular-nums">{"\u20BC"}{fmt(MOCK_BUDGET.total)}</span>
              </div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">{t("spent")}</span>
                <span className="font-bold tabular-nums">{"\u20BC"}{fmt(MOCK_BUDGET.spent)}</span>
              </div>
              {/* Progress bar */}
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.min((MOCK_BUDGET.spent / MOCK_BUDGET.total) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Revenue */}
            <div className="flex items-center justify-between text-xs pt-2 border-t">
              <span className="text-muted-foreground">{t("revenue")}</span>
              <span className="font-bold text-emerald-400 tabular-nums">{"\u20BC"}{fmt(MOCK_BUDGET.revenue)}</span>
            </div>

            {/* ROI */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">ROI</span>
              <span className="flex items-center gap-1 font-bold text-emerald-400">
                <TrendingUp className="w-3 h-3" />
                +{MOCK_BUDGET.roiPercent}%
              </span>
            </div>

            {/* Per attendee */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t("perAttendee")}</span>
              <span className="font-bold tabular-nums">{"\u20BC"}{fmt(MOCK_BUDGET.perAttendee)}</span>
            </div>
          </div>
        </div>

        {/* Event Calendar */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <CalendarCheck className="w-4 h-4 text-blue-400" />
            {t("eventCalendar")}
          </h3>

          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
            {MOCK_CALENDAR.map((item) => (
              <div key={item.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors">
                {/* Colored dot */}
                <div className={cn("shrink-0 w-2.5 h-2.5 rounded-full", CALENDAR_DOT_COLORS[item.status] ?? "bg-muted-foreground/40")} />
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.name}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    <span>{formatShortDate(item.date, locale)}</span>
                    <span className="flex items-center gap-0.5">
                      <MapPin className="w-2.5 h-2.5" />
                      {item.location}
                    </span>
                  </div>
                </div>
                {/* Attendee count */}
                <span className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                  <Users className="w-3 h-3" />
                  {item.attendees}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Registration Portal */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <Link2 className="w-4 h-4 text-amber-400" />
            {t("registrationPortal")}
          </h3>

          {/* Registration link */}
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 mb-4">
            <code className="flex-1 text-xs text-muted-foreground truncate">{MARKETING_DOMAIN}/r/ev014</code>
            <button className="shrink-0 p-1 rounded hover:bg-muted transition-colors" title={tc("copy")}>
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mb-4">
            {/* Invite */}
            <button
              onClick={() => setShowInviteModal(true)}
              className={cn("flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors bg-violet-600 hover:bg-violet-500 text-white")}
            >
              <Mail className="w-3.5 h-3.5" />
              {t("invite")}
            </button>
            {/* ICS Download */}
            <button
              onClick={() => selectedEvent && downloadICS(selectedEvent)}
              className={cn("flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground")}
              title={t("downloadICS")}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              ICS
            </button>
            {/* Confirm All */}
            <button
              onClick={handleConfirmAll}
              disabled={confirming || confirmed}
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors",
                confirmed
                  ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted hover:bg-muted/80 text-foreground",
                (confirming || confirmed) && "opacity-70 cursor-not-allowed"
              )}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {confirmed ? t("confirmed") : confirming ? tc("loading") : t("confirm")}
            </button>
          </div>

          {/* Registration dynamics mini chart */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">{t("registrationDynamics")}</p>
            <MiniLineChart data={MOCK_REGISTRATION_CHART_DATA} color="stroke-violet-400" />
            <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
              <span>{t("weeksAgo", { count: 4 })}</span>
              <span className="font-medium text-foreground tabular-nums">{t("registrationsCount", { count: registered })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && selectedEvent && (
        <InviteModal event={selectedEvent} onClose={() => setShowInviteModal(false)} />
      )}
    </div>
  )
}
