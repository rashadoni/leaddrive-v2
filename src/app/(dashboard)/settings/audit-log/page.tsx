"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { DataTable } from "@/components/data-table"
import { Shield } from "lucide-react"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

interface AuditLog extends Record<string, unknown> {
  id: string
  action: string
  entityType: string
  entityName: string | null
  userId: string | null
  actorName: string | null
  actorEmail: string | null
  createdAt: string
}

const actionColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  create: "default",
  update: "secondary",
  delete: "destructive",
  login: "outline",
  export: "outline",
  user_created: "default",
  user_updated: "secondary",
  user_activated: "default",
  user_deactivated: "destructive",
  password_reset: "outline",
}

const userAuditTranslationKeys: Record<string, string> = {
  user_created: "auditUserCreated",
  user_updated: "auditUserUpdated",
  user_activated: "auditUserActivated",
  user_deactivated: "auditUserDeactivated",
  password_reset: "auditPasswordReset",
}

export default function AuditLogPage() {
  const { data: session } = useSession()
  const t = useTranslations("settings")
  const tu = useTranslations("settingsUsers")
  useAutoTour("auditLog")
  const tc = useTranslations("common")
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user?.email) return

    const fetchLogs = async () => {
      try {
        const response = await fetch("/api/v1/audit-log")
        if (response.ok) {
          const result = await response.json() as { data?: { logs?: AuditLog[] } }
          const formattedLogs = (result.data?.logs || []).map((log) => ({
            ...log,
            createdAt: new Date(log.createdAt).toLocaleString(),
          }))
          setLogs(formattedLogs)
        }
      } catch (error) {
        console.error("Failed to fetch audit logs:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
  }, [session])

  const columns = [
    { key: "createdAt", label: tc("date"), sortable: true },
    {
      key: "action",
      label: tc("action"),
      sortable: true,
      render: (item: AuditLog) => {
        const translationKey = userAuditTranslationKeys[item.action]
        return (
          <Badge variant={actionColors[item.action] || "outline"}>
            {translationKey && tu.has(translationKey) ? tu(translationKey as never) : item.action}
          </Badge>
        )
      },
    },
    { key: "entityType", label: tc("entity"), sortable: true },
    { key: "entityName", label: tc("name"), sortable: true },
    {
      key: "userId",
      label: tc("user"),
      sortable: true,
      render: (item: AuditLog) => (
        item.actorName ? (
          <div>
            <div className="text-sm font-medium">{item.actorName}</div>
            <div className="text-xs text-muted-foreground">{item.actorEmail}</div>
          </div>
        ) : <span>{item.userId || tc("system")}</span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 data-tour-id="audit-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6" /> {t("auditLog")} <TourReplayButton tourId="auditLog" /><HelpButton slug="audit-log" variant="label" />
        </h1>
        <p className="text-sm text-muted-foreground">{t("auditLogDesc")}</p>
        <p className="text-sm text-muted-foreground mt-1">{t("hintAuditLog")}</p>
      </div>
      {loading ? (
        <p className="text-muted-foreground">{tc("loading")}</p>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Shield className="mb-3 h-9 w-9 text-muted-foreground/40" />
            <p className="font-medium">{t("noAuditLogs")}</p>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">{t("noAuditLogsHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <DataTable<AuditLog> columns={columns} data={logs} searchPlaceholder={tc("search")} searchKey="entityName" />
      )}
    </div>
  )
}
