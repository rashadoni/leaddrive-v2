"use client"

/**
 * One booking page's settings: what the meeting is, who takes it, when.
 * Working hours are one interval per weekday — the common case; a lunch break
 * is what «Break between meetings» and a shorter day are for.
 */
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Hint } from "@/components/hint"
import { WEEKDAYS, type WeeklyHours } from "@/lib/booking/availability"

export interface BookingPageDraft {
  id?: string
  title: string
  slug: string
  description: string
  durationMinutes: number
  locationType: "office" | "phone" | "online"
  locationText: string
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
// Monday first: the week a person in Baku reads.
const WEEK_ORDER = [...WEEKDAYS.slice(1), WEEKDAYS[0]]

const selectClass = "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"

export function BookingPageEditor({
  draft, hosts, linkBase, saving, error, onChange, onSave, onCancel,
}: {
  draft: BookingPageDraft
  hosts: BookingHostOption[]
  linkBase: string
  saving: boolean
  error: string
  onChange: (draft: BookingPageDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  const t = useTranslations("booking")
  const set = <K extends keyof BookingPageDraft>(key: K, value: BookingPageDraft[K]) => onChange({ ...draft, [key]: value })

  function setDay(day: (typeof WEEKDAYS)[number], open: boolean) {
    const fallback = draft.weekly["1"][0] ?? { start: "09:00", end: "18:00" }
    set("weekly", { ...draft.weekly, [day]: open ? [{ ...fallback }] : [] })
  }
  function setHours(day: (typeof WEEKDAYS)[number], edge: "start" | "end", value: string) {
    const current = draft.weekly[day][0] ?? { start: "09:00", end: "18:00" }
    set("weekly", { ...draft.weekly, [day]: [{ ...current, [edge]: value }] })
  }
  function toggleHost(id: string, on: boolean) {
    set("hostIds", on ? [...draft.hostIds, id] : draft.hostIds.filter((hostId) => hostId !== id))
  }

  return (
    <div className="space-y-6" data-testid="booking-page-editor">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="bp-title">{t("fieldTitle")}</Label>
          <Input id="bp-title" className="mt-1" value={draft.title} placeholder={t("fieldTitlePlaceholder")} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="bp-slug">{t("fieldSlug")}</Label>
          <div className="mt-1 flex items-center rounded-md border border-input bg-background text-sm">
            <span className="whitespace-nowrap pl-3 text-muted-foreground">{linkBase}/</span>
            <input
              id="bp-slug"
              className="h-10 min-w-0 flex-1 bg-transparent pr-3 outline-none"
              value={draft.slug}
              onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 60))}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("fieldSlugHint")}</p>
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="bp-description">{t("fieldDescription")}</Label>
          <Textarea id="bp-description" className="mt-1" rows={2} value={draft.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="bp-duration">{t("fieldDuration")}</Label>
          <select id="bp-duration" className={selectClass} value={draft.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))}>
            {DURATIONS.map((value) => <option key={value} value={value}>{t("minutes", { count: value })}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="bp-location">{t("fieldLocation")}</Label>
          <select id="bp-location" className={selectClass} value={draft.locationType} onChange={(e) => set("locationType", e.target.value as BookingPageDraft["locationType"])}>
            {(["office", "phone", "online"] as const).map((value) => <option key={value} value={value}>{t(`location_${value}`)}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="bp-location-text">{t("fieldLocationText")}</Label>
          <Input id="bp-location-text" className="mt-1" value={draft.locationText} onChange={(e) => set("locationText", e.target.value)} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("fieldHosts")}</legend>
          <p className="text-xs text-muted-foreground">{t("fieldHostsHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {hosts.map((host) => (
              <label key={host.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Checkbox checked={draft.hostIds.includes(host.id)} onCheckedChange={(on) => toggleHost(host.id, on)} />
                {host.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("fieldHours")}</legend>
          {WEEK_ORDER.map((day) => {
            const interval = draft.weekly[day][0]
            return (
              <div key={day} className="grid grid-cols-[140px_1fr] items-center gap-2 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox checked={Boolean(interval)} onCheckedChange={(on) => setDay(day, on)} />
                  {t(`weekday_${day}`)}
                </label>
                {interval ? (
                  <div className="flex items-center gap-2">
                    <Input type="time" className="h-9 w-28" value={interval.start} onChange={(e) => setHours(day, "start", e.target.value)} aria-label={`${t(`weekday_${day}`)} start`} />
                    <span className="text-muted-foreground">–</span>
                    <Input type="time" className="h-9 w-28" value={interval.end} onChange={(e) => setHours(day, "end", e.target.value)} aria-label={`${t(`weekday_${day}`)} end`} />
                  </div>
                ) : (
                  <span className="text-muted-foreground">{t("dayOff")}</span>
                )}
              </div>
            )
          })}
        </fieldset>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="bp-buffer">{t("fieldBuffer")}</Label>
          <select id="bp-buffer" className={selectClass} value={draft.bufferMinutes} onChange={(e) => set("bufferMinutes", Number(e.target.value))}>
            {BUFFERS.map((value) => <option key={value} value={value}>{value === 0 ? t("noBuffer") : t("minutes", { count: value })}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="bp-notice">{t("fieldNotice")}</Label>
          <select id="bp-notice" className={selectClass} value={draft.minNoticeMinutes} onChange={(e) => set("minNoticeMinutes", Number(e.target.value))}>
            {NOTICE_HOURS.map((hours) => <option key={hours} value={hours * 60}>{t("hoursBefore", { count: hours })}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="bp-ahead">{t("fieldAhead")}</Label>
          <select id="bp-ahead" className={selectClass} value={draft.maxDaysAhead} onChange={(e) => set("maxDaysAhead", Number(e.target.value))}>
            {AHEAD_DAYS.map((days) => <option key={days} value={days}>{t("daysAhead", { count: days })}</option>)}
          </select>
        </div>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
        <Checkbox checked={draft.isActive} onCheckedChange={(on) => set("isActive", on)} />
        {t("fieldActive")}
      </label>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Hint text={draft.hostIds.length === 0 ? t("errHostsRequired") : null} wrap>
          <Button onClick={onSave} disabled={saving || !draft.title.trim() || !draft.slug || draft.hostIds.length === 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t("save")}
          </Button>
        </Hint>
        <Button variant="outline" onClick={onCancel} disabled={saving}>{t("cancel")}</Button>
      </div>
    </div>
  )
}
