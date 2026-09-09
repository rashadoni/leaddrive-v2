"use client"

import { useState } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { MessageSquareWarning } from "lucide-react"
import { useTranslations } from "next-intl"

export type ComplaintMetaInput = {
  complaintType: "complaint" | "suggestion"
  brand: string
  productionArea: string
  productCategory: string
  complaintObject: string
  complaintObjectDetail: string
  responsibleDepartment: string
  riskLevel: "low" | "medium" | "high"
}

export const EMPTY_COMPLAINT_META: ComplaintMetaInput = {
  complaintType: "complaint",
  brand: "",
  productionArea: "",
  productCategory: "",
  complaintObject: "",
  complaintObjectDetail: "",
  responsibleDepartment: "",
  riskLevel: "medium",
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticketId: string
  orgId?: string
  onConverted?: (id: string) => void
}

// Dialog that converts an existing ticket into a Complaint Register entry by
// POSTing to /api/v1/tickets/[id]/convert-to-complaint with the industrial
// meta-fields. Closes and navigates caller-side on success.
export function ConvertToComplaintDialog({ open, onOpenChange, ticketId, orgId, onConverted }: Props) {
  const t = useTranslations("forms")
  const tc = useTranslations("common")
  const [form, setForm] = useState<ComplaintMetaInput>(EMPTY_COMPLAINT_META)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function u<K extends keyof ComplaintMetaInput>(k: K, v: ComplaintMetaInput[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}/convert-to-complaint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({
          complaintType: form.complaintType,
          brand: form.brand || null,
          productionArea: form.productionArea || null,
          productCategory: form.productCategory || null,
          complaintObject: form.complaintObject || null,
          complaintObjectDetail: form.complaintObjectDetail || null,
          responsibleDepartment: form.responsibleDepartment || null,
          riskLevel: form.riskLevel,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error || t("convertFailed"))
        return
      }
      onConverted?.(ticketId)
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tc("error"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <MessageSquareWarning className="h-4 w-4 text-amber-600" />
          {t("convertToComplaint")}
        </DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          <p className="text-sm text-muted-foreground mb-3">
            {t("convertToComplaintDesc")}
          </p>
          {error && (
            <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">
              {error}
            </div>
          )}
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("complaintType")}</Label>
                <Select value={form.complaintType} onChange={(e) => u("complaintType", e.target.value as "complaint" | "suggestion")}>
                  <option value="complaint">{t("complaintTypeComplaint")}</option>
                  <option value="suggestion">{t("complaintTypeSuggestion")}</option>
                </Select>
              </div>
              <div>
                <Label>{t("riskLevel")}</Label>
                <Select value={form.riskLevel} onChange={(e) => u("riskLevel", e.target.value as "low" | "medium" | "high")}>
                  <option value="low">{t("riskLow")}</option>
                  <option value="medium">{t("riskMedium")}</option>
                  <option value="high">{t("riskHigh")}</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("complaintBrand")}</Label>
                <Input value={form.brand} onChange={(e) => u("brand", e.target.value)} />
              </div>
              <div>
                <Label>{t("productionArea")}</Label>
                <Input value={form.productionArea} onChange={(e) => u("productionArea", e.target.value)} />
              </div>
              <div>
                <Label>{t("productCategory")}</Label>
                <Input value={form.productCategory} onChange={(e) => u("productCategory", e.target.value)} />
              </div>
              <div>
                <Label>{t("complaintObject")}</Label>
                <Input value={form.complaintObject} onChange={(e) => u("complaintObject", e.target.value)} />
              </div>
              <div>
                <Label>{t("complaintObjectDetail")}</Label>
                <Input value={form.complaintObjectDetail} onChange={(e) => u("complaintObjectDetail", e.target.value)} />
              </div>
              <div>
                <Label>{t("responsibleDepartment")}</Label>
                <Input
                  value={form.responsibleDepartment}
                  onChange={(e) => u("responsibleDepartment", e.target.value)}
                  placeholder={t("responsibleDepartmentPlaceholder")}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("convertAiHint")}
            </p>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t("convertingComplaint") : t("convertToComplaintBtn")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
