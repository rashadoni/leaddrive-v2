"use client"

/**
 * One booking page — a service a client books themselves.
 *
 * The form used to be fifteen fields in a flat list: the largest thing on the
 * screen was the optional description, the link had to be transliterated by
 * hand, and three settings nobody touches (buffer, notice, how far ahead) sat
 * between the ones everybody does. It is now six named steps, with those three
 * folded away and the result shown as the client will see it — the question
 * «what am I actually making» had no answer anywhere on the old screen.
 *
 * Working hours are one interval per weekday. A salon keeps the same hours all
 * week, so the common answer is offered whole (a preset and one pair of time
 * fields); the per-day rows open only when the days really differ.
 */
import { useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Building2, Check, ChevronRight, CircleAlert, Clock3, Loader2, Phone, Video, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BookingAvatar } from "@/components/booking/booking-day-timeline"
import { applyWeekly, openWeekdays, uniformInterval, WEEKDAYS, type HoursInterval, type Weekday, type WeeklyHours } from "@/lib/booking/availability"
import { bookingSlug, REPEAT_CYCLE_DAYS } from "@/lib/booking/service"
import { getCurrencySymbol } from "@/lib/currency"
import { cn } from "@/lib/utils"

export interface BookingPageDraft {
  id?: string
  title: string
  slug: string
  description: string
  durationMinutes: number
  locationType: "office" | "phone" | "online"
  locationText: string
  /** Text, not a number: an empty field means «no price», not zero. */
  price: string
  category: string
  /** 0 = the client does not come back on a cycle. */
  repeatCycleDays: number
  hostIds: string[]
  weekly: WeeklyHours
  bufferMinutes: number
  minNoticeMinutes: number
  maxDaysAhead: number
  isActive: boolean
}

export interface BookingHostOption {
  id: string
  name: string
}

const DURATIONS = [15, 30, 45, 60, 90]
const BUFFERS = [0, 5, 10, 15, 30]
const NOTICE_HOURS = [1, 2, 4, 12, 24, 48]
const AHEAD_DAYS = [7, 14, 30, 60]
const LOCATIONS = ["office", "phone", "online"] as const
const LOCATION_ICON = { office: Building2, phone: Phone, online: Video }
// Monday first: the week a person in Baku reads.
const WEEK_ORDER: Weekday[] = [...WEEKDAYS.slice(1), WEEKDAYS[0]]
const PRESETS: { key: string; days: Weekday[] }[] = [
  { key: "hoursPresetWork", days: ["1", "2", "3", "4", "5"] },
  { key: "hoursPresetSat", days: ["1", "2", "3", "4", "5", "6"] },
  { key: "hoursPresetAll", days: [...WEEKDAYS] },
]
const DEFAULT_INTERVAL: HoursInterval = { start: "09:00", end: "18:00" }
/** 2024-01-07 was a Sunday, so weekday "0" lands on it and "6" on the Saturday after. */
const WEEKDAY_ANCHOR = Date.UTC(2024, 0, 7)
const DAY_MS = 86_400_000

/** A selected choice, in the shared CRM chip style (crm-workspace.css). */
function Chip({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      data-crm-filter=""
      data-state={active ? "active" : "inactive"}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-full border border-input bg-card px-3.5 text-sm text-muted-foreground transition-colors",
        "hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "text-foreground",
        className,
      )}
    >
      {children}
    </button>
  )
}

function Step({ index, title, aside, children }: { index: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[13px] font-extrabold text-primary">{index}</span>
        <h3 className="text-sm font-bold tracking-tight">{title}</h3>
        {aside ? <div className="ml-auto text-xs text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Minutes from "HH:mm", or null when the field is half-typed. */
function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function clockLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

/**
 * The first times the client would be offered: the earliest open day's start,
 * then every `durationMinutes` until the day ends. Invented times would be a
 * lie on a screen titled «this is what the client sees», and these are the
 * real first slots of a working day — they move when the form moves.
 */
function previewSlots(weekly: WeeklyHours, durationMinutes: number): string[] {
  const open = openWeekdays(weekly)
  const interval = open.length ? weekly[open[0]][0] : null
  const from = interval ? clockMinutes(interval.start) : null
  const until = interval ? clockMinutes(interval.end) : null
  if (from === null || until === null || durationMinutes <= 0) return []
  const slots: string[] = []
  for (let at = from; at + durationMinutes <= until && slots.length < 6; at += durationMinutes) slots.push(clockLabel(at))
  return slots
}

export function BookingPageEditor({
  draft, hosts, categories, linkBase, currency, saving, error, onChange, onSave, onCancel,
}: {
  draft: BookingPageDraft
  hosts: BookingHostOption[]
  /** The groups this organization already uses, so the field spells them the same way twice. */
  categories: string[]
  linkBase: string
  /** The code the price will be saved in — the symbol beside the field. */
  currency: string
  saving: boolean
  error: string
  onChange: (draft: BookingPageDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  const t = useTranslations("booking")
  const locale = useLocale()
  // The short day names the week strip already shows, from the same source:
  // seven more translation keys would be seven more spellings to keep in step.
  const shortDay = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })
    return (day: Weekday) => format.format(new Date(WEEKDAY_ANCHOR + Number(day) * DAY_MS)).replace(/\.$/, "")
  }, [locale])
  // A published link is never rewritten behind the owner's back, so an existing
  // page starts with the link free-standing and the name no longer feeding it.
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkLocked, setLinkLocked] = useState(Boolean(draft.id))
  const [customDuration, setCustomDuration] = useState(!DURATIONS.includes(draft.durationMinutes))
  const [newCategory, setNewCategory] = useState(false)
  const [perDayOpen, setPerDayOpen] = useState(false)

  const set = <K extends keyof BookingPageDraft>(key: K, value: BookingPageDraft[K]) => onChange({ ...draft, [key]: value })

  const uniform = uniformInterval(draft.weekly)
  const open = openWeekdays(draft.weekly)
  const perDay = perDayOpen || (open.length > 0 && !uniform)
  const base = uniform ?? DEFAULT_INTERVAL

  function setTitle(value: string) {
    const next = { ...draft, title: value }
    if (!linkLocked) next.slug = bookingSlug(value)
    onChange(next)
  }
  function setSlug(value: string) {
    setLinkLocked(true)
    set("slug", value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 60))
  }
  function toggleDay(day: Weekday) {
    const next = open.includes(day) ? open.filter((other) => other !== day) : [...open, day]
    set("weekly", applyWeekly(next, base))
  }
  function setUniformEdge(edge: "start" | "end", value: string) {
    set("weekly", applyWeekly(open, { ...base, [edge]: value }))
  }
  function setDayEdge(day: Weekday, edge: "start" | "end", value: string) {
    const current = draft.weekly[day][0] ?? DEFAULT_INTERVAL
    set("weekly", { ...draft.weekly, [day]: [{ ...current, [edge]: value }] })
  }
  function toggleHost(id: string) {
    set("hostIds", draft.hostIds.includes(id) ? draft.hostIds.filter((hostId) => hostId !== id) : [...draft.hostIds, id])
  }

  const missing = [
    draft.title.trim() ? null : t("missingTitle"),
    draft.hostIds.length ? null : t("missingHosts"),
    open.length ? null : t("missingHours"),
  ].filter(Boolean) as string[]
  const chosenHosts = hosts.filter((host) => draft.hostIds.includes(host.id))
  const groups = [...new Set([...categories, draft.category.trim()].filter(Boolean))]
  const slots = previewSlots(draft.weekly, draft.durationMinutes)
  const LocationIcon = LOCATION_ICON[draft.locationType]
  const optional = <span className="font-normal text-muted-foreground">— {t("optionalMark")}</span>

  return (
    <div className="space-y-4" data-testid="booking-page-editor">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_336px]">
        <div className="space-y-4">

          <Step index={1} title={t("stepService")}>
            <Label htmlFor="bp-title">{t("fieldTitle")}</Label>
            <Input id="bp-title" className="mt-1 h-12 text-base font-semibold" value={draft.title} placeholder={t("fieldTitlePlaceholder")} onChange={(event) => setTitle(event.target.value)} />

            {linkOpen ? (
              <div className="mt-2.5">
                <Label htmlFor="bp-slug">{t("fieldSlug")}</Label>
                <div className="mt-1 flex items-center rounded-md border border-input bg-background text-sm">
                  <span className="whitespace-nowrap pl-3 text-muted-foreground">{linkBase}/</span>
                  <input id="bp-slug" className="h-10 min-w-0 flex-1 bg-transparent pr-3 outline-none" value={draft.slug} onChange={(event) => setSlug(event.target.value)} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t("fieldSlugHint")}</p>
              </div>
            ) : (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span>{t("fieldSlug")}:</span>
                <span className="break-all font-semibold text-foreground">{linkBase}/{draft.slug || "…"}</span>
                <button type="button" className="font-bold text-primary underline-offset-2 hover:underline" onClick={() => { setLinkOpen(true); setLinkLocked(true) }}>{t("linkEdit")}</button>
                {linkLocked ? null : <span className="ml-auto hidden sm:inline">{t("linkAuto")}</span>}
              </div>
            )}

            <div className="mt-4">
              <Label>{t("fieldCategory")} {optional}</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {groups.map((name) => (
                  <Chip key={name} active={draft.category.trim() === name} onClick={() => { setNewCategory(false); set("category", draft.category.trim() === name ? "" : name) }}>{name}</Chip>
                ))}
                <button
                  type="button"
                  onClick={() => { setNewCategory(true); set("category", "") }}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-dashed border-input bg-card px-3.5 text-sm font-semibold text-primary transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >+ {t("catNew")}</button>
              </div>
              {newCategory ? (
                <Input className="mt-2 max-w-xs" autoFocus value={draft.category} placeholder={t("fieldCategoryPlaceholder")} onChange={(event) => set("category", event.target.value.slice(0, 60))} />
              ) : null}
              <p className="mt-1.5 text-xs text-muted-foreground">{t("fieldCategoryHint")}</p>
            </div>

            <div className="mt-4">
              <Label htmlFor="bp-description">{t("fieldDescription")} {optional}</Label>
              <Textarea id="bp-description" className="mt-1" rows={2} value={draft.description} onChange={(event) => set("description", event.target.value)} />
            </div>
          </Step>

          <Step index={2} title={t("stepWhere")}>
            <Label>{t("fieldDuration")}</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {DURATIONS.map((value) => (
                <Chip key={value} active={!customDuration && draft.durationMinutes === value} onClick={() => { setCustomDuration(false); set("durationMinutes", value) }}>{t("minutes", { count: value })}</Chip>
              ))}
              <button
                type="button"
                onClick={() => setCustomDuration(true)}
                className="inline-flex min-h-10 items-center rounded-full border border-dashed border-input bg-card px-3.5 text-sm font-semibold text-primary transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >+ {t("durationOther")}</button>
              {customDuration ? (
                <span className="inline-flex items-center gap-2">
                  <Input
                    aria-label={t("durationCustom")}
                    className="h-10 w-24"
                    inputMode="numeric"
                    autoFocus
                    value={String(draft.durationMinutes)}
                    onChange={(event) => set("durationMinutes", Math.max(0, Math.min(600, Number(event.target.value.replace(/\D/g, "")) || 0)))}
                  />
                  <span className="text-sm text-muted-foreground">{t("durationCustom").toLocaleLowerCase()}</span>
                </span>
              ) : null}
            </div>

            <div className="mt-4">
              <Label>{t("fieldLocation")}</Label>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                {LOCATIONS.map((value) => {
                  const Icon = LOCATION_ICON[value]
                  const active = draft.locationType === value
                  return (
                    <button
                      key={value}
                      type="button"
                      data-crm-filter=""
                      data-state={active ? "active" : "inactive"}
                      aria-pressed={active}
                      onClick={() => set("locationType", value)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border border-input bg-card p-3 text-left transition-colors",
                        "hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">{t(`location_${value}`)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{t(`locHint_${value}`)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-4">
              <Label htmlFor="bp-location-text">{t(`locText_${draft.locationType}`)} {optional}</Label>
              <Input id="bp-location-text" className="mt-1" value={draft.locationText} onChange={(event) => set("locationText", event.target.value)} />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("locTextHint")}</p>
            </div>
          </Step>

          <Step index={3} title={t("stepPrice")}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="bp-price">{t("fieldPrice")} {optional}</Label>
                <div className="relative mt-1">
                  <Input
                    id="bp-price"
                    className="pr-10 text-base font-bold tabular-nums"
                    inputMode="decimal"
                    value={draft.price}
                    placeholder={t("fieldPricePlaceholder")}
                    onChange={(event) => set("price", event.target.value.replace(/[^\d.,]/g, "").slice(0, 12))}
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted-foreground">{getCurrencySymbol(currency)}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{t("fieldPriceHint")}</p>
              </div>
              <div>
                <Label>{t("cycleQuestion")}</Label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {REPEAT_CYCLE_DAYS.map((days) => (
                    <Chip key={days} active={draft.repeatCycleDays === days} onClick={() => set("repeatCycleDays", days)}>
                      {days === 0 ? t("cycleNone") : t("cycleDays", { count: days })}
                    </Chip>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{t("fieldCycleHint")}</p>
              </div>
            </div>
          </Step>

          <Step
            index={4}
            title={t("fieldHosts")}
            aside={hosts.length > 1 ? (
              <button type="button" className="font-bold text-primary underline-offset-2 hover:underline" onClick={() => set("hostIds", hosts.map((host) => host.id))}>{t("hostsAll")}</button>
            ) : null}
          >
            <div className="flex flex-wrap gap-2">
              {hosts.map((host) => (
                <Chip key={host.id} active={draft.hostIds.includes(host.id)} onClick={() => toggleHost(host.id)} className="min-h-11 py-1 pl-1.5">
                  <BookingAvatar name={host.name} className="h-7 w-7 text-[11px]" />
                  <span className="truncate">{host.name}</span>
                  {draft.hostIds.includes(host.id) ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t("fieldHostsHint")}</p>
          </Step>

          <Step index={5} title={t("fieldHours")} aside={t("hoursOnLegend")}>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => {
                const active = Boolean(uniform) && open.length === preset.days.length && preset.days.every((day) => open.includes(day))
                return <Chip key={preset.key} active={active} onClick={() => set("weekly", applyWeekly(preset.days, base))}>{t(preset.key)}</Chip>
              })}
            </div>

            <div className="mt-3.5 flex flex-wrap gap-1.5" role="group" aria-label={t("fieldHours")}>
              {WEEK_ORDER.map((day) => {
                const on = open.includes(day)
                const interval = draft.weekly[day][0]
                return (
                  <button
                    key={day}
                    type="button"
                    data-crm-color-role="toggle"
                    aria-pressed={on}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      "flex h-14 w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary bg-primary text-primary-foreground shadow-[0_8px_16px_-10px_hsl(var(--primary))]" : "border-input bg-card",
                    )}
                  >
                    <span className="text-xs font-bold">{shortDay(day)}</span>
                    <span className={cn("text-[10px] tabular-nums", on ? "text-primary-foreground/85" : "text-muted-foreground")}>
                      {on && interval ? `${interval.start.slice(0, 2).replace(/^0/, "")}–${interval.end.slice(0, 2).replace(/^0/, "")}` : "—"}
                    </span>
                    <span className="sr-only">{t(`weekday_${day}`)}{on ? "" : ` · ${t("dayOff")}`}</span>
                  </button>
                )
              })}
            </div>

            {perDay ? null : (
              <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="font-semibold">{t("hoursSelectedDays")}</span>
                {/* The pair never splits across lines: «09:00 –» with its end
                    time on the next row reads as two different settings. The
                    width holds a 12-hour clock, which is what the field shows
                    when the browser is set to one. */}
                <span className="inline-flex items-center gap-2">
                  <Input type="time" className="h-10 w-32 text-center font-semibold" value={base.start} onChange={(event) => setUniformEdge("start", event.target.value)} aria-label={t("hoursFrom")} disabled={open.length === 0} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="time" className="h-10 w-32 text-center font-semibold" value={base.end} onChange={(event) => setUniformEdge("end", event.target.value)} aria-label={t("hoursTo")} disabled={open.length === 0} />
                </span>
              </div>
            )}

            <button type="button" className="mt-3 text-xs font-bold text-primary underline-offset-2 hover:underline" onClick={() => setPerDayOpen(!perDay)}>
              {perDay ? t("hoursPerDayClose") : t("hoursPerDay")}
            </button>

            {perDay ? (
              <div className="mt-2 space-y-1.5 border-t border-dashed pt-3">
                {uniform ? null : <p className="pb-1 text-xs font-semibold text-muted-foreground">{t("hoursDiffer")}</p>}
                {WEEK_ORDER.map((day) => {
                  const interval = draft.weekly[day][0]
                  return (
                    <div key={day} className="grid grid-cols-[minmax(96px,140px)_1fr] items-center gap-2 text-sm">
                      <span className={cn("truncate", interval ? "font-medium" : "text-muted-foreground")}>{t(`weekday_${day}`)}</span>
                      {interval ? (
                        <div className="flex items-center gap-2">
                          <Input type="time" className="h-9 w-32" value={interval.start} onChange={(event) => setDayEdge(day, "start", event.target.value)} aria-label={`${t(`weekday_${day}`)} ${t("hoursFrom")}`} />
                          <span className="text-muted-foreground">–</span>
                          <Input type="time" className="h-9 w-32" value={interval.end} onChange={(event) => setDayEdge(day, "end", event.target.value)} aria-label={`${t(`weekday_${day}`)} ${t("hoursTo")}`} />
                        </div>
                      ) : <span className="text-muted-foreground">{t("dayOff")}</span>}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </Step>

          <details className="group rounded-xl border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2.5 p-4 text-sm font-bold sm:p-5 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
              {t("advancedTitle")}
              <span className="ml-auto text-xs font-normal text-muted-foreground">{t("advancedHint")}</span>
            </summary>
            <div className="grid gap-4 px-4 pb-5 sm:px-5">
              <div>
                <Label>{t("fieldBuffer")}</Label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {BUFFERS.map((value) => <Chip key={value} active={draft.bufferMinutes === value} onClick={() => set("bufferMinutes", value)}>{value === 0 ? t("noBuffer") : t("minutes", { count: value })}</Chip>)}
                </div>
              </div>
              <div>
                <Label>{t("fieldNotice")}</Label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {NOTICE_HOURS.map((hours) => <Chip key={hours} active={draft.minNoticeMinutes === hours * 60} onClick={() => set("minNoticeMinutes", hours * 60)}>{t("hoursBefore", { count: hours })}</Chip>)}
                </div>
              </div>
              <div>
                <Label>{t("fieldAhead")}</Label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {AHEAD_DAYS.map((days) => <Chip key={days} active={draft.maxDaysAhead === days} onClick={() => set("maxDaysAhead", days)}>{t("daysAhead", { count: days })}</Chip>)}
                </div>
              </div>
            </div>
          </details>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-4">
          <p className="px-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">{t("previewTitle")}</p>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-md">
            <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-2">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-border" />
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-border" />
              <span className="ml-1 truncate text-[11px] text-muted-foreground">{linkBase}/{draft.slug || "…"}</span>
            </div>
            <div className="p-4">
              {draft.category.trim() ? <span className="inline-block rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-primary">{draft.category.trim()}</span> : null}
              <h4 className={cn("mt-2 text-lg font-extrabold tracking-tight", draft.title.trim() ? "" : "text-muted-foreground")}>{draft.title.trim() || t("previewNoTitle")}</h4>
              {draft.description.trim() ? <p className="mt-1 text-sm text-muted-foreground">{draft.description.trim()}</p> : null}
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center gap-2"><Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd>{t("minutes", { count: draft.durationMinutes })}</dd></div>
                <div className="flex items-center gap-2"><LocationIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd className="min-w-0 truncate">{t(`location_${draft.locationType}`)}{draft.locationText.trim() ? ` · ${draft.locationText.trim()}` : ""}</dd></div>
                {draft.price.trim() ? <div className="flex items-center gap-2"><Wallet className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd className="font-bold tabular-nums">{draft.price.trim()} {getCurrencySymbol(currency)}</dd></div> : null}
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {chosenHosts.slice(0, 4).map((host) => <BookingAvatar key={host.id} name={host.name} className="h-7 w-7 text-[11px]" />)}
                <span className="text-xs text-muted-foreground">
                  {chosenHosts.length === 0 ? t("previewNoHost") : chosenHosts.length === 1 ? chosenHosts[0].name : t("previewAnyHost")}
                </span>
              </div>
              {slots.length ? (
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  {slots.map((slot, index) => (
                    <span key={slot} className={cn("rounded-lg border py-1.5 text-center text-xs font-semibold tabular-nums", index === 1 ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground")}>{slot}</span>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 w-full rounded-lg bg-foreground py-2.5 text-center text-sm font-bold text-background">{t("previewBook")}</div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="mb-3 text-[13px] font-bold">{t("afterSaveTitle")}</p>
            <ol className="space-y-2.5">
              {[1, 2, 3].map((step) => (
                <li key={step} className="flex gap-2.5">
                  <span aria-hidden="true" className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-extrabold">{step}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold leading-snug">{t(`afterSave${step}`)}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">{t(`afterSave${step}Text`)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-t-xl border-t bg-card/95 px-4 py-3 shadow-[0_-6px_18px_-14px_rgba(16,24,40,.7)] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:rounded-xl sm:border">
        {missing.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("missingPrefix")} <span className="font-bold text-foreground">{missing.join(", ")}</span></span>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />{t("readyToSave")}
          </p>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>{t("cancel")}</Button>
          <Button onClick={onSave} disabled={saving || missing.length > 0 || !draft.slug}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t("save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
