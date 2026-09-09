"use client"

import { useTranslations, useLocale } from "next-intl"
import { Calendar, CheckCircle2 } from "lucide-react"
import { formatDate } from "@/lib/format-date"

const typeKeys: Record<string, string> = {
  conference: "eventConference",
  webinar: "eventWebinar",
  workshop: "eventWorkshop",
  meetup: "eventMeetup",
  exhibition: "eventExhibition",
  other: "eventOther",
}

export function UpcomingEvents({ events }: { events: any[] }) {
  const t = useTranslations("dashboard")
  const locale = useLocale()

  return (
    <div className="dashboard-bento-card rounded-lg bg-card border border-zinc-200 dark:border-zinc-700 shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-4 w-4 text-violet-500" />
          <span className="text-sm font-semibold">{t("upcomingEvents")}</span>
        </div>
      </div>
      {events && events.length > 0 ? (
        <div className="space-y-1.5">
          {events.map((e: any) => {
            const d = new Date(e.date)
            const month = formatDate(d, locale, { month: "short" }).replace(".", "")
            const day = d.getDate()
            return (
              <div key={e.id} className="flex items-center gap-2 py-0.5">
                <div className="w-8 h-8 rounded bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-[7px] text-violet-400 leading-none uppercase">{month}</span>
                  <span className="text-[11px] font-bold text-violet-700 dark:text-violet-300 leading-none">{day}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium truncate block">{e.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {typeKeys[e.type] ? t(typeKeys[e.type]) : e.type} · {t("eventRegistered", { count: e.registered })}
                  </span>
                </div>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="h-[100px] flex items-center justify-center text-xs text-muted-foreground">{t("noData")}</div>
      )}
    </div>
  )
}
