"use client"

import { useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Phone, Mail, Users, FileText, CheckSquare, BarChart3, TrendingUp, Eye, MousePointer } from "lucide-react"
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts"
import { formatDate } from "@/lib/format-date"

interface EngagementData {
  activities: { total: number; calls: number; emails: number; meetings: number; notes: number; tasks: number }
  lastActivity: { date: string; type: string; subject: string } | null
  activityChart: { month: string; calls: number; emails: number; meetings: number }[]
  email: {
    sent: number; delivered: number; opened: number; clicked: number; bounced: number; failed: number
    openRate: number; clickRate: number
    chart: { month: string; sent: number; opened: number; clicked: number }[]
  }
}

export function EngagementTab({ dealId, orgId }: { dealId: string; orgId?: string }) {
  const t = useTranslations("deals")
  const locale = useLocale()
  const [data, setData] = useState<EngagementData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const headers: any = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>
    fetch(`/api/v1/deals/${dealId}/engagement`, { headers })
      .then(r => r.json())
      .then(j => { if (j.success) setData(j.data) })
      .finally(() => setLoading(false))
  }, [dealId, orgId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground text-center py-8">{t("engNoData")}</p>
  }

  const activityItems = [
    { icon: Phone, label: t("engCalls"), value: data.activities.calls, color: "text-green-600", bg: "bg-green-100" },
    { icon: Mail, label: t("engEmails"), value: data.activities.emails, color: "text-blue-600", bg: "bg-blue-100" },
    { icon: Users, label: t("engMeetings"), value: data.activities.meetings, color: "text-violet-600", bg: "bg-violet-100" },
    { icon: FileText, label: t("engNotes"), value: data.activities.notes, color: "text-amber-600", bg: "bg-amber-100" },
    { icon: CheckSquare, label: t("engTasks"), value: data.activities.tasks, color: "text-orange-600", bg: "bg-orange-100" },
  ]

  return (
    <div className="space-y-6">
      {/* Engagement Header */}
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-red-500 flex items-center justify-center">
          <BarChart3 className="h-3 w-3 text-white" />
        </div>
        <h3 className="font-semibold text-red-600">{t("engTitle")}</h3>
        <Badge variant="outline" className="ml-auto text-xs">{t("engLast3Months")}</Badge>
      </div>

      {/* Activity Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {activityItems.map(item => (
          <Card key={item.label} className="border-none shadow-sm">
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`h-9 w-9 rounded-lg ${item.bg} flex items-center justify-center`}>
                <item.icon className={`h-4 w-4 ${item.color}`} />
              </div>
              <div>
                <p className="text-lg font-bold">{item.value}</p>
                <p className="text-[10px] text-muted-foreground">{item.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Last Activity */}
      {data.lastActivity && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span>{t("engLastActivity")}:</span>
          <Badge variant="outline" className="text-[10px]">{data.lastActivity.type}</Badge>
          <span>{data.lastActivity.subject}</span>
          <span>·</span>
          <span>{formatDate(data.lastActivity.date, locale)}</span>
        </div>
      )}

      {/* Activity Dynamics Chart */}
      <Card className="border-none shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("engActivityDynamics")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data.activityChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="calls" stackId="1" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} name={t("engCalls")} />
              <Area type="monotone" dataKey="emails" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} name={t("engEmails")} />
              <Area type="monotone" dataKey="meetings" stackId="1" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} name={t("engMeetings")} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Email Nurturing */}
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-red-500 flex items-center justify-center">
          <Mail className="h-3 w-3 text-white" />
        </div>
        <h3 className="font-semibold text-red-600">{t("engEmailNurturing")}</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-none shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">{t("engSent3Mo")}</span>
            </div>
            <p className="text-xl font-bold mt-1">{data.email.sent}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">{t("engOpenRate")}</span>
            </div>
            <p className="text-xl font-bold mt-1">{data.email.openRate}%</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <MousePointer className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">{t("engClickRate")}</span>
            </div>
            <p className="text-xl font-bold mt-1">{data.email.clickRate}%</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-red-500" />
              <span className="text-xs text-muted-foreground">{t("engBounced")}</span>
            </div>
            <p className="text-xl font-bold mt-1">{data.email.bounced}</p>
          </CardContent>
        </Card>
      </div>

      {/* Email Dynamics Chart */}
      <Card className="border-none shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("engEmailDynamics")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.email.chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="sent" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name={t("engChartSent")} />
              <Line type="monotone" dataKey="opened" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name={t("engChartOpens")} />
              <Line type="monotone" dataKey="clicked" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name={t("engChartClicks")} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
