"use client"

/**
 * «Комнаты и места»: the things a meeting goes on that are not people.
 *
 * The module was built for salons, so everything bookable was a master. A
 * coworking books rooms and nobody does them, and until now the only way to
 * say that was to create a fake employee — one that takes a seat in the plan,
 * needs a role and could sign in (owner, 2026-11-12).
 *
 * The screen is deliberately the shape of the thing it edits: a list of rooms,
 * each opening in place to its name and its hours, and nothing else. The one
 * sentence at the top says what a resource IS, because the word means nothing
 * until it is read next to «переговорная» and «кресло».
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { DoorOpen, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WEEKDAYS, defaultWeeklyHours, type WeeklyHours } from "@/lib/booking/availability"
import { useBookingWords } from "./booking-words"

interface Resource {
  id: string
  name: string
  weekly: unknown
  isActive: boolean
  upcoming: number
}

/** Monday first: the week a person in Baku reads. */
const WEEK_ORDER = [...WEEKDAYS.slice(1), WEEKDAYS[0]]

function readWeekly(value: unknown): WeeklyHours | null {
  if (!value || typeof value !== "object") return null
  const source = value as Record<string, { start?: unknown; end?: unknown }[] | undefined>
  const weekly = {} as WeeklyHours
  for (const day of WEEKDAYS) {
    weekly[day] = (Array.isArray(source[day]) ? source[day]! : [])
      .filter((item) => typeof item?.start === "string" && typeof item?.end === "string")
      .map((item) => ({ start: item.start as string, end: item.end as string }))
  }
  return weekly
}

export function BookingResourcesPanel() {
  const t = useTranslations("booking")
  const words = useBookingWords()
  const [resources, setResources] = useState<Resource[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [weekly, setWeekly] = useState<WeeklyHours | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/v1/booking-pages/resources", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (body?.success && !controller.signal.aborted) setResources(body.data.resources) })
      .catch(() => { if (!controller.signal.aborted) setError(t("errLoad")) })
    return () => controller.abort()
  }, [t])

  function open(resource: Resource | null) {
    setError("")
    setEditing(resource?.id ?? "new")
    setName(resource?.name ?? "")
    setWeekly(readWeekly(resource?.weekly))
  }

  async function save() {
    if (!name.trim()) return
    setBusy(true); setError("")
    const isNew = editing === "new"
    const response = await fetch("/api/v1/booking-pages/resources", {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(isNew ? {} : { id: editing }), name: name.trim(), weekly }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setBusy(false)
    if (!response?.ok || !body?.success) { setError(t(body?.code === "TOO_MANY" ? "resourcesTooMany" : "errSave")); return }
    const saved: Resource = { upcoming: 0, ...body.data.resource }
    setResources((current) => isNew
      ? [...(current ?? []), saved]
      : (current ?? []).map((item) => item.id === saved.id ? { ...item, ...saved } : item))
    setEditing(null)
  }

  async function switchOff(resource: Resource) {
    setBusy(true); setError("")
    const response = await fetch(`/api/v1/booking-pages/resources?id=${encodeURIComponent(resource.id)}`, { method: "DELETE" }).catch(() => null)
    setBusy(false)
    if (!response?.ok) { setError(t("errSave")); return }
    setResources((current) => (current ?? []).map((item) => item.id === resource.id ? { ...item, isActive: false } : item))
    if (editing === resource.id) setEditing(null)
  }

  function setDay(day: (typeof WEEKDAYS)[number], open: boolean) {
    const base = weekly ?? defaultWeeklyHours()
    const fallback = base["1"][0] ?? { start: "09:00", end: "18:00" }
    setWeekly({ ...base, [day]: open ? [{ ...fallback }] : [] })
  }
  function setHours(day: (typeof WEEKDAYS)[number], edge: "start" | "end", value: string) {
    const base = weekly ?? defaultWeeklyHours()
    const current = base[day][0] ?? { start: "09:00", end: "18:00" }
    setWeekly({ ...base, [day]: [{ ...current, [edge]: value }] })
  }

  /** The same fields whether a room is being made or changed. */
  const form = <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
    <div className="w-64 space-y-1">
      <Label htmlFor="resource-name">{t("resourceName")}</Label>
      <Input
        id="resource-name"
        value={name}
        placeholder={t("resourceNamePlaceholder")}
        maxLength={80}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        className="min-h-11"
      />
    </div>
    {/* Hours of its own are the exception: a room is open when the service is
        open until somebody says otherwise, exactly like a master. */}
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <Checkbox checked={weekly !== null} disabled={busy} onCheckedChange={(on) => setWeekly(on ? defaultWeeklyHours() : null)} />
      {t("resourceOwnHours")}
    </label>
    {weekly ? <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{t("fieldHours")}</legend>
      {WEEK_ORDER.map((day) => {
        const interval = weekly[day][0]
        return <div key={day} className="grid grid-cols-[140px_1fr] items-center gap-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={Boolean(interval)} disabled={busy} onCheckedChange={(on) => setDay(day, on === true)} />
            {t(`weekday_${day}`)}
          </label>
          {interval ? <div className="flex items-center gap-2">
            <Input type="time" className="h-9 w-28" disabled={busy} value={interval.start} onChange={(event) => setHours(day, "start", event.target.value)} aria-label={`${t(`weekday_${day}`)} ${t("fieldHours")}`} />
            <span className="text-muted-foreground">–</span>
            <Input type="time" className="h-9 w-28" disabled={busy} value={interval.end} onChange={(event) => setHours(day, "end", event.target.value)} aria-label={`${t(`weekday_${day}`)} ${t("fieldHours")}`} />
          </div> : <span className="text-muted-foreground">{t("dayOff")}</span>}
        </div>
      })}
    </fieldset> : null}
    <div className="flex items-center gap-2 border-t pt-3">
      <Button disabled={busy || !name.trim()} onClick={() => void save()}>{t("save")}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>{t("cancel")}</Button>
    </div>
  </div>

  return <section className="rounded-2xl border bg-card p-5 shadow-sm">
    <header className="mb-4 flex flex-wrap items-start gap-3">
      <DoorOpen className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{t("resourcesTitle")}</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("resourcesHint")}</p>
      </div>
      {editing === "new" ? null : <Button className="ml-auto" variant="outline" disabled={busy} onClick={() => open(null)}>
        <Plus className="h-4 w-4" aria-hidden="true" />{t("resourceAdd")}
      </Button>}
    </header>

    {resources === null ? <p role="status">{t("workspaceLoading")}</p> : <ul className="space-y-2">
      {resources.map((resource) => <li key={resource.id} className="rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{resource.name}{resource.isActive ? "" : ` · ${t("resourceOff")}`}</p>
            <p className="truncate text-xs text-muted-foreground">
              {readWeekly(resource.weekly) ? t("resourceOwnHoursShort") : t("scheduleCustomNone")}
              {resource.upcoming ? ` · ${t("resourceUpcoming", { count: resource.upcoming })}` : ""}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => open(editing === resource.id ? null : resource)}>{t("edit")}</Button>
            {resource.isActive ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void switchOff(resource)} className="text-muted-foreground hover:text-destructive">{t("resourceSwitchOff")}</Button> : null}
          </div>
        </div>
        {editing === resource.id ? form : null}
      </li>)}
    </ul>}

    {editing === "new" ? form : null}
    {resources?.length === 0 && editing !== "new"
      ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("resourcesEmpty", { item: words.item })}</p>
      : null}
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
  </section>
}
