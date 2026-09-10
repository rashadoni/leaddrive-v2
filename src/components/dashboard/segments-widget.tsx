"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { Tag, ArrowRight } from "lucide-react"

interface CategoryRow {
  category: string
  count: number
}

const CATEGORY_COLORS: Record<string, string> = {
  vip: "#a855f7",
  partner: "#14b8a6",
  prospect: "#f59e0b",
  regular: "#3b82f6",
  inactive: "#94a3b8",
  "(none)": "#e5e7eb",
}

interface Props {
  orgId?: string
}

export function SegmentsWidget({ orgId }: Props) {
  const t = useTranslations("insights")
  const tNav = useTranslations("nav")
  const [rows, setRows] = useState<CategoryRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
    fetch("/api/v1/analytics/segments?entity=contacts", { headers })
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setRows(json.data.byCategory)
          setTotal(json.data.total)
        }
      })
      .finally(() => setLoading(false))
  }, [orgId])

  const hasCategories = rows.some(r => r.category !== "(none)")

  const categoryLabel = (v: string): string => {
    const k = String(v || "").toLowerCase()
    const map: Record<string, string> = { vip: "catVip", regular: "catRegular", partner: "catPartner", prospect: "catProspect", inactive: "catInactive", "(none)": "catNone" }
    return map[k] ? t(map[k]) : v
  }

  return (
    <div className="dashboard-bento-card rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Tag className="h-4 w-4 text-violet-500" /> {t("widgetTitle")}
        </h3>
        <Link href="/contacts/segments" className="text-xs text-primary hover:underline flex items-center gap-1">
          {t("widgetCta")} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {loading ? (
        <div className="h-40 bg-muted rounded animate-pulse" />
      ) : !hasCategories ? (
        <div className="h-40 flex flex-col items-center justify-center text-center text-xs text-muted-foreground">
          <Tag className="h-6 w-6 opacity-40 mb-2" />
          <p>{t("widgetEmpty")}</p>
          <p className="mt-1">
            {t.rich("widgetEmptyHint", {
              link: () => <Link href="/contacts" className="text-primary hover:underline">{tNav("contacts")}</Link>,
            })}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="w-28 h-28 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {/* Render only categorized rows — blending "(none)" swamps the pie */}
                <Pie
                  data={rows.filter(r => r.category !== "(none)")}
                  dataKey="count"
                  nameKey="category"
                  innerRadius={30}
                  outerRadius={50}
                >
                  {rows.filter(r => r.category !== "(none)").map((r, i) => (
                    <Cell key={i} fill={CATEGORY_COLORS[r.category] || "#e5e7eb"} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            {rows.filter(r => r.category !== "(none)").slice(0, 5).map(r => (
              <Link
                key={r.category}
                href={`/contacts?category=${r.category}`}
                className="flex items-center gap-2 text-xs hover:bg-muted rounded px-1 py-0.5 transition-colors"
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[r.category] || "#e5e7eb" }} />
                <span className="flex-1 truncate">{categoryLabel(r.category)}</span>
                <span className="tabular-nums font-medium">{r.count}</span>
                {total && <span className="text-muted-foreground tabular-nums">{Math.round((r.count / total) * 100)}%</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
