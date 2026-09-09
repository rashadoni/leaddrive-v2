"use client"

import { useTranslations } from "next-intl"
import { Megaphone } from "lucide-react"

export function CampaignStats({ campaigns }: { campaigns: any[] }) {
  const t = useTranslations("dashboard")

  return (
    <div className="dashboard-bento-card rounded-lg bg-card border border-zinc-200 dark:border-zinc-700 shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Megaphone className="h-4 w-4 text-pink-500" />
          <span className="text-sm font-semibold">{t("campaignStats")}</span>
        </div>
        <a href="/campaigns" className="text-[10px] text-violet-600 hover:underline">{t("viewAll")} →</a>
      </div>
      {campaigns && campaigns.length > 0 ? (
        <div className="space-y-2">
          {campaigns.slice(0, 2).map((c: any) => (
            <div key={c.id}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium truncate">{c.name}</span>
                <span className={`text-[8px] px-1.5 py-0.5 rounded border ${
                  c.status === "active" ? "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
                  : c.status === "sent" ? "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800"
                  : c.status === "sending" ? "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"
                  : "bg-muted/50 text-muted-foreground border-zinc-200 dark:border-zinc-700"
                }`}>
                  {c.status === "active" ? t("active") : c.status === "sent" ? t("sent") : c.status === "sending" ? t("sending") : c.status || "draft"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { v: c.sent?.toLocaleString() || "0", l: t("sent") },
                  { v: `${c.openRate || 0}%`, l: t("openRate") },
                  { v: `${c.clickRate || 0}%`, l: t("clickRate") },
                ].map((m) => (
                  <div key={m.l} className="text-center p-1 rounded bg-muted/50 border border-zinc-200 dark:border-zinc-700">
                    <div className="text-xs font-semibold">{m.v}</div>
                    <div className="text-[8px] text-muted-foreground">{m.l}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="h-[100px] flex items-center justify-center text-xs text-muted-foreground">{t("noData")}</div>
      )}
    </div>
  )
}
