"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { ColorStatCard } from "@/components/color-stat-card"
import { EmailTemplateForm } from "@/components/email-template-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Plus, Mail, Pencil, Trash2, Globe, Tag } from "lucide-react"
import { useTranslations } from "next-intl"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

interface EmailTemplate extends Record<string, unknown> {
  id: string
  name: string
  subject: string
  htmlBody: string
  textBody?: string
  category?: string
  variables?: string
  language?: string
  createdAt: string
}

export default function EmailTemplatesPage() {
  const { data: session } = useSession()
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const te = useTranslations("emailTemplates")
  useAutoTour("emailTemplatesSettings")
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<EmailTemplate | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const orgId = session?.user?.organizationId

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/email-templates?limit=500", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json() as { success?: boolean; data?: { templates?: EmailTemplate[]; total?: number } }
      if (json.success) {
        setTemplates(json.data?.templates || [])
        setTotal(json.data?.total || 0)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }, [orgId])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/v1/email-templates/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || tc("errorDeleteFailed"))
    fetchTemplates()
  }

  const langFlags: Record<string, string> = { en: "EN", ru: "RU", az: "AZ" }

  const columns = [
    {
      key: "name", label: te("title"), sortable: true,
      render: (item: EmailTemplate) => (
        <div>
          <div className="font-medium">{item.name}</div>
          <div className="text-xs text-muted-foreground">{item.subject}</div>
        </div>
      ),
    },
    {
      key: "category", label: tc("category"), sortable: true,
      render: (item: EmailTemplate) => <Badge variant="outline">{item.category || te("catGeneral")}</Badge>,
    },
    {
      key: "language", label: tc("language"), sortable: true,
      render: (item: EmailTemplate) => {
        const language = item.language ?? "en"
        return <span className="text-xs font-medium">{langFlags[language] || language}</span>
      },
    },
    {
      key: "createdAt", label: tc("created"), sortable: true,
      render: (item: EmailTemplate) => new Date(item.createdAt).toLocaleDateString(),
    },
    {
      key: "actions", label: "", sortable: false,
      render: (item: EmailTemplate) => (
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

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{te("title")}</h1>
        <div className="animate-pulse h-96 bg-muted rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between" data-tour-id="email-templates-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {te("title")}
            <HelpButton slug="email-settings-templates" variant="label" />
            <TourReplayButton tourId="emailTemplatesSettings" />
          </h1>
          <p className="text-sm text-muted-foreground">{te("subtitle")}</p>
          <p className="text-sm text-muted-foreground mt-1">{ts("hintEmailTemplatesSettings")}</p>
        </div>
        <Button onClick={() => { setEditData(undefined); setShowForm(true) }} data-tour-id="email-templates-new">
          <Plus className="h-4 w-4 mr-1" /> {te("newTemplate")}
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-tour-id="email-templates-stats">
        <ColorStatCard label={ts("etTotal")} value={total} icon={<Mail className="h-4 w-4" />} />
        <ColorStatCard label={ts("etLanguages")} value={new Set(templates.map(t => t.language)).size} icon={<Globe className="h-4 w-4" />} />
        <ColorStatCard label={ts("etCategories")} value={new Set(templates.map(t => t.category)).size} icon={<Tag className="h-4 w-4" />} />
      </div>

      {templates.length === 0 ? (
        <Card data-tour-id="email-templates-list">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Mail className="mb-3 h-9 w-9 text-muted-foreground/40" />
            <p className="font-medium">{te("noTemplates")}</p>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">{te("noTemplatesHint")}</p>
            <Button className="mt-4" onClick={() => { setEditData(undefined); setShowForm(true) }}>
              <Plus className="h-4 w-4 mr-1" /> {te("newTemplate")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div data-tour-id="email-templates-list">
          <DataTable<EmailTemplate> columns={columns} data={templates} searchPlaceholder={ts("etSearch")} searchKey="name" pageSize={10} />
        </div>
      )}

      <EmailTemplateForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={fetchTemplates}
        initialData={editData}
        orgId={orgId}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={ts("etDelete")}
        itemName={deleteName}
      />
    </div>
  )
}
