"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { BriefcaseBusiness, CircleAlert, Loader2, Search, UserRoundPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type ContactType = "DOCTOR" | "PHARMACIST" | "OTHER"

type OrganizationOption = {
  id: string
  code: string | null
  name: string
  objectType: string
  address: string | null
  city: string | null
  district: string | null
}

type FormState = {
  type: ContactType
  lastName: string
  firstName: string
  middleName: string
  specialtyName: string
  phone: string
  customerId: string
  jobTitle: string
  notes: string
}

const EMPTY_FORM: FormState = {
  type: "DOCTOR",
  lastName: "",
  firstName: "",
  middleName: "",
  specialtyName: "",
  phone: "",
  customerId: "",
  jobTitle: "",
  notes: "",
}

function organizationLabel(organization: OrganizationOption): string {
  const place = [organization.city, organization.district].filter(Boolean).join(", ")
  return [organization.name, place].filter(Boolean).join(" · ")
}

export function MtmContactCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactCreate")
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([])
  const [organizationSearch, setOrganizationSearch] = useState("")
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === form.customerId),
    [form.customerId, organizations],
  )

  const loadOrganizations = useCallback(async (query: string) => {
    setSearching(true)
    setError("")
    try {
      const params = new URLSearchParams({ page: "1", limit: "50", sort: "name", direction: "asc" })
      if (query.trim()) params.set("search", query.trim())
      const response = await fetch(`/api/v1/mtm/organizations?${params}`)
      const result = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: { organizations?: OrganizationOption[] }
      } | null
      if (!response.ok || !result?.success) throw new Error(result?.error || t("organizationSearchError"))
      setOrganizations(result.data?.organizations ?? [])
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : t("organizationSearchError"))
    } finally {
      setSearching(false)
    }
  }, [t])

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    setOrganizationSearch("")
    setError("")
    setSaving(false)
    void loadOrganizations("")
  }, [loadOrganizations, open])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setError("")
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.lastName.trim() || !form.firstName.trim()) {
      setError(t("nameRequired"))
      return
    }
    if (!form.customerId) {
      setError(t("workplaceRequired"))
      return
    }

    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/v1/mtm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type,
          lastName: form.lastName.trim(),
          firstName: form.firstName.trim(),
          middleName: form.middleName.trim() || null,
          specialtyName: form.type === "DOCTOR" ? form.specialtyName.trim() || null : null,
          phone: form.phone.trim() || null,
          notes: form.notes.trim() || null,
          primaryWorkplace: {
            customerId: form.customerId,
            jobTitle: form.jobTitle.trim() || null,
            phone: form.phone.trim() || null,
          },
        }),
      })
      const result = await response.json().catch(() => null) as { error?: string; code?: string } | null
      if (!response.ok) {
        if (result?.code === "MTM_CONTACT_REQUIRED_FIELDS") throw new Error(t("requiredFieldsError"))
        if (result?.code === "MTM_CONTACT_WORKPLACE_INVALID") throw new Error(t("workplaceInvalid"))
        throw new Error(result?.error || t("saveError"))
      }
      toast.success(t("saved"))
      await onCreated()
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }} widthClassName="max-w-3xl" maxHeightClassName="max-h-[92vh]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><UserRoundPlus className="h-5 w-5 text-primary" />{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit}>
        <DialogContent className="space-y-6">
          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 flex-none" />
              <span>{error}</span>
            </div>
          ) : null}

          <section className="space-y-3" aria-labelledby="contact-create-person">
            <div>
              <h3 id="contact-create-person" className="text-sm font-semibold">{t("personSection")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t("personHint")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="contact-create-type">{t("type")} *</Label>
                <Select id="contact-create-type" value={form.type} onChange={(event) => update("type", event.target.value as ContactType)}>
                  <option value="DOCTOR">{t("types.DOCTOR")}</option>
                  <option value="PHARMACIST">{t("types.PHARMACIST")}</option>
                  <option value="OTHER">{t("types.OTHER")}</option>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="contact-create-last-name">{t("lastName")} *</Label><Input id="contact-create-last-name" value={form.lastName} onChange={(event) => update("lastName", event.target.value)} autoComplete="family-name" /></div>
              <div className="space-y-1.5"><Label htmlFor="contact-create-first-name">{t("firstName")} *</Label><Input id="contact-create-first-name" value={form.firstName} onChange={(event) => update("firstName", event.target.value)} autoComplete="given-name" /></div>
              <div className="space-y-1.5"><Label htmlFor="contact-create-middle-name">{t("middleName")}</Label><Input id="contact-create-middle-name" value={form.middleName} onChange={(event) => update("middleName", event.target.value)} autoComplete="additional-name" /></div>
              {form.type === "DOCTOR" ? <div className="space-y-1.5"><Label htmlFor="contact-create-specialty">{t("specialty")}</Label><Input id="contact-create-specialty" value={form.specialtyName} onChange={(event) => update("specialtyName", event.target.value)} placeholder={t("specialtyPlaceholder")} /></div> : null}
            </div>
          </section>

          <section className="space-y-3 border-t pt-5" aria-labelledby="contact-create-workplace">
            <div className="flex items-start gap-2">
              <BriefcaseBusiness className="mt-0.5 h-4 w-4 text-primary" />
              <div><h3 id="contact-create-workplace" className="text-sm font-semibold">{t("workplaceSection")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("workplaceHint")}</p></div>
            </div>
            <div className="flex gap-2">
              <Input value={organizationSearch} onChange={(event) => setOrganizationSearch(event.target.value)} placeholder={t("organizationSearchPlaceholder")} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void loadOrganizations(organizationSearch) } }} />
              <Button type="button" variant="outline" className="min-h-11 min-w-11" aria-label={t("search")} disabled={searching} onClick={() => void loadOrganizations(organizationSearch)}>{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="contact-create-workplace-select">{t("workplace")} *</Label>
                <Select id="contact-create-workplace-select" value={form.customerId} onChange={(event) => update("customerId", event.target.value)} disabled={searching}>
                  <option value="">{t("workplacePlaceholder")}</option>
                  {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organizationLabel(organization)}</option>)}
                </Select>
                {selectedOrganization ? <p className="text-xs text-muted-foreground">{[selectedOrganization.objectType, selectedOrganization.address].filter(Boolean).join(" · ") || t("addressMissing")}</p> : null}
              </div>
              <div className="space-y-1.5"><Label htmlFor="contact-create-job-title">{t("jobTitle")}</Label><Input id="contact-create-job-title" value={form.jobTitle} onChange={(event) => update("jobTitle", event.target.value)} placeholder={t(`jobTitlePlaceholder.${form.type}`)} /></div>
              <div className="space-y-1.5"><Label htmlFor="contact-create-phone">{t("phone")}</Label><Input id="contact-create-phone" value={form.phone} onChange={(event) => update("phone", event.target.value)} inputMode="tel" autoComplete="tel" placeholder="+994 50 000 00 00" /></div>
            </div>
          </section>

          <details className="rounded-xl border">
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium">{t("notesSection")}</summary>
            <div className="border-t p-4"><Label htmlFor="contact-create-notes">{t("notes")}</Label><Textarea id="contact-create-notes" className="mt-1.5" rows={3} value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder={t("notesPlaceholder")} /></div>
          </details>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("cancel")}</Button>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundPlus className="h-4 w-4" />}{saving ? t("saving") : t("save")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
