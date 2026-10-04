"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CalendarClock, Check, Clock3, Pause, ShieldAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type ManagerTodayException = {
  type: string
  status: string
}

export type WorkforceManagerTodayPerson = {
  id: string
  name: string
  role: string
  status: "STARTED" | "PAUSED" | "COMPLETED" | "NOT_STARTED"
  workday: {
    id: string
    startedAt: string
    pausedAt: string | null
    completedAt: string | null
  } | null
  previousOpenWorkday: {
    id: string
    workDate: string
    status: "STARTED" | "PAUSED"
  } | null
  plan: {
    state: "ASSIGNED" | "NON_WORKING_DAY" | "UNAVAILABLE"
    source: "IMMUTABLE_WORKDAY_SNAPSHOT" | "EFFECTIVE_PUBLISHED_SCHEDULE" | "PERSISTED_NO_SHOW_CASE" | "CALENDAR" | "UNAVAILABLE"
    templateName: string | null
    timezone: string | null
    plannedStartAt: string | null
    plannedEndAt: string | null
  }
  calendar: {
    state: "SCHEDULED" | "NON_WORKING" | "PUBLIC_HOLIDAY" | "TENANT_CLOSURE" | "APPROVED_LEAVE" | "APPROVED_ABSENCE" | "PERSONAL_EXCEPTION" | "UNAVAILABLE"
    attendanceExpected: boolean
    noShowEligible: boolean
    excused: boolean
  }
  attendance: {
    state: "STARTED" | "PAUSED" | "COMPLETED" | "NO_SHOW" | "SCHEDULED_NOT_STARTED" | "NOT_EXPECTED" | "SCHEDULE_UNAVAILABLE"
    acceptedStartRecorded: boolean
  }
  exceptions: ManagerTodayException[] | null
  boundaries: {
    rawEvidence: "EXCLUDED"
    location: "EXCLUDED"
    reasons: "EXCLUDED"
    actors: "EXCLUDED"
    caseIdentifiers: "EXCLUDED"
    presenceConclusion: "NOT_INFERRED"
  }
}

export type WorkforceManagerTodayData = {
  date: string
  timezone: string
  summary: {
    started: number
    paused: number
    completed: number
    notStarted: number
    previousOpen: number
  }
  summaryScope: "LOADED_PAGE"
  pagination: { pageSize: number; nextCursor: string | null }
  people: WorkforceManagerTodayPerson[]
}

function attendanceTone(state: WorkforceManagerTodayPerson["attendance"]["state"]): "default" | "secondary" | "outline" | "destructive" | "warning" | "success" {
  if (state === "COMPLETED") return "success"
  if (state === "STARTED") return "default"
  if (state === "PAUSED") return "secondary"
  if (state === "NO_SHOW") return "destructive"
  if (state === "SCHEDULE_UNAVAILABLE") return "warning"
  return "outline"
}

export function WorkforceManagerToday({
  data,
  loadingMore,
  onLoadMore,
}: {
  data: WorkforceManagerTodayData
  loadingMore: boolean
  onLoadMore: () => void
}) {
  const locale = useLocale()
  const t = useTranslations("workforcePage")
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale])
  const summary = [
    { key: "started", label: t("started"), value: data.summary.started, icon: Clock3 },
    { key: "paused", label: t("paused"), value: data.summary.paused, icon: Pause },
    { key: "completed", label: t("completed"), value: data.summary.completed, icon: Check },
    { key: "previousOpen", label: t("needsReview"), value: data.summary.previousOpen, icon: AlertTriangle },
  ]
  const plannedWindow = (person: WorkforceManagerTodayPerson) => {
    if (!person.plan.plannedStartAt || !person.plan.plannedEndAt || !person.plan.timezone) return null
    try {
      const formatter = new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: person.plan.timezone,
      })
      return t("managerPlannedWindow", {
        start: formatter.format(new Date(person.plan.plannedStartAt)),
        end: formatter.format(new Date(person.plan.plannedEndAt)),
        timezone: person.plan.timezone,
      })
    } catch {
      return null
    }
  }

  return <>
    <section className="grid gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-700 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("dailySummary")}>
      {summary.map(({ key, label, value, icon: Icon }) => <div key={key} className="flex min-h-28 flex-col justify-between bg-card p-5">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div><p className="text-2xl font-semibold tabular-nums">{value}</p><p className="text-sm text-muted-foreground">{label}</p></div>
      </div>)}
    </section>

    <section aria-labelledby="workforce-manager-today-list" className="border-y border-zinc-200 dark:border-zinc-700">
      <div className="flex flex-col gap-1 px-1 py-5 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h3 id="workforce-manager-today-list" className="text-base font-semibold">{t("teamToday")}</h3>
          <p className="text-sm text-muted-foreground">{dateFormatter.format(new Date(`${data.date}T12:00:00`))} · {data.timezone}</p>
        </div>
        <span className="text-sm text-muted-foreground">{t("managerLoadedPeople", { count: data.people.length })}</span>
      </div>
      <p className="border-t border-zinc-200 px-1 py-3 text-xs leading-5 text-muted-foreground dark:border-zinc-700">
        {t("managerSummaryBoundary")}
      </p>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {data.people.map((person) => {
          const window = plannedWindow(person)
          return <article key={person.id} className="grid gap-4 px-1 py-5 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(15rem,1fr)_minmax(14rem,0.8fr)] lg:items-start">
            <div className="min-w-0">
              <p className="truncate font-medium">{person.name}</p>
              <p className="text-sm text-muted-foreground">{person.role}</p>
              <Badge className="mt-3" variant={attendanceTone(person.attendance.state)}>
                {t(`managerAttendanceState.${person.attendance.state}`)}
              </Badge>
            </div>

            <div>
              <p className="inline-flex items-center gap-2 text-sm font-medium"><CalendarClock className="h-4 w-4" aria-hidden="true" />{t("managerPlanTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {person.plan.templateName ?? t(`managerPlanState.${person.plan.state}`)}
              </p>
              {window ? <p className="mt-1 text-sm text-muted-foreground">{window}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">{t(`managerCalendarState.${person.calendar.state}`)}</p>
              {person.previousOpenWorkday ? <p className="mt-3 inline-flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {t("previousOpen", { date: person.previousOpenWorkday.workDate.slice(0, 10) })}
              </p> : null}
            </div>

            <div>
              <p className="inline-flex items-center gap-2 text-sm font-medium"><ShieldAlert className="h-4 w-4" aria-hidden="true" />{t("managerExceptionsTitle")}</p>
              {person.exceptions == null ? <p className="mt-1 text-sm text-muted-foreground">{t("managerExceptionsRestricted")}</p> : person.exceptions.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">{t("managerExceptionsNone")}</p> : <div className="mt-2 flex flex-wrap gap-2">
                {person.exceptions.map((exception) => <Badge key={`${exception.type}-${exception.status}`} variant={exception.status === "RESOLVED" ? "outline" : "warning"}>
                  {t(`timesheetApprovalException.${exception.type}`)} · {t(`timesheetExceptionStatus.${exception.status}`)}
                </Badge>)}
              </div>}
              {person.exceptions?.length ? <Button asChild variant="link" className="mt-2 min-h-12 px-0">
                <Link href="/workforce/exceptions">{t("managerOpenExceptionQueue")}</Link>
              </Button> : null}
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("managerPresenceBoundary")}</p>
            </div>
          </article>
        })}
        {data.people.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{t("noPeople")}</p> : null}
      </div>
      {data.pagination.nextCursor ? <div className="border-t border-zinc-200 py-5 text-center dark:border-zinc-700">
        <Button type="button" variant="outline" className="h-auto min-h-12 max-w-full whitespace-normal text-center" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? t("managerLoadingMore") : t("managerLoadMore")}
        </Button>
      </div> : null}
    </section>
  </>
}
