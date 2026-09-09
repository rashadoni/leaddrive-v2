"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { SlaPolicyForm } from "@/components/sla-policy-form"
import { formatSlaHours } from "@/lib/format-sla"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Plus, Pencil, Trash2, Clock } from "lucide-react"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

interface SlaPolicy extends Record<string, unknown> {
  id: string
  name: string
  priority: string
  firstResponseHours: number
  resolutionHours: number
  businessHoursOnly: boolean
  isActive: boolean
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
}

const formatHours = formatSlaHours // decimal hours → "Xh Ym" (rounded to whole minutes)

export default function SlaPoliciesPage() {
  const { data: session } = useSession()
  const t = useTranslations("settings")
  useAutoTour("slaPolicies")
  const tc = useTranslations("common")
  const [policies, setPolicies] = useState<SlaPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<SlaPolicy | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const orgId = session?.user?.organizationId

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/sla-policies", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      if (res.ok) {
        const result = await res.json() as { data?: SlaPolicy[] }
        setPolicies(result.data || [])
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }, [orgId])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/v1/sla-policies/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error(tc("errorDeleteFailed"))
    fetchPolicies()
  }

  const columns = [
    {
      key: "name", label: t("colPolicyName"), sortable: true,
      render: (item: SlaPolicy) => <div className="font-medium">{item.name}</div>,
    },
    {
      key: "priority", label: tc("priority"), sortable: true,
      render: (item: SlaPolicy) => <Badge className={PRIORITY_COLORS[item.priority]}>{item.priority}</Badge>,
    },
    {
      key: "firstResponseHours", label: t("colFirstResponse"), sortable: true,
      render: (item: SlaPolicy) => <div className="font-mono text-sm">{formatHours(item.firstResponseHours)}</div>,
    },
    {
      key: "resolutionHours", label: t("colResolution"), sortable: true,
      render: (item: SlaPolicy) => <div className="font-mono text-sm">{formatHours(item.resolutionHours)}</div>,
    },
    {
      key: "businessHoursOnly", label: t("colBusinessHours"), sortable: true,
      render: (item: SlaPolicy) => <span className="text-sm">{item.businessHoursOnly ? tc("yes") : tc("no")}</span>,
    },
    {
      key: "isActive", label: tc("status"), sortable: true,
      render: (item: SlaPolicy) => <Badge variant={item.isActive ? "default" : "secondary"}>{item.isActive ? tc("active") : tc("inactive")}</Badge>,
    },
    {
      key: "edit", label: "", sortable: false,
      render: (item: SlaPolicy) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => { setEditData(item); setShowForm(true) }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setDeleteId(item.id); setDeleteName(item.name) }}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 data-tour-id="sla-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Clock className="h-6 w-6" /> {t("slaPolicies")} <TourReplayButton tourId="slaPolicies" /><HelpButton slug="sla-policies" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground">{t("slaPoliciesDesc")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("hintSla")}</p>
        </div>
        <Button className="gap-2" onClick={() => { setEditData(undefined); setShowForm(true) }}>
          <Plus className="h-4 w-4" /> {t("addSlaPolicy")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("slaPolicies")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">{tc("loading")}</p>
          ) : policies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="font-medium">{t("noSlaPolicies")}</p>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">{t("noSlaPoliciesHint")}</p>
              <Button className="mt-4 gap-2" onClick={() => { setEditData(undefined); setShowForm(true) }}>
                <Plus className="h-4 w-4" /> {t("addSlaPolicy")}
              </Button>
            </div>
          ) : (
            <DataTable columns={columns} data={policies} searchPlaceholder={tc("search")} searchKey="name" pageSize={10} />
          )}
        </CardContent>
      </Card>

      <SlaPolicyForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={fetchPolicies}
        initialData={editData}
        orgId={orgId}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteSlaPolicyTitle")}
        itemName={deleteName}
      />
    </div>
  )
}
