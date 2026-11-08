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
 *
 * Four things here are borrowed from the programs a salon owner has already
 * used, because arguing with their habits buys nothing:
 *   — the strip of steps at the top, with what each one holds and what is still
 *     missing (Fresha and Altegio both put that list beside the form; a column
 *     would cost the preview its width, so it lies across the top instead);
 *   — the model writing the description (Fresha's «Generate with AI»), the one
 *     field an owner skips;
 *   — «save and add another», the way a price list of twenty services is
 *     actually entered (Dikidi);
 *   — copying one day's hours onto the rest (Calendly).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, Building2, Check, ChevronRight, CircleAlert, Clock3, Copy, ImagePlus, Link2, Loader2, Phone, Plus, Sparkles, Trash2, Undo2, Video, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { BookingAvatar } from "@/components/booking/booking-day-timeline"
import { applyWeekly, openWeekdays, uniformInterval, WEEKDAYS, type HoursInterval, type Weekday, type WeeklyHours } from "@/lib/booking/availability"
import { bookingSlug, REPEAT_CYCLE_DAYS } from "@/lib/booking/service"
import { servicePriceSpan, type HostVariants } from "@/lib/booking/host-variants"
import { addOnId, type ServiceAddOn } from "@/lib/booking/add-ons"
import { MAX_CAPACITY } from "@/lib/booking/group-service"
import { depositDue, depositPolicy } from "@/lib/booking/deposit"
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
  /** What single masters charge and how long they take, where they differ. */
  hostVariants: HostVariants
  /** Extras the customer may add when booking this service. */
  addOns: ServiceAddOn[]
  /** A path under /uploads/booking-photos, or none. */
  photoUrl: string | null
  /** 1 = one customer at a time; more makes it a class. */
  capacity: number
  /** What the customer leaves to hold the time: a sum, a share, or nothing. */
  depositAmount: string
  depositPercent: string
  depositFreeHours: number
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
/** The schema's own limits, shown as a counter once the field is in use. */
const TITLE_MAX = 120
const DESCRIPTION_MAX = 2000
const STEP_IDS = ["bp-step-service", "bp-step-where", "bp-step-price", "bp-step-addons", "bp-step-hosts", "bp-step-hours", "bp-step-advanced"] as const
/** 2024-01-07 was a Sunday, so weekday "0" lands on it and "6" on the Saturday after. */
const WEEKDAY_ANCHOR = Date.UTC(2024, 0, 7)
const DAY_MS = 86_400_000

/**
 * A selected choice, in the shared CRM chip style (crm-workspace.css).
 *
 * `filled` opts one group out of that style and into the colour the week strip
 * already uses — for the two questions where the answer is the whole point of
 * the step (how long, and where), the grey-on-grey selected state read as no
 * selection at all. Everything else stays in the house style, or this screen
 * would be the only one in the CRM that marks a choice differently.
 */
/**
 * A faint surface under a group of controls.
 *
 * Everything on one white plane reads as text on paper, whatever the shadows
 * do — that is where the flatness comes from, not from the corner radius. A
 * light fill under the choices puts the white fields on top of something, so
 * the sheet, the panel and the field become three depths instead of one.
 */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl bg-muted/40 p-3.5", className)}>{children}</div>
}

const CHIP_BASE = cn(
  "inline-flex min-h-10 items-center gap-2 rounded-full border border-input bg-card px-3.5 text-sm text-muted-foreground transition-colors",
  "hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
)

function Chip({ active, onClick, children, className, filled }: { active: boolean; onClick: () => void; children: ReactNode; className?: string; filled?: boolean }) {
  // The colour role is written out, not spread in: the source guard reads the
  // attribute, and an attribute it cannot read is an attribute that is not there.
  if (filled) {
    return (
      <button
        type="button"
        data-crm-color-role="toggle"
        aria-pressed={active}
        onClick={onClick}
        className={cn(CHIP_BASE, active && "border-primary bg-primary font-bold text-primary-foreground shadow-[0_8px_18px_-12px_hsl(var(--primary))] hover:border-primary", className)}
      >
        {children}
      </button>
    )
  }
  return (
    <button
      type="button"
      data-crm-filter=""
      data-state={active ? "active" : "inactive"}
      aria-pressed={active}
      onClick={onClick}
      className={cn(CHIP_BASE, active && "text-foreground", className)}
    >
      {children}
    </button>
  )
}

/**
 * One part of the form.
 *
 * Fresha and Altegio put the whole service on a single sheet divided by
 * hairlines, not in six separate cards with a coloured number on each: a card
 * is a thing of its own, and these six parts are one thing. The quiet comes
 * from that, from the space around the fields, and from the accent colour
 * being spent on one element per screen rather than on every link.
 */
function Section({ id, title, hint, aside, children }: { id: string; title: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 px-5 py-7 sm:px-8">
      <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[19px] font-bold tracking-tight">{title}</h3>
        {hint ? <p className="text-[13px] text-muted-foreground">{hint}</p> : null}
        {aside ? <div className="ml-auto text-xs text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

interface StepNavItem {
  id: string
  label: string
  /** What this step already holds, in as few characters as it can be said. */
  value: string
  /** The step is required and still empty — a dot, not a sentence: the save bar names them. */
  missing: boolean
}

/**
 * Where the owner is in the form, so the strip can follow them down the page.
 * The topmost section still on screen wins: by ratio alone a tall step further
 * down would steal the mark from the short one being filled in.
 */
function useActiveStep(ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return
    const sections = ids.map((id) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node))
    if (sections.length === 0) return
    const ratios = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.set(entry.target.id, entry.intersectionRatio)
        const visible = ids.filter((id) => (ratios.get(id) ?? 0) > 0)
        if (visible.length > 0) setActive(visible[0])
      },
      { rootMargin: "-88px 0px -55% 0px", threshold: [0, 0.01] },
    )
    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [ids])
  return active
}

/**
 * The index of the form, as Fresha and Altegio keep it: a quiet list beside
 * the sheet, each line saying what that part holds. It appears only where
 * there is room for a third column; on a narrower screen the form is one
 * scroll and the save bar says what is still missing.
 */
function StepIndex({ items, active, label }: { items: StepNavItem[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="hidden xl:block xl:border-r">
      <ol className="sticky top-4 space-y-0.5 p-3">
        {items.map((item) => {
          const current = active === item.id
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  current ? "bg-muted font-bold text-foreground" : "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.missing ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                ) : (
                  <span className="max-w-[76px] shrink-0 truncate text-[11px] font-normal text-muted-foreground">{item.value}</span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
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
  draft, hosts, categories, linkBase, currency, ai, saving, error, onChange, onSave, onCancel,
}: {
  draft: BookingPageDraft
  hosts: BookingHostOption[]
  /** The groups this organization already uses, so the field spells them the same way twice. */
  categories: string[]
  linkBase: string
  /** The code the price will be saved in — the symbol beside the field. */
  currency: string
  /** Whether this organization may ask the model to write the description. */
  ai: boolean
  saving: boolean
  error: string
  onChange: (draft: BookingPageDraft) => void
  /** `another` keeps the owner in the form with a fresh service, prefilled from this one. */
  onSave: (another?: boolean) => void
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
  const [perHostOpen, setPerHostOpen] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState("")
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState("")
  // What the field held before the model rewrote it. Improving text the owner
  // wrote must be undoable in one click, or nobody will dare press the button.
  const [replaced, setReplaced] = useState<string | null>(null)
  const activeStep = useActiveStep(STEP_IDS)

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

  /**
   * The file goes to the server, which decodes it and writes a plain raster of
   * its own; what comes back is the path the service stores. Nothing is saved
   * until the owner presses Save, so a picture picked and then abandoned stays
   * a file nobody references.
   */
  async function uploadPhoto(file: File) {
    setPhotoBusy(true)
    setPhotoError("")
    const body = new FormData()
    body.append("file", file)
    const response = await fetch("/api/v1/booking-pages/photo", { method: "POST", body }).catch(() => null)
    const payload = await response?.json().catch(() => null)
    setPhotoBusy(false)
    if (!response?.ok || !payload?.success || typeof payload?.data?.url !== "string") {
      setPhotoError(t(payload?.code === "TOO_LARGE" ? "photoTooLarge" : payload?.code === "WRONG_TYPE" ? "photoWrongType" : "photoFailed"))
      return
    }
    set("photoUrl", payload.data.url)
  }

  function addAddOn() {
    set("addOns", [...draft.addOns, { id: addOnId(draft.addOns), name: "", price: null, durationMinutes: 0 }])
  }
  function setAddOn(id: string, patch: Partial<ServiceAddOn>) {
    set("addOns", draft.addOns.map((addOn) => (addOn.id === id ? { ...addOn, ...patch } : addOn)))
  }
  function removeAddOn(id: string) {
    set("addOns", draft.addOns.filter((addOn) => addOn.id !== id))
  }

  /**
   * What one master charges, or how long they take. An empty field is «as the
   * service says» — not zero: a master with no answer keeps the service's own,
   * and that is what the field shows in grey while it is empty.
   */
  function setVariant(hostId: string, key: "price" | "durationMinutes", value: string) {
    const current = draft.hostVariants[hostId] ?? { price: null, durationMinutes: null }
    const cleaned = key === "price"
      ? (value.trim() ? value.replace(/[^\d.,]/g, "").slice(0, 12) : null)
      : (value.trim() ? Math.max(0, Math.min(600, Number(value.replace(/\D/g, "")) || 0)) : null)
    const next: HostVariants = { ...draft.hostVariants, [hostId]: { ...current, [key]: cleaned } }
    if (next[hostId].price === null && next[hostId].durationMinutes === null) delete next[hostId]
    set("hostVariants", next)
  }

  /**
   * Ask the model for the description. Nothing is saved: the answer lands in
   * the field, and the owner keeps it, edits it or takes the previous text
   * back before pressing Save.
   */
  async function writeDescription() {
    if (aiBusy || !draft.title.trim()) return
    setAiBusy(true)
    setAiError("")
    const before = draft.description
    const response = await fetch("/api/v1/booking-pages/describe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title.trim(),
        category: draft.category.trim() || null,
        durationMinutes: draft.durationMinutes,
        locationType: draft.locationType,
        price: draft.price.trim() || null,
        currency,
        current: draft.description.trim() || null,
        locale,
      }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setAiBusy(false)
    if (!response?.ok || !body?.success || typeof body?.data?.description !== "string") {
      setAiError(t("aiFailed"))
      return
    }
    setReplaced(before.trim() ? before : null)
    set("description", body.data.description)
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
  const symbol = getCurrencySymbol(currency)
  // What the client will be asked for, worked out exactly as the server does.
  const depositLabel = (() => {
    const due = depositDue(depositPolicy({
      depositAmount: draft.depositAmount.trim().replace(",", ".") || null,
      depositPercent: Number(draft.depositPercent) || null,
      depositFreeHours: draft.depositFreeHours,
    }), draft.price.trim() || null)
    return due ? `${due} ${symbol}` : ""
  })()
  const variantCount = chosenHosts.filter((host) => draft.hostVariants[host.id]).length
  const perHost = perHostOpen || variantCount > 0
  // What the client may end up paying when the masters do not agree.
  const span = servicePriceSpan({ price: draft.price.trim() || null, durationMinutes: draft.durationMinutes, hostVariants: draft.hostVariants }, draft.hostIds)
  const priceLabel = span.varies && span.min
    ? (span.max && span.max !== span.min ? `${span.min}–${span.max} ${symbol}` : `${span.min} ${symbol}`)
    : draft.price.trim() ? `${draft.price.trim()} ${symbol}` : ""
  const noticeHours = Math.round(draft.minNoticeMinutes / 60)
  // What the folded step holds, shown on its own summary line: three settings
  // nobody opens are still three settings that decide when a client may book.
  const advancedNote = [
    draft.bufferMinutes === 0 ? t("noBuffer") : t("minutes", { count: draft.bufferMinutes }),
    t("hoursBefore", { count: noticeHours }),
    t("daysAhead", { count: draft.maxDaysAhead }),
  ].join(" · ")
  // The index says what a part holds in as few characters as it can; what is
  // missing is a dot there and a sentence in the save bar, so the same warning
  // is not shouted twice.
  const stepItems: StepNavItem[] = [
    { id: STEP_IDS[0], label: t("stepService"), missing: !draft.title.trim(), value: draft.category.trim() },
    { id: STEP_IDS[1], label: t("idxWhere"), missing: false, value: t("minutes", { count: draft.durationMinutes }) },
    { id: STEP_IDS[2], label: t("stepPrice"), missing: false, value: priceLabel || "—" },
    { id: STEP_IDS[3], label: t("addOnsTitle"), missing: false, value: draft.addOns.length ? String(draft.addOns.length) : "—" },
    { id: STEP_IDS[4], label: t("idxHosts"), missing: chosenHosts.length === 0, value: String(chosenHosts.length) },
    { id: STEP_IDS[5], label: t("fieldHours"), missing: open.length === 0, value: open.length === 0 ? "" : t("daysCount", { count: open.length }) },
    { id: STEP_IDS[6], label: t("advancedTitle"), missing: false, value: "" },
  ]
  // Altegio puts the final price and duration under the form; here they sit in
  // the bar the eye is already on when it reaches for Save.
  const totals = [
    t("minutes", { count: draft.durationMinutes }),
    priceLabel || null,
    chosenHosts.length > 1 ? t("hostsCount", { count: chosenHosts.length }) : chosenHosts[0]?.name,
  ].filter(Boolean).join(" · ")

  return (
    // Below the three-column width the sheet is capped and centred: a form
    // field two thousand pixels wide is not a form field, it is a line.
    <div className="mx-auto max-w-4xl space-y-4 xl:max-w-none" data-testid="booking-page-editor">
      {/* One screen of its own, with its own name, its own index and its own
          preview — not a form with a list of sections parked beside it. */}
      {/* No `overflow-hidden` on purpose: it would turn this box into the
          scrollport of everything inside, and the index and the preview would
          stop following the page. The corners are rounded on the children. */}
      <div className="rounded-2xl border bg-card shadow-sm">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-5 py-5 sm:px-7 sm:py-6">
          <div className="min-w-0">
            <button type="button" onClick={onCancel} className="mb-0.5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{t("settingsTitle")}
            </button>
            <h2 className="truncate text-2xl font-extrabold tracking-tight sm:text-[28px]">{draft.title.trim() || t("newPage")}</h2>
            <p className="mt-0.5 hidden text-[13px] text-muted-foreground xl:block">{t("editorSubtitle")}</p>
          </div>
          {/* The one setting about the service as a whole rather than about one
              of its parts, so it sits with its name. */}
          <label className="ml-auto flex cursor-pointer items-center gap-2.5 rounded-full border bg-card px-3.5 py-2 text-sm font-semibold">
            <Switch checked={draft.isActive} onCheckedChange={(on) => set("isActive", on)} aria-label={t("fieldActive")} />
            {draft.isActive ? t("fieldActive") : t("statusOff")}
          </label>
        </header>

      <div className="grid xl:grid-cols-[212px_minmax(0,1fr)_340px]">
        <StepIndex items={stepItems} active={activeStep} label={t("stepsNav")} />

        <div className="min-w-0 divide-y">

          <Section id={STEP_IDS[0]} title={t("stepService")}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Label htmlFor="bp-title">{t("fieldTitle")}</Label>
              {draft.title.length > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{draft.title.length}/{TITLE_MAX}</span> : null}
            </div>
            <Input id="bp-title" className="mt-1 h-12 text-base font-semibold" maxLength={TITLE_MAX} autoFocus={!draft.id} value={draft.title} placeholder={t("fieldTitlePlaceholder")} onChange={(event) => setTitle(event.target.value)} />

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
              // The link is a fact about the service, not a field to fill in:
              // a boxed-in dashed row gave it the weight of one.
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="break-all font-medium text-foreground">{linkBase}/{draft.slug || "…"}</span>
                <button type="button" className="font-semibold underline-offset-4 hover:text-foreground hover:underline" onClick={() => { setLinkOpen(true); setLinkLocked(true) }}>{t("linkEdit")}</button>
                {linkLocked ? null : <span className="hidden sm:inline">· {t("linkAuto")}</span>}
              </div>
            )}

            <div className="mt-6">
              <Label>{t("fieldCategory")} {optional}</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {groups.map((name) => (
                  <Chip key={name} active={draft.category.trim() === name} onClick={() => { setNewCategory(false); set("category", draft.category.trim() === name ? "" : name) }}>{name}</Chip>
                ))}
                <button
                  type="button"
                  onClick={() => { setNewCategory(true); set("category", "") }}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-input bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                ><Plus className="h-3.5 w-3.5" aria-hidden="true" />{t("catNew")}</button>
              </div>
              {newCategory ? (
                <Input className="mt-2 max-w-xs" autoFocus value={draft.category} placeholder={t("fieldCategoryPlaceholder")} onChange={(event) => set("category", event.target.value.slice(0, 60))} />
              ) : null}
              <p className="mt-1.5 text-xs text-muted-foreground">{t("fieldCategoryHint")}</p>
            </div>

            <div className="mt-6">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <Label htmlFor="bp-description">{t("fieldDescription")} {optional}</Label>
                {draft.description.length > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{draft.description.length}/{DESCRIPTION_MAX}</span> : null}
              </div>
              <Textarea id="bp-description" className="mt-1" rows={2} maxLength={DESCRIPTION_MAX} value={draft.description} onChange={(event) => { setReplaced(null); set("description", event.target.value) }} />
              {ai ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void writeDescription()}
                    disabled={aiBusy || !draft.title.trim()}
                    // The one tinted control of the form: the accent is spent
                    // here, on the thing nobody expects a CRM to do for them.
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary/10 px-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  >
                    {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                    {draft.description.trim() ? t("aiEnhance") : t("aiWrite")}
                  </button>
                  {replaced !== null ? (
                    <button type="button" onClick={() => { set("description", replaced); setReplaced(null) }} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-input bg-card px-3 text-sm font-semibold transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Undo2 className="h-4 w-4" aria-hidden="true" />{t("aiUndo")}
                    </button>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{draft.title.trim() ? t("aiHint") : t("aiNeedTitle")}</span>
                </div>
              ) : null}
              {aiError ? <p className="mt-1.5 text-xs text-destructive" role="alert">{aiError}</p> : null}
            </div>

            {/* Square and Booksy both sell with a picture; the client sees it
                on the link before anything else. */}
            <div className="mt-6">
              <Label>{t("photoTitle")} {optional}</Label>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                {draft.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.photoUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl border object-cover" />
                ) : (
                  <span aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-input text-muted-foreground">
                    <ImagePlus className="h-5 w-5" />
                  </span>
                )}
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-input bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-within:ring-2 focus-within:ring-ring">
                  <input
                    type="file"
                    className="sr-only"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={photoBusy}
                    onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadPhoto(file) }}
                  />
                  {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                  {draft.photoUrl ? t("photoReplace") : t("photoAdd")}
                </label>
                {draft.photoUrl ? (
                  <button type="button" onClick={() => set("photoUrl", null)} className="text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:text-destructive hover:underline">{t("removeAction")}</button>
                ) : null}
                <span className="text-xs text-muted-foreground">{t("photoHint")}</span>
              </div>
              {photoError ? <p className="mt-1.5 text-xs text-destructive" role="alert">{photoError}</p> : null}
            </div>
          </Section>

          <Section id={STEP_IDS[1]} title={t("stepWhere")}>
            <Label>{t("fieldDuration")}</Label>
            <Panel className="mt-1.5 flex flex-wrap gap-2">
              {DURATIONS.map((value) => (
                <Chip key={value} filled active={!customDuration && draft.durationMinutes === value} onClick={() => { setCustomDuration(false); set("durationMinutes", value) }}>{t("minutes", { count: value })}</Chip>
              ))}
              <button
                type="button"
                onClick={() => setCustomDuration(true)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-input bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              ><Plus className="h-3.5 w-3.5" aria-hidden="true" />{t("durationOther")}</button>
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
            </Panel>

            <div className="mt-6">
              <Label htmlFor="bp-capacity">{t("fieldCapacity")}</Label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                <Input
                  id="bp-capacity"
                  className="h-10 w-24 tabular-nums"
                  inputMode="numeric"
                  value={String(draft.capacity)}
                  onChange={(event) => set("capacity", Math.max(1, Math.min(MAX_CAPACITY, Number(event.target.value.replace(/\D/g, "")) || 1)))}
                />
                <span className="text-xs text-muted-foreground">{draft.capacity > 1 ? t("capacityGroup") : t("capacityOne")}</span>
              </div>
            </div>

            <div className="mt-6">
              <Label>{t("fieldLocation")}</Label>
              <Panel className="mt-1.5 grid gap-2 sm:grid-cols-3">
                {LOCATIONS.map((value) => {
                  const Icon = LOCATION_ICON[value]
                  const active = draft.locationType === value
                  return (
                    <button
                      key={value}
                      type="button"
                      data-crm-color-role="toggle"
                      aria-pressed={active}
                      onClick={() => set("locationType", value)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border border-input bg-card p-3 text-left transition-colors",
                        "hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active && "border-primary bg-primary text-primary-foreground shadow-[0_10px_20px_-14px_hsl(var(--primary))]",
                      )}
                    >
                      {/* The icon takes the accent only on the chosen one: three
                          tinted squares in a row say nothing about the choice. */}
                      <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground")}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0">
                        <span className={cn("block truncate text-sm font-semibold", active ? "text-primary-foreground" : "text-foreground")}>{t(`location_${value}`)}</span>
                        <span className={cn("block truncate text-xs", active ? "text-primary-foreground/80" : "text-muted-foreground")}>{t(`locHint_${value}`)}</span>
                      </span>
                    </button>
                  )
                })}
              </Panel>
            </div>

            <div className="mt-6">
              <Label htmlFor="bp-location-text">{t(`locText_${draft.locationType}`)} {optional}</Label>
              <Input id="bp-location-text" className="mt-1" value={draft.locationText} onChange={(event) => set("locationText", event.target.value)} />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("locTextHint")}</p>
            </div>
          </Section>

          <Section id={STEP_IDS[2]} title={t("stepPrice")}>
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
              <div className="md:col-span-2">
                <Label>{t("fieldDeposit")} {optional}</Label>
                <Panel className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="relative inline-flex">
                    <Input
                      className="h-10 w-28 pr-7 tabular-nums"
                      inputMode="decimal"
                      value={draft.depositAmount}
                      placeholder={t("depositSum")}
                      aria-label={t("depositSum")}
                      onChange={(event) => onChange({ ...draft, depositAmount: event.target.value.replace(/[^\d.,]/g, "").slice(0, 12), depositPercent: "" })}
                    />
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-semibold text-muted-foreground">{symbol}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{t("or")}</span>
                  <span className="relative inline-flex">
                    <Input
                      className="h-10 w-24 pr-7 tabular-nums"
                      inputMode="numeric"
                      value={draft.depositPercent}
                      placeholder={t("depositShare")}
                      aria-label={t("depositShare")}
                      onChange={(event) => onChange({ ...draft, depositPercent: event.target.value.replace(/\D/g, "").slice(0, 3), depositAmount: "" })}
                    />
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-semibold text-muted-foreground">%</span>
                  </span>
                  {depositLabel ? <span className="text-xs font-semibold text-foreground">= {depositLabel}</span> : <span className="text-xs text-muted-foreground">{t("depositNone")}</span>}
                </Panel>
                {depositLabel ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Label htmlFor="bp-deposit-hours" className="text-xs">{t("depositFreeHoursLabel")}</Label>
                    <Input
                      id="bp-deposit-hours"
                      className="h-9 w-20 tabular-nums"
                      inputMode="numeric"
                      value={String(draft.depositFreeHours)}
                      onChange={(event) => set("depositFreeHours", Math.max(0, Math.min(720, Number(event.target.value.replace(/\D/g, "")) || 0)))}
                    />
                    <span className="text-xs text-muted-foreground">{t("depositHint")}</span>
                  </div>
                ) : null}
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
          </Section>

          {/* Fresha's «service add-ons»: the treatment that goes with the cut.
              Each one costs money AND takes time — a visit that charges for
              the extra without holding the chair double-books the master. */}
          <Section id={STEP_IDS[3]} title={t("addOnsTitle")} hint={t("addOnsHint")}>
            {draft.addOns.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("addOnsEmpty")}</p>
            ) : (
              <div className="space-y-2.5">
                {draft.addOns.map((addOn) => (
                  <div key={addOn.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <Input
                      className="h-10"
                      value={addOn.name}
                      maxLength={60}
                      placeholder={t("addOnNamePlaceholder")}
                      aria-label={t("addOnName")}
                      onChange={(event) => setAddOn(addOn.id, { name: event.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="relative inline-flex">
                        <Input
                          className="h-10 w-28 pr-7 tabular-nums"
                          inputMode="decimal"
                          value={addOn.price ?? ""}
                          placeholder="—"
                          aria-label={`${addOn.name || t("addOnName")}: ${t("fieldPrice")}`}
                          onChange={(event) => setAddOn(addOn.id, { price: event.target.value.trim() ? event.target.value.replace(/[^\d.,]/g, "").slice(0, 12) : null })}
                        />
                        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-semibold text-muted-foreground">{symbol}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">+</span>
                        <Input
                          className="h-10 w-20 tabular-nums"
                          inputMode="numeric"
                          value={addOn.durationMinutes ? String(addOn.durationMinutes) : ""}
                          placeholder="0"
                          aria-label={`${addOn.name || t("addOnName")}: ${t("fieldDuration")}`}
                          onChange={(event) => setAddOn(addOn.id, { durationMinutes: Math.max(0, Math.min(240, Number(event.target.value.replace(/\D/g, "")) || 0)) })}
                        />
                        <span className="text-xs text-muted-foreground">{t("minutesShort")}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAddOn(addOn.id)}
                        aria-label={`${t("removeAction")}: ${addOn.name || t("addOnName")}`}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={addAddOn}
              disabled={draft.addOns.length >= 12}
              className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-input bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            ><Plus className="h-3.5 w-3.5" aria-hidden="true" />{t("addOnAdd")}</button>
          </Section>

          <Section
            id={STEP_IDS[4]}
            title={t("fieldHosts")}
            aside={hosts.length > 1 ? (
              <button type="button" className="font-semibold underline-offset-4 hover:text-foreground hover:underline" onClick={() => set("hostIds", hosts.map((host) => host.id))}>{t("hostsAll")}</button>
            ) : null}
          >
            <Panel className="flex flex-wrap gap-2">
              {hosts.map((host) => (
                <Chip key={host.id} active={draft.hostIds.includes(host.id)} onClick={() => toggleHost(host.id)} className="min-h-11 py-1 pl-1.5">
                  <BookingAvatar name={host.name} className="h-7 w-7 text-[11px]" />
                  <span className="truncate">{host.name}</span>
                  {draft.hostIds.includes(host.id) ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                </Chip>
              ))}
            </Panel>
            <p className="mt-2 text-xs text-muted-foreground">{t("fieldHostsHint")}</p>

            {/* Altegio, Square and Dikidi all carry this: the senior master
                takes an hour and charges forty, the junior forty minutes and
                twenty-five. Empty means «as the service says». */}
            {chosenHosts.length > 0 ? (
              <button type="button" className="mt-4 text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setPerHostOpen(!perHost)}>
                {perHost ? t("hostPricesClose") : t("hostPrices")}
              </button>
            ) : null}

            {perHost && chosenHosts.length > 0 ? (
              <div className="mt-3 space-y-2.5 border-t pt-4">
                <p className="text-xs text-muted-foreground">{t("hostPricesHint")}</p>
                {chosenHosts.map((host) => {
                  const variant = draft.hostVariants[host.id]
                  return (
                    <div key={host.id} className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[minmax(120px,190px)_1fr] sm:items-center sm:gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <BookingAvatar name={host.name} className="h-6 w-6 text-[10px]" />
                        <span className="truncate font-medium">{host.name}</span>
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="relative inline-flex">
                          <Input
                            className="h-9 w-28 pr-7 tabular-nums"
                            inputMode="decimal"
                            value={variant?.price ?? ""}
                            placeholder={draft.price.trim() || "—"}
                            aria-label={`${host.name}: ${t("fieldPrice")}`}
                            onChange={(event) => setVariant(host.id, "price", event.target.value)}
                          />
                          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-semibold text-muted-foreground">{symbol}</span>
                        </span>
                        <Input
                          className="h-9 w-24 tabular-nums"
                          inputMode="numeric"
                          value={variant?.durationMinutes === null || variant?.durationMinutes === undefined ? "" : String(variant.durationMinutes)}
                          placeholder={String(draft.durationMinutes)}
                          aria-label={`${host.name}: ${t("fieldDuration")}`}
                          onChange={(event) => setVariant(host.id, "durationMinutes", event.target.value)}
                        />
                        <span className="text-xs text-muted-foreground">{t("minutesShort")}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </Section>

          <Section id={STEP_IDS[5]} title={t("fieldHours")} aside={t("hoursOnLegend")}>
            <Panel>
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

            </Panel>

            <button type="button" className="mt-4 text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setPerDayOpen(!perDay)}>
              {perDay ? t("hoursPerDayClose") : t("hoursPerDay")}
            </button>

            {perDay ? (
              <div className="mt-3 space-y-2.5 border-t pt-4">
                {uniform ? null : <p className="pb-1 text-xs font-semibold text-muted-foreground">{t("hoursDiffer")}</p>}
                {WEEK_ORDER.map((day) => {
                  const interval = draft.weekly[day][0]
                  return (
                    // On a phone the day stands on its own line: two time
                    // fields and the copy button are wider than the screen is
                    // once a weekday name sits beside them.
                    <div key={day} className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[minmax(96px,140px)_1fr] sm:items-center sm:gap-2">
                      <span className={cn("truncate", interval ? "font-medium" : "text-muted-foreground")}>{t(`weekday_${day}`)}</span>
                      {interval ? (
                        <div className="flex items-center gap-2">
                          <Input type="time" className="h-9 w-32" value={interval.start} onChange={(event) => setDayEdge(day, "start", event.target.value)} aria-label={`${t(`weekday_${day}`)} ${t("hoursFrom")}`} />
                          <span className="text-muted-foreground">–</span>
                          <Input type="time" className="h-9 w-32" value={interval.end} onChange={(event) => setDayEdge(day, "end", event.target.value)} aria-label={`${t(`weekday_${day}`)} ${t("hoursTo")}`} />
                          {/* Calendly's copy button: a salon that works 9–18 and
                              10–16 on Saturday sets one row, then presses this. */}
                          {open.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => set("weekly", applyWeekly(open, interval))}
                              title={t("hoursCopy")}
                              aria-label={`${t(`weekday_${day}`)}: ${t("hoursCopy")}`}
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Copy className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      ) : <span className="text-muted-foreground">{t("dayOff")}</span>}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </Section>

          {/* Calendly folds a step down to one line with its current answer on
              it; the three settings here are exactly that kind of step. */}
          <details id={STEP_IDS[6]} className="group scroll-mt-24">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2.5 px-5 py-6 text-[19px] font-bold tracking-tight sm:px-8 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
              {t("advancedTitle")}
              <span className="ml-auto text-[13px] font-normal text-muted-foreground group-open:hidden">{advancedNote}</span>
              <span className="ml-auto hidden text-[13px] font-normal text-muted-foreground group-open:inline">{t("advancedHint")}</span>
            </summary>
            <div className="grid gap-5 px-5 pb-7 sm:px-8">
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

        <aside className="rounded-b-2xl border-t bg-muted/25 p-5 xl:rounded-b-none xl:rounded-br-2xl xl:border-l xl:border-t-0">
          <div className="space-y-3 xl:sticky xl:top-4">
          <p className="px-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">{t("previewTitle")}</p>
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-2">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-border" />
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-border" />
              <span className="ml-1 truncate text-[11px] text-muted-foreground">{linkBase}/{draft.slug || "…"}</span>
            </div>
            {draft.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.photoUrl} alt="" className="h-32 w-full object-cover" />
            ) : null}
            <div className="p-5">
              {draft.category.trim() ? <span className="inline-block rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-primary">{draft.category.trim()}</span> : null}
              <h4 className={cn("mt-2 text-lg font-extrabold tracking-tight", draft.title.trim() ? "" : "text-muted-foreground")}>{draft.title.trim() || t("previewNoTitle")}</h4>
              {draft.description.trim() ? <p className="mt-1 text-sm text-muted-foreground">{draft.description.trim()}</p> : null}
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center gap-2"><Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd>{t("minutes", { count: draft.durationMinutes })}</dd></div>
                <div className="flex items-center gap-2"><LocationIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd className="min-w-0 truncate">{t(`location_${draft.locationType}`)}{draft.locationText.trim() ? ` · ${draft.locationText.trim()}` : ""}</dd></div>
                {priceLabel ? <div className="flex items-center gap-2"><Wallet className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd className="font-bold tabular-nums">{priceLabel}</dd></div> : null}
              </dl>
              {draft.addOns.filter((addOn) => addOn.name.trim()).length > 0 ? (
                <ul className="mt-3 space-y-1 border-t pt-2.5">
                  {draft.addOns.filter((addOn) => addOn.name.trim()).map((addOn) => (
                    <li key={addOn.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-muted-foreground">+ {addOn.name.trim()}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{addOn.price ? `${addOn.price} ${symbol}` : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
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
            <p className="mb-3.5 text-[13px] font-bold">{t("afterSaveTitle")}</p>
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
          </div>
        </aside>
      </div>
      </div>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-t-2xl border-t bg-card/95 px-5 py-3.5 shadow-[0_-6px_18px_-14px_rgba(16,24,40,.7)] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:rounded-2xl sm:border">
        {missing.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("missingPrefix")} <span className="font-bold text-foreground">{missing.join(", ")}</span></span>
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />{t("readyToSave")}
            </span>
            <span className="text-muted-foreground">{totals}</span>
          </p>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>{t("cancel")}</Button>
          {/* A price list is entered in one sitting: saving must not throw the
              owner back to the list to press «New service» twenty times. */}
          {draft.id ? null : (
            <Button variant="outline" onClick={() => onSave(true)} disabled={saving || missing.length > 0 || !draft.slug}>{t("saveAnother")}</Button>
          )}
          <Button onClick={() => onSave()} disabled={saving || missing.length > 0 || !draft.slug}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t("save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
