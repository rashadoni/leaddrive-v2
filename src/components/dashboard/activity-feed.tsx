"use client"

import { useTranslations } from "next-intl"
import { Activity, Phone, Mail, Users, FileText, CheckCircle2, Target, Ticket } from "lucide-react"

const activityIcons: Record<string, { icon: typeof Activity; color: string }> = {
  call: { icon: Phone, color: "text-blue-500" },
  email: { icon: Mail, color: "text-cyan-500" },
  meeting: { icon: Users, color: "text-violet-500" },
  note: { icon: FileText, color: "text-muted-foreground" },
  task: { icon: CheckCircle2, color: "text-emerald-500" },
  deal: { icon: Target, color: "text-violet-500" },
  ticket: { icon: Ticket, color: "text-amber-500" },
}

export function ActivityFeed({ activities, timeAgo }: { activities: any[]; timeAgo: (d: string) => string }) {
  const t = useTranslations("dashboard")

  return (
    <div className="dashboard-bento-card rounded-lg bg-card border border-zinc-200 dark:border-zinc-700 shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold">{t("activity")}</span>
        </div>
      </div>
      {activities && activities.length > 0 ? (
        <div className="space-y-1.5">
          {activities.slice(0, 5).map((a: any) => {
            const act = activityIcons[a.type] || { icon: Activity, color: "text-muted-foreground" }
            const Icon = act.icon
            return (
              <div key={a.id} className="flex items-start gap-1.5">
                <Icon className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${act.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{a.subject || a.description || a.type}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {a.contact?.fullName || a.company?.name || ""} · {timeAgo(a.createdAt)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="h-[100px] flex items-center justify-center text-xs text-muted-foreground">{t("noActivity")}</div>
      )}
    </div>
  )
}
