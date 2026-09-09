"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import {
  Sparkles, Plus, Pencil, Trash2, Building2, Users,
  Handshake, UserPlus, Lock, CheckSquare,
} from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { CustomFieldForm } from "@/components/custom-field-form"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

type CustomField = {
  id: string
  organizationId: string
  entityType: string
  fieldName: string
  fieldLabel: string
  fieldType: string
  options: string[]
  isRequired: boolean
  defaultValue: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
}

const ENTITY_ICONS: Record<string, React.ElementType> = {
  contact: Users,
  deal: Handshake,
  lead: UserPlus,
  company: Building2,
  task: CheckSquare,
}

const ENTITY_TYPES = ["contact", "deal", "lead", "company", "task"] as const

export default function CustomFieldsPage() {
  const { data: session } = useSession()
  const t = useTranslations("customFields")
  const tf = useTranslations("forms")
  const tc = useTranslations("common")
  useAutoTour("customFields")

  const orgId = session?.user?.organizationId
  const role = (session?.user as { role?: string })?.role || "viewer"
  const canManage = role === "admin" || role === "superadmin"

  const [fields, setFields] = useState<CustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [entityFilter, setEntityFilter] = useState<string>("")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CustomField | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchFields = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const url = entityFilter
        ? `/api/v1/custom-fields?entityType=${encodeURIComponent(entityFilter)}`
        : "/api/v1/custom-fields"
      const res = await fetch(url, {
        headers: { "x-organization-id": String(orgId) },
      })
      const json = await res.json()
      if (json.success) setFields(json.data)
    } finally {
      setLoading(false)
    }
  }, [orgId, entityFilter])

  useEffect(() => {
    if (orgId) void fetchFields()
  }, [orgId, fetchFields])

  const handleDelete = async (field: CustomField) => {
    if (!orgId) return
    if (!confirm(t("deleteConfirm", { name: field.fieldLabel }))) return
    setDeletingId(field.id)
    try {
      await fetch(`/api/v1/custom-fields/${field.id}`, {
        method: "DELETE",
        headers: { "x-organization-id": String(orgId) },
      })
      await fetchFields()
    } finally {
      setDeletingId(null)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (field: CustomField) => {
    setEditing(field)
    setFormOpen(true)
  }

  const handleSaved = () => {
    void fetchFields()
  }

  const groupedByEntity = ENTITY_TYPES.reduce<Record<string, CustomField[]>>((acc, e) => {
    acc[e] = fields.filter((f) => f.entityType === e)
    return acc
  }, {} as Record<string, CustomField[]>)

  const entityLabel = (e: string) => {
    switch (e) {
      case "contact": return tf("entityContact")
      case "deal": return tf("entityDeal")
      case "lead": return tf("entityLead")
      case "company": return tf("entityCompany")
      case "task": return "Tasks"
      default: return e
    }
  }

  const fieldTypeLabel = (ft: string) => {
    switch (ft) {
      case "text": return tf("fieldTypeText")
      case "number": return tf("fieldTypeNumber")
      case "date": return tf("fieldTypeDate")
      case "select": return tf("fieldTypeSelect")
      case "boolean": return tf("fieldTypeBoolean")
      case "textarea": return tf("fieldTypeTextarea")
      default: return ft
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 data-tour-id="fields-header" className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6" />
            {t("title")}
            <TourReplayButton tourId="customFields" /><HelpButton slug="custom-fields" variant="label" />
          </h1>
          <PageDescription text={t("pageDescription")} />
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" /> {t("add")}
          </Button>
        )}
      </div>

      {!canManage && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-200">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t("adminOnly")}</span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">{t("filterByEntity")}:</span>
        <Select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="max-w-xs"
        >
          <option value="">{t("allEntities")}</option>
          {ENTITY_TYPES.map((e) => (
            <option key={e} value={e}>{entityLabel(e)}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">{tc("loading")}…</div>
      ) : fields.length === 0 ? (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg py-12 text-center">
          <Sparkles className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium">{t("noFields")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("noFieldsHint")}</p>
          {canManage && (
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" /> {t("add")}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {ENTITY_TYPES.map((entity) => {
            const rows = groupedByEntity[entity]
            if (!rows || rows.length === 0) return null
            if (entityFilter && entityFilter !== entity) return null
            const Icon = ENTITY_ICONS[entity]
            return (
              <div key={entity}>
                <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  <Icon className="w-4 h-4" />
                  {entityLabel(entity)}
                  <span className="text-xs font-normal normal-case">({rows.length})</span>
                </div>
                <div className="space-y-2">
                  {rows.map((f) => (
                    <div
                      key={f.id}
                      className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 flex items-center gap-4 bg-card"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{f.fieldLabel}</span>
                          <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                            {f.fieldName}
                          </code>
                          <Badge variant="outline" className="text-[10px]">
                            {fieldTypeLabel(f.fieldType)}
                          </Badge>
                          {f.isRequired && (
                            <Badge variant="outline" className="border-red-400 text-red-600 text-[10px]">
                              {t("required")}
                            </Badge>
                          )}
                          {!f.isActive && (
                            <Badge variant="outline" className="border-muted-foreground text-muted-foreground text-[10px]">
                              {t("inactive")}
                            </Badge>
                          )}
                        </div>
                        {f.fieldType === "select" && f.options.length > 0 && (
                          <div className="flex gap-1 flex-wrap mt-2">
                            {f.options.slice(0, 8).map((o) => (
                              <span
                                key={o}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono"
                              >
                                {o}
                              </span>
                            ))}
                            {f.options.length > 8 && (
                              <span className="text-[10px] text-muted-foreground">
                                +{f.options.length - 8}
                              </span>
                            )}
                          </div>
                        )}
                        {f.defaultValue && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {tf("defaultValue")}: <span className="font-mono">{f.defaultValue}</span>
                          </div>
                        )}
                      </div>
                      {canManage && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(f)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={deletingId === f.id}
                            onClick={() => void handleDelete(f)}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <CustomFieldForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={handleSaved}
        initialData={
          editing
            ? {
                id: editing.id,
                fieldName: editing.fieldName,
                fieldLabel: editing.fieldLabel,
                entityType: editing.entityType,
                fieldType: editing.fieldType,
                options: editing.options.join(", "),
                isRequired: editing.isRequired,
                defaultValue: editing.defaultValue ?? "",
              }
            : undefined
        }
        orgId={orgId ? String(orgId) : undefined}
      />
    </div>
  )
}
