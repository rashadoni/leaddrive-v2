"use client"

import type { FormEvent } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { CalendarDays, Loader2, Plus, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import type {
  WorkforceCalendarCreateKind,
  WorkforceCalendarOverrideSummary,
} from "@/lib/workforce/calendar-configuration-contract"

export const WORKFORCE_CALENDAR_EDITOR_KINDS = [
  "PUBLIC_HOLIDAY",
  "COMPANY_HOLIDAY",
  "EXCEPTION_WORKDAY",
] as const satisfies readonly WorkforceCalendarCreateKind[]

type CalendarData = {
  timezone: string
  currentDate: string
  start: string
  endExclusive: string
  days: WorkforceCalendarOverrideSummary[]
}

type ApiFailure = Error & { code?: string }

function nextDateKey(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function previousDateKey(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function failureCode(failure: unknown): string {
  return failure && typeof failure === "object" && "code" in failure
    ? String((failure as { code?: unknown }).code ?? "")
    : ""
}

function localizedKnownFailure(t: ReturnType<typeof useTranslations>, code: string): string | null {
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE") return t("dateNotFuture")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_DATE_RANGE_INVALID") return t("dateRangeInvalid")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS") return t("overrideExists")
  if (code === "WORKFORCE_CALENDAR_CONFIGURATION_INVALID") return t("invalidInput")
  if ([
    "WORKFORCE_GRANULAR_ACCESS_REQUIRED",
    "WORKFORCE_POLICY_ADMIN_REQUIRED",
    "WORKFORCE_SESSION_PERMISSION_REQUIRED",
    "TENANT_CAPABILITY_DISABLED",
  ].includes(code)) return t("accessRequired")
  return null
}

function localizedReadFailure(t: ReturnType<typeof useTranslations>, failure: unknown): string {
  const known = localizedKnownFailure(t, failureCode(failure))
  if (known) return known
  return t("requestFailed")
}

function localizedMutationFailure(t: ReturnType<typeof useTranslations>, failure: unknown): string {
  const known = localizedKnownFailure(t, failureCode(failure))
  if (known) return known
  // A transport or parse failure can happen after the server committed. The
  // exact-state retry contract makes refresh/resubmit safe; never claim that
  // an unknown mutation outcome left the calendar unchanged.
  return t("outcomeUnknown")
}

/**
 * Organization-only, forward-only calendar editor. Authorization remains in
 * the API so a granular Scheduler is not hidden behind the legacy CRM role.
 */
export function WorkforceCalendarConfiguration() {
  const { data: session } = useSession()
  const t = useTranslations("workforceCalendarConfiguration")
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const [calendar, setCalendar] = useState<CalendarData | null>(null)
  const [date, setDate] = useState("")
  const [kind, setKind] = useState<WorkforceCalendarCreateKind>("PUBLIC_HOLIDAY")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }), [])

  const request = useCallback(async (method: "GET" | "POST", body?: unknown) => {
    if (!organizationId) throw new Error("organization-unavailable")
    const response = await fetch("/api/v1/workforce/configuration/calendar", {
      method,
      headers: {
        "x-organization-id": organizationId,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = await response.json().catch(() => ({})) as {
      success?: boolean
      code?: string
      data?: CalendarData
    }
    if (!response.ok || !payload.success || !payload.data) {
      const failure = new Error("workforce-calendar-request-failed") as ApiFailure
      failure.code = payload.code
      throw failure
    }
    return { data: payload.data, status: response.status }
  }, [organizationId])

  const load = useCallback(async () => {
    if (!organizationId) return
    setLoading(true)
    try {
      const result = await request("GET")
      setCalendar(result.data)
      setDate((current) => current > result.data.currentDate ? current : nextDateKey(result.data.currentDate))
      setError(null)
    } catch (failure) {
      setCalendar(null)
      setError(localizedReadFailure(t, failure))
    } finally {
      setLoading(false)
    }
  }, [organizationId, request, t])

  useEffect(() => {
    void load()
  }, [load])

  async function createOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await request("POST", { date, kind, name })
      setNotice(result.status === 201 ? t("created") : t("alreadyRecorded"))
      setName("")
      await load()
    } catch (failure) {
      setError(localizedMutationFailure(t, failure))
    } finally {
      setSaving(false)
    }
  }

  if (!organizationId) return null

  const minimumDate = calendar ? nextDateKey(calendar.currentDate) : undefined

  return <section
    className="overflow-hidden rounded-xl border border-zinc-200 bg-background dark:border-zinc-800"
    aria-labelledby="workforce-calendar-configuration-title"
    aria-busy={loading || saving}
  >
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 px-5 py-5 dark:border-zinc-800 sm:px-6">
      <div className="flex max-w-3xl gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h2 id="workforce-calendar-configuration-title" className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => void load()} disabled={loading || saving}>
        {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
        {t("refresh")}
      </Button>
    </div>

    {error ? <p className="border-b border-red-200 bg-red-50 px-5 py-4 text-sm leading-6 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200 sm:px-6" role="alert">{error}</p> : null}
    {notice ? <p className="border-b border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 sm:px-6" role="status" aria-live="polite">{notice}</p> : null}

    {calendar ? <>
      <form className="grid gap-5 px-5 py-6 sm:px-6 md:grid-cols-3" onSubmit={createOverride}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-date">{t("date")}</label>
          <Input
            id="workforce-calendar-date"
            type="date"
            className="min-h-11"
            min={minimumDate}
            max={previousDateKey(calendar.endExclusive)}
            value={date}
            onChange={(event) => { setDate(event.target.value); setNotice(null) }}
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-kind">{t("kind")}</label>
          <Select
            id="workforce-calendar-kind"
            className="min-h-11"
            value={kind}
            onChange={(event) => { setKind(event.target.value as WorkforceCalendarCreateKind); setNotice(null) }}
          >
            {WORKFORCE_CALENDAR_EDITOR_KINDS.map((value) => <option key={value} value={value}>{t(`kinds.${value}`)}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workforce-calendar-name">{t("name")}</label>
          <Input
            id="workforce-calendar-name"
            className="min-h-11"
            value={name}
            onChange={(event) => { setName(event.target.value); setNotice(null) }}
            maxLength={160}
            placeholder={t("namePlaceholder")}
            required
          />
        </div>
        <div className="md:col-span-3">
          <p className="mb-4 text-sm leading-6 text-muted-foreground">{t("createHint", { timezone: calendar.timezone })}</p>
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={saving || loading || !date || !name.trim()}>
            {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}
            {t("create")}
          </Button>
        </div>
      </form>

      <div className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="px-5 py-5 sm:px-6">
          <h3 className="font-semibold">{t("upcomingTitle")}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("upcomingHint", { timezone: calendar.timezone })}</p>
        </div>
        {calendar.days.length === 0
          ? <p className="border-t border-zinc-200 px-5 py-8 text-sm text-muted-foreground dark:border-zinc-800 sm:px-6">{t("empty")}</p>
          : <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {calendar.days.map((day) => <li key={`${day.date}:${day.kind}`} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <p className="font-medium">{day.name || t("unnamed")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}</p>
              </div>
              <Badge variant="secondary" className="w-fit">{t(`kinds.${day.kind}`)}</Badge>
            </li>)}
          </ul>}
      </div>
    </> : loading ? <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground sm:px-6"><Loader2 className="animate-spin motion-reduce:animate-none" />{t("loading")}</div> : null}
  </section>
}
