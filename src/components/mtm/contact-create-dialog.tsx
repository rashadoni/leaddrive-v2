"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { BriefcaseBusiness, CircleAlert, Loader2, UserRoundPlus } from "lucide-react"
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
import { ContactSpecialtyInput } from "@/components/mtm/contact-specialty-input"
import { MtmOrganizationPicker, type MtmOrganizationOption } from "@/components/mtm/organization-picker"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { legacyContactTypeForCategory } from "@/lib/mtm/contact-category-editor"

type ContactType = "DOCTOR" | "PHARMACIST" | "OTHER"
type Labels = { ru: string; az: string; en: string }
type ClientTypeField = {
  key: string
  order: number
  type: "TEXT" | "TEXTAREA" | "PHONE" | "EMAIL" | "NUMBER" | "DATE" | "SELECT"
  required: boolean
  labels: Labels
  options?: Array<{ code: string; labels: Labels }>
}
type ClientTypeDictionary = {
  id: string
  kind: string
  status: string
  entries: Array<{ code: string; order: number; labels: Labels; fields?: ClientTypeField[] }>
}

type FormState = {
  type: ContactType
  lastName: string
  firstName: string
  middleName: string
  specialtyName: string
  phone: string
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
  jobTitle: "",
  notes: "",
}

function localized(labels: Labels, locale: string): string {
  return locale.startsWith("az") ? labels.az : locale.startsWith("ru") ? labels.ru : labels.en
}

export function MtmContactCreateDialog({
  open,
  onOpenChange,
  onCreated,
  specialties = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The tenant's specialty list; empty means the specialty is typed freely. */
  specialties?: readonly string[]
  onCreated: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactCreate")
  const locale = useLocale()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [clientTypeDictionary, setClientTypeDictionary] = useState<ClientTypeDictionary | null>(null)
  const [clientTypeCode, setClientTypeCode] = useState("")
  const [clientTypeValues, setClientTypeValues] = useState<Record<string, string>>({})
  const [organization, setOrganization] = useState<MtmOrganizationOption | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const selectedClientType = useMemo(
    () => clientTypeDictionary?.entries.find((entry) => entry.code === clientTypeCode) ?? null,
    [clientTypeCode, clientTypeDictionary],
  )

  const loadClientTypes = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/mtm/contact-dictionaries")
      const result = await response.json().catch(() => null) as {
        success?: boolean
        data?: { dictionaries?: ClientTypeDictionary[] }
      } | null
      if (!response.ok || !result?.success) return
      const dictionary = result.data?.dictionaries?.find((candidate) => candidate.kind === "CLIENT_TYPE" && candidate.status === "ACTIVE") ?? null
      setClientTypeDictionary(dictionary)
      const first = [...(dictionary?.entries ?? [])].sort((left, right) => left.order - right.order)[0]
      setClientTypeCode(first?.code ?? "")
      setClientTypeValues({})
      if (first) setForm((current) => ({ ...current, type: legacyContactTypeForCategory(first.code) }))
    } catch {
      setClientTypeDictionary(null)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    setOrganization(null)
    setError("")
    setSaving(false)
    void loadClientTypes()
  }, [loadClientTypes, open])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setError("")
  }

  const selectClientType = (code: string) => {
    setClientTypeCode(code)
    setClientTypeValues({})
    update("type", legacyContactTypeForCategory(code))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.lastName.trim() || !form.firstName.trim()) {
      setError(t("nameRequired"))
      return
    }
    if (!organization) {
      setError(t("workplaceRequired"))
      return
    }
    const missingCategoryField = selectedClientType?.fields?.find((field) => field.required && !clientTypeValues[field.key]?.trim())
    if (missingCategoryField) {
      setError(t("categoryFieldRequired", { field: localized(missingCategoryField.labels, locale) }))
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
          ...(clientTypeDictionary && selectedClientType ? {
            clientType: {
              dictionaryId: clientTypeDictionary.id,
              code: selectedClientType.code,
              values: Object.fromEntries((selectedClientType.fields ?? [])
                .filter((field) => clientTypeValues[field.key]?.trim())
                .map((field) => [field.key, field.type === "NUMBER" ? Number(clientTypeValues[field.key]) : clientTypeValues[field.key].trim()])),
            },
          } : {}),
          primaryWorkplace: {
            customerId: organization.id,
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
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="contact-create-type">{t("type")} *</Label>
                {clientTypeDictionary ? (
                  <Select id="contact-create-type" value={clientTypeCode} onChange={(event) => selectClientType(event.target.value)}>
                    {[...clientTypeDictionary.entries].sort((left, right) => left.order - right.order).map((entry) => <option key={entry.code} value={entry.code}>{localized(entry.labels, locale)}</option>)}
                  </Select>
                ) : (
                  <Select id="contact-create-type" value={form.type} onChange={(event) => update("type", event.target.value as ContactType)}>
                    <option value="DOCTOR">{t("types.DOCTOR")}</option>
                    <option value="PHARMACIST">{t("types.PHARMACIST")}</option>
                    <option value="OTHER">{t("types.OTHER")}</option>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5"><Label htmlFor="contact-create-last-name">{t("lastName")} *</Label><Input id="contact-create-last-name" value={form.lastName} onChange={(event) => update("lastName", event.target.value)} autoComplete="family-name" /></div>
              <div className="space-y-1.5"><Label htmlFor="contact-create-first-name">{t("firstName")} *</Label><Input id="contact-create-first-name" value={form.firstName} onChange={(event) => update("firstName", event.target.value)} autoComplete="given-name" /></div>
              <div className="space-y-1.5"><Label htmlFor="contact-create-middle-name">{t("middleName")}</Label><Input id="contact-create-middle-name" value={form.middleName} onChange={(event) => update("middleName", event.target.value)} autoComplete="additional-name" /></div>
              {form.type === "DOCTOR" && !selectedClientType?.fields?.some((field) => field.key === "specialty") ? <div className="space-y-1.5"><Label htmlFor="contact-create-specialty">{t("specialty")}</Label><ContactSpecialtyInput id="contact-create-specialty" value={form.specialtyName} onChange={(value) => update("specialtyName", value)} specialties={specialties} chooseLabel={t("specialtyChoose")} placeholder={t("specialtyPlaceholder")} /></div> : null}
              {[...(selectedClientType?.fields ?? [])].sort((left, right) => left.order - right.order).map((field) => (
                <div key={field.key} className={field.type === "TEXTAREA" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                  <Label htmlFor={`contact-create-category-${field.key}`}>{localized(field.labels, locale)}{field.required ? " *" : ""}</Label>
                  {field.type === "SELECT" ? (
                    <Select id={`contact-create-category-${field.key}`} value={clientTypeValues[field.key] ?? ""} onChange={(event) => setClientTypeValues((current) => ({ ...current, [field.key]: event.target.value }))}>
                      <option value="">{t("categoryFieldPlaceholder")}</option>
                      {(field.options ?? []).map((option) => <option key={option.code} value={option.code}>{localized(option.labels, locale)}</option>)}
                    </Select>
                  ) : field.type === "TEXTAREA" ? (
                    <Textarea id={`contact-create-category-${field.key}`} rows={3} value={clientTypeValues[field.key] ?? ""} onChange={(event) => setClientTypeValues((current) => ({ ...current, [field.key]: event.target.value }))} />
                  ) : (
                    <Input id={`contact-create-category-${field.key}`} type={field.type === "DATE" ? "date" : field.type === "NUMBER" ? "number" : field.type === "EMAIL" ? "email" : "text"} inputMode={field.type === "PHONE" ? "tel" : field.type === "NUMBER" ? "decimal" : undefined} value={clientTypeValues[field.key] ?? ""} onChange={(event) => setClientTypeValues((current) => ({ ...current, [field.key]: event.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3 border-t pt-5" aria-labelledby="contact-create-workplace">
            <div className="flex items-start gap-2">
              <BriefcaseBusiness className="mt-0.5 h-4 w-4 text-primary" />
              <div><h3 id="contact-create-workplace" className="text-sm font-semibold">{t("workplaceSection")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("workplaceHint")}</p></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label id="contact-create-workplace-label" htmlFor="contact-create-workplace-search">{t("workplace")} *</Label>
                <MtmOrganizationPicker id="contact-create-workplace-search" labelId="contact-create-workplace-label" value={organization} onChange={(next) => { setOrganization(next); setError("") }} disabled={saving} />
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
