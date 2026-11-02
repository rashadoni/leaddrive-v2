"use client"

/**
 * When each host actually works. The booking page already says when a service
 * is offered; in a salon that is not enough — the page is open six days a
 * week and Leyla does not work Tuesdays. Free time is the intersection, and
 * a host left on «the page's hours» behaves exactly as before.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WEEKDAYS, defaultWeeklyHours, type WeeklyHours } from "@/lib/booking/availability"

interface ScheduleData {
  users: { id: string; name: string }[]
  schedules: { userId: string; weekly: unknown }[]
}

/** Monday first: the week a person in Baku reads. */
const WEEK_ORDER = [...WEEKDAYS.slice(1), WEEKDAYS[0]]

function readWeekly(value: unknown): WeeklyHours | null {
  if (!value || typeof value !== "object") return null
  const source = value as Record<string, { start?: unknown; end?: unknown }[] | undefined>
  const weekly = {} as WeeklyHours
  for (const day of WEEKDAYS) {
    const list = Array.isArray(source[day]) ? source[day]! : []
    weekly[day] = list
      .filter((item) => typeof item?.start === "string" && typeof item?.end === "string")
      .map((item) => ({ start: item.start as string, end: item.end as string }))
  }
  return weekly
}

export function BookingHostSchedulePanel() {
  const t = useTranslations("booking")
  const [data, setData] = useState<ScheduleData | null>(null)
  const [host, setHost] = useState("")
  const [weekly, setWeekly] = useState<WeeklyHours | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/v1/bookings/host-schedules", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json()
      if (!response.ok || !body.success) throw new Error("load")
      if (!controller.signal.aborted) setData(body.data)
    }).catch(() => { if (!controller.signal.aborted) setError(t("errLoad")) })
    return () => controller.abort()
  }, [t])

  function choose(id: string) {
    setHost(id); setSaved(false); setError("")
    setWeekly(readWeekly(data?.schedules.find((row) => row.userId === id)?.weekly))
  }
  function setDay(day: (typeof WEEKDAYS)[number], open: boolean) {
    const base = weekly ?? defaultWeeklyHours()
    const fallback = base["1"][0] ?? { start: "09:00", end: "18:00" }
    setWeekly({ ...base, [day]: open ? [{ ...fallback }] : [] }); setSaved(false)
  }
  function setHours(day: (typeof WEEKDAYS)[number], edge: "start" | "end", value: string) {
    const base = weekly ?? defaultWeeklyHours()
    const current = base[day][0] ?? { start: "09:00", end: "18:00" }
    setWeekly({ ...base, [day]: [{ ...current, [edge]: value }] }); setSaved(false)
  }
  async function save(next: WeeklyHours | null) {
    if (!host || !data) return
    setBusy(true); setError(""); setSaved(false)
    const response = await fetch("/api/v1/bookings/host-schedules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: host, weekly: next }) }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setBusy(false)
    if (!response?.ok || !body?.success) { setError(t(body?.code === "SCHEDULE_EMPTY" ? "scheduleEmpty" : "errSave")); return }
    setData({ ...data, schedules: [...data.schedules.filter((row) => row.userId !== host), ...(next ? [{ userId: host, weekly: next }] : [])] })
    setWeekly(next); setSaved(true)
  }

  const own = weekly !== null
  return <section className="max-w-2xl space-y-5">
    <header><h2 className="text-lg font-semibold">{t("scheduleTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("scheduleHint")}</p></header>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {!data ? <p role="status">{t("workspaceLoading")}</p> : <>
      <div className="space-y-2">
        <Label htmlFor="booking-schedule-host">{t("schedulePerson")}</Label>
        <select id="booking-schedule-host" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" value={host} disabled={busy} onChange={(event) => choose(event.target.value)}>
          <option value="">{t("chooseEmployee")}</option>
          {data.users.map((user) => <option value={user.id} key={user.id}>{user.name}{data.schedules.some((row) => row.userId === user.id) ? "" : ` · ${t("schedulePageHours")}`}</option>)}
        </select>
      </div>
      {host ? <>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <Checkbox checked={own} disabled={busy} onCheckedChange={(on) => { setWeekly(on ? defaultWeeklyHours() : null); setSaved(false) }} />
          {t("scheduleOwnHours")}
        </label>
        {own ? <fieldset className="space-y-2">
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
        </fieldset> : <p className="text-sm text-muted-foreground">{t("schedulePageHoursHint")}</p>}
        <Button onClick={() => void save(weekly)} disabled={busy}>{busy ? t("saving") : t("save")}</Button>
        {saved ? <p role="status" className="text-sm">{t("saved")}</p> : null}
      </> : null}
    </>}
  </section>
}
