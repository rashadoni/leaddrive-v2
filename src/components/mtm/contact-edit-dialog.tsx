"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { CircleAlert, Save, Send } from "lucide-react"
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
import {
  coerceMtmContactRequiredFields,
  missingMtmContactRequiredFields,
  type MtmContactRequiredField,
} from "@/lib/mtm/contact-required-fields"

export type EditableMtmContact = {
  id: string
  updatedAt: string
  externalCode: string | null
  firstName: string
  lastName: string
  middleName: string | null
  type: string
  specialtyCode: string | null
  specialtyName: string | null
  qualificationCategory: string | null
  profile: string | null
  category: string
  status: string
  birthDate: string | null
  gender: string | null
  email: string | null
  phone: string | null
  messengerPhone: string | null
  workPhone: string | null
  homePhone: string | null
  mobilePhone: string | null
  viberPhone: string | null
  whatsappPhone: string | null
  telegramPhone: string | null
  postalCode: string | null
  addressRegion: string | null
  addressLocality: string | null
  addressDistrict: string | null
  addressStreet: string | null
  productCategory: string | null
  verificationStatus: string
  consentStatus: string
  contactPreference: string | null
  notes: string | null
}

type FormState = {
  externalCode: string
  firstName: string
  lastName: string
  middleName: string
  type: string
  specialtyCode: string
  specialtyName: string
  qualificationCategory: string
  profile: string
  category: string
  status: string
  birthDate: string
  gender: string
  email: string
  phone: string
  messengerPhone: string
  workPhone: string
  homePhone: string
  mobilePhone: string
  viberPhone: string
  whatsappPhone: string
  telegramPhone: string
  postalCode: string
  addressRegion: string
  addressLocality: string
  addressDistrict: string
  addressStreet: string
  productCategory: string
  verificationStatus: string
  consentStatus: string
  contactPreference: string
  notes: string
}

type ContactPatch = Record<string, string | null>

const NULLABLE_FIELDS = [
  "externalCode",
  "middleName",
  "specialtyCode",
  "specialtyName",
  "qualificationCategory",
  "profile",
  "gender",
  "email",
  "phone",
  "messengerPhone",
  "workPhone",
  "homePhone",
  "mobilePhone",
  "viberPhone",
  "whatsappPhone",
  "telegramPhone",
  "postalCode",
  "addressRegion",
  "addressLocality",
  "addressDistrict",
  "addressStreet",
  "productCategory",
  "contactPreference",
  "notes",
] as const satisfies readonly (keyof FormState)[]

const VALUE_FIELDS = [
  "firstName",
  "lastName",
  "type",
  "category",
  "status",
  "verificationStatus",
  "consentStatus",
] as const satisfies readonly (keyof FormState)[]

function dateValue(value: string | null): string {
  return value ? value.slice(0, 10) : ""
}

function formFromContact(contact: EditableMtmContact): FormState {
  return {
    externalCode: contact.externalCode ?? "",
    firstName: contact.firstName,
    lastName: contact.lastName,
    middleName: contact.middleName ?? "",
    type: contact.type,
    specialtyCode: contact.specialtyCode ?? "",
    specialtyName: contact.specialtyName ?? "",
    qualificationCategory: contact.qualificationCategory ?? "",
    profile: contact.profile ?? "",
    category: contact.category,
    status: contact.status,
    birthDate: dateValue(contact.birthDate),
    gender: contact.gender ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    messengerPhone: contact.messengerPhone ?? "",
    workPhone: contact.workPhone ?? "",
    homePhone: contact.homePhone ?? "",
    mobilePhone: contact.mobilePhone ?? "",
    viberPhone: contact.viberPhone ?? "",
    whatsappPhone: contact.whatsappPhone ?? "",
    telegramPhone: contact.telegramPhone ?? "",
    postalCode: contact.postalCode ?? "",
    addressRegion: contact.addressRegion ?? "",
    addressLocality: contact.addressLocality ?? "",
    addressDistrict: contact.addressDistrict ?? "",
    addressStreet: contact.addressStreet ?? "",
    productCategory: contact.productCategory ?? "",
    verificationStatus: contact.verificationStatus,
    consentStatus: contact.consentStatus,
    contactPreference: contact.contactPreference ?? "",
    notes: contact.notes ?? "",
  }
}

function changedFields(form: FormState, contact: EditableMtmContact): ContactPatch {
  const initial = formFromContact(contact)
  const patch: ContactPatch = {}

  for (const key of NULLABLE_FIELDS) {
    if (form[key] !== initial[key]) patch[key] = form[key].trim() || null
  }
  for (const key of VALUE_FIELDS) {
    if (form[key] !== initial[key]) patch[key] = form[key]
  }
  if (form.birthDate !== initial.birthDate) patch.birthDate = form.birthDate || null

  return patch
}

function idempotencyKey(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === "function") {
    return `contact-${cryptoApi.randomUUID()}`
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint32Array(4)
    cryptoApi.getRandomValues(bytes)
    return `contact-${Array.from(bytes, (value) => value.toString(16)).join("-")}`
  }
  return `contact-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : null}
      </Label>
      {children}
    </div>
  )
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="grid gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
      <legend className="px-2 text-sm font-semibold">{title}</legend>
      <p className="-mt-2 text-xs text-muted-foreground">{description}</p>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </fieldset>
  )
}

export function MtmContactEditDialog({
  open,
  onOpenChange,
  contact,
  canManage,
  canRequestChanges,
  requiredFields,
  orgId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact: EditableMtmContact
  canManage: boolean
  canRequestChanges: boolean
  requiredFields: readonly MtmContactRequiredField[]
  orgId?: string
  onSaved: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactEdit")
  const initialForm = useMemo(() => formFromContact(contact), [contact])
  const [form, setForm] = useState<FormState>(initialForm)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const submission = useRef<{ body: string; key: string } | null>(null)
  const requestMode = !canManage && canRequestChanges
  const configuredRequiredFields = useMemo(
    () => coerceMtmContactRequiredFields(requiredFields),
    [requiredFields],
  )
  const requiredFieldSet = useMemo(() => new Set(configuredRequiredFields), [configuredRequiredFields])
  const isRequired = (field: MtmContactRequiredField) => requiredFieldSet.has(field)
  const requiredFieldLabel = (field: MtmContactRequiredField): string => {
    const keys: Record<MtmContactRequiredField, string> = {
      firstName: "firstName",
      lastName: "lastName",
      middleName: "middleName",
      externalCode: "externalCode",
      birthDate: "birthDate",
      gender: "gender",
      specialtyName: "specialty",
      qualificationCategory: "qualification",
      profile: "profile",
      email: "email",
      phone: "phone",
      mobilePhone: "mobilePhone",
      workPhone: "workPhone",
      messengerPhone: "messengerPhone",
      postalCode: "postalCode",
      addressRegion: "region",
      addressLocality: "locality",
      addressDistrict: "district",
      addressStreet: "street",
      productCategory: "productCategory",
    }
    return t(keys[field])
  }

  useEffect(() => {
    if (!open) return
    setForm(initialForm)
    setReason("")
    setError("")
    setSaving(false)
    submission.current = null
  }, [initialForm, open])

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setError("")
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canManage && !canRequestChanges) return
    const missingRequiredFields = missingMtmContactRequiredFields(
      form as unknown as Record<string, unknown>,
      configuredRequiredFields,
    )
    if (missingRequiredFields.length > 0) {
      setError(t("requiredFieldsError", {
        fields: missingRequiredFields.map(requiredFieldLabel).join(", "),
      }))
      return
    }

    const patch = changedFields(form, contact)
    if (!Object.keys(patch).length) {
      setError(t("noChangesError"))
      return
    }
    if (requestMode && reason.trim().length < 3) {
      setError(t("reasonError"))
      return
    }

    setSaving(true)
    setError("")
    try {
      let url = `/api/v1/mtm/contacts/${contact.id}`
      let body: Record<string, unknown> = {
        expectedContactUpdatedAt: contact.updatedAt,
        ...patch,
      }

      if (requestMode) {
        url += "/change-requests"
        const stableBody = JSON.stringify({
          expectedContactUpdatedAt: contact.updatedAt,
          kind: "CONTACT_UPDATE",
          payload: patch,
          reason: reason.trim(),
        })
        if (!submission.current || submission.current.body !== stableBody) {
          submission.current = { body: stableBody, key: idempotencyKey() }
        }
        body = {
          idempotencyKey: submission.current.key,
          expectedContactUpdatedAt: contact.updatedAt,
          kind: "CONTACT_UPDATE",
          payload: patch,
          reason: reason.trim(),
        }
      }

      const response = await fetch(url, {
        method: requestMode ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify(body),
      })
      const result = await response.json() as { error?: string; code?: string; data?: { fields?: MtmContactRequiredField[] } }
      if (!response.ok) {
        if (result.code === "MTM_CONTACT_CONFLICT") throw new Error(t("conflictError"))
        if (result.code === "MTM_CONTACT_REQUIRED_FIELDS") {
          const fields = result.data?.fields ?? configuredRequiredFields
          throw new Error(t("requiredFieldsError", { fields: fields.map(requiredFieldLabel).join(", ") }))
        }
        throw new Error(result.error || t("saveError"))
      }

      await onSaved()
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen)
      }}
      widthClassName="max-w-5xl"
      maxHeightClassName="max-h-[94vh]"
    >
      <DialogHeader>
        <DialogTitle>{requestMode ? t("requestTitle") : t("editTitle")}</DialogTitle>
        <DialogDescription>{requestMode ? t("requestDescription") : t("editDescription")}</DialogDescription>
      </DialogHeader>

      <form onSubmit={submit}>
        <DialogContent className="space-y-5">
          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 flex-none" />
              <span>{error}</span>
            </div>
          ) : null}

          <FormSection title={t("identityTitle")} description={t("identityDescription")}>
            <Field id="contact-last-name" label={t("lastName")} required={isRequired("lastName")}>
              <Input id="contact-last-name" value={form.lastName} onChange={(event) => update("lastName", event.target.value)} maxLength={120} required />
            </Field>
            <Field id="contact-first-name" label={t("firstName")} required={isRequired("firstName")}>
              <Input id="contact-first-name" value={form.firstName} onChange={(event) => update("firstName", event.target.value)} maxLength={120} required />
            </Field>
            <Field id="contact-middle-name" label={t("middleName")} required={isRequired("middleName")}>
              <Input id="contact-middle-name" value={form.middleName} onChange={(event) => update("middleName", event.target.value)} maxLength={120} required={isRequired("middleName")} />
            </Field>
            <Field id="contact-external-code" label={t("externalCode")} required={isRequired("externalCode")}>
              <Input id="contact-external-code" value={form.externalCode} onChange={(event) => update("externalCode", event.target.value)} maxLength={500} required={isRequired("externalCode")} />
            </Field>
            <Field id="contact-birth-date" label={t("birthDate")} required={isRequired("birthDate")}>
              <Input id="contact-birth-date" type="date" value={form.birthDate} onChange={(event) => update("birthDate", event.target.value)} required={isRequired("birthDate")} />
            </Field>
            <Field id="contact-gender" label={t("gender")} required={isRequired("gender")}>
              <Input id="contact-gender" value={form.gender} onChange={(event) => update("gender", event.target.value)} maxLength={50} required={isRequired("gender")} />
            </Field>
          </FormSection>

          <FormSection title={t("professionalTitle")} description={t("professionalDescription")}>
            <Field id="contact-type" label={t("contactType")}>
              <Select id="contact-type" value={form.type} onChange={(event) => update("type", event.target.value)}>
                {["DOCTOR", "PHARMACIST", "OTHER"].map((value) => <option key={value} value={value}>{t(`types.${value}`)}</option>)}
              </Select>
            </Field>
            <Field id="contact-category" label={t("category")}>
              <Select id="contact-category" value={form.category} onChange={(event) => update("category", event.target.value)}>
                {["A", "B", "C", "D"].map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </Field>
            <Field id="contact-specialty" label={t("specialty")} required={isRequired("specialtyName")}>
              <Input id="contact-specialty" value={form.specialtyName} onChange={(event) => update("specialtyName", event.target.value)} maxLength={500} required={isRequired("specialtyName")} />
            </Field>
            <Field id="contact-specialty-code" label={t("specialtyCode")}>
              <Input id="contact-specialty-code" value={form.specialtyCode} onChange={(event) => update("specialtyCode", event.target.value)} maxLength={500} />
            </Field>
            <Field id="contact-qualification" label={t("qualification")} required={isRequired("qualificationCategory")}>
              <Input id="contact-qualification" value={form.qualificationCategory} onChange={(event) => update("qualificationCategory", event.target.value)} maxLength={500} required={isRequired("qualificationCategory")} />
            </Field>
            <Field id="contact-profile" label={t("profile")} required={isRequired("profile")}>
              <Input id="contact-profile" value={form.profile} onChange={(event) => update("profile", event.target.value)} maxLength={500} required={isRequired("profile")} />
            </Field>
            <Field id="contact-product-category" label={t("productCategory")} required={isRequired("productCategory")}>
              <Input id="contact-product-category" value={form.productCategory} onChange={(event) => update("productCategory", event.target.value)} maxLength={500} required={isRequired("productCategory")} />
            </Field>
            <Field id="contact-status" label={t("status")}>
              <Select
                id="contact-status"
                value={form.status}
                disabled={["DUPLICATE", "MERGED"].includes(form.status)}
                onChange={(event) => update("status", event.target.value)}
              >
                {["DUPLICATE", "MERGED"].includes(form.status) ? (
                  <option value={form.status}>{t(`statuses.${form.status}`)}</option>
                ) : null}
                {["ACTIVE", "INACTIVE", "PROSPECT"].map((value) => <option key={value} value={value}>{t(`statuses.${value}`)}</option>)}
              </Select>
            </Field>
          </FormSection>

          <FormSection title={t("channelsTitle")} description={t("channelsDescription")}>
            <Field id="contact-email" label={t("email")} required={isRequired("email")}>
              <Input id="contact-email" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} maxLength={200} required={isRequired("email")} />
            </Field>
            <Field id="contact-phone" label={t("phone")} required={isRequired("phone")}>
              <Input id="contact-phone" type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} maxLength={500} required={isRequired("phone")} />
            </Field>
            <Field id="contact-mobile-phone" label={t("mobilePhone")} required={isRequired("mobilePhone")}>
              <Input id="contact-mobile-phone" type="tel" value={form.mobilePhone} onChange={(event) => update("mobilePhone", event.target.value)} maxLength={500} required={isRequired("mobilePhone")} />
            </Field>
            <Field id="contact-work-phone" label={t("workPhone")} required={isRequired("workPhone")}>
              <Input id="contact-work-phone" type="tel" value={form.workPhone} onChange={(event) => update("workPhone", event.target.value)} maxLength={500} required={isRequired("workPhone")} />
            </Field>
            <Field id="contact-home-phone" label={t("homePhone")}>
              <Input id="contact-home-phone" type="tel" value={form.homePhone} onChange={(event) => update("homePhone", event.target.value)} maxLength={500} />
            </Field>
            <Field id="contact-messenger-phone" label={t("messengerPhone")} required={isRequired("messengerPhone")}>
              <Input id="contact-messenger-phone" type="tel" value={form.messengerPhone} onChange={(event) => update("messengerPhone", event.target.value)} maxLength={500} required={isRequired("messengerPhone")} />
            </Field>
            <Field id="contact-viber-phone" label="Viber">
              <Input id="contact-viber-phone" type="tel" value={form.viberPhone} onChange={(event) => update("viberPhone", event.target.value)} maxLength={500} />
            </Field>
            <Field id="contact-whatsapp-phone" label="WhatsApp">
              <Input id="contact-whatsapp-phone" type="tel" value={form.whatsappPhone} onChange={(event) => update("whatsappPhone", event.target.value)} maxLength={500} />
            </Field>
            <Field id="contact-telegram-phone" label="Telegram">
              <Input id="contact-telegram-phone" type="tel" value={form.telegramPhone} onChange={(event) => update("telegramPhone", event.target.value)} maxLength={500} />
            </Field>
          </FormSection>

          <FormSection title={t("addressTitle")} description={t("addressDescription")}>
            <Field id="contact-postal-code" label={t("postalCode")} required={isRequired("postalCode")}>
              <Input id="contact-postal-code" value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)} maxLength={500} required={isRequired("postalCode")} />
            </Field>
            <Field id="contact-region" label={t("region")} required={isRequired("addressRegion")}>
              <Input id="contact-region" value={form.addressRegion} onChange={(event) => update("addressRegion", event.target.value)} maxLength={500} required={isRequired("addressRegion")} />
            </Field>
            <Field id="contact-locality" label={t("locality")} required={isRequired("addressLocality")}>
              <Input id="contact-locality" value={form.addressLocality} onChange={(event) => update("addressLocality", event.target.value)} maxLength={500} required={isRequired("addressLocality")} />
            </Field>
            <Field id="contact-district" label={t("district")} required={isRequired("addressDistrict")}>
              <Input id="contact-district" value={form.addressDistrict} onChange={(event) => update("addressDistrict", event.target.value)} maxLength={500} required={isRequired("addressDistrict")} />
            </Field>
            <div className="md:col-span-2">
              <Field id="contact-street" label={t("street")} required={isRequired("addressStreet")}>
                <Input id="contact-street" value={form.addressStreet} onChange={(event) => update("addressStreet", event.target.value)} maxLength={500} required={isRequired("addressStreet")} />
              </Field>
            </div>
          </FormSection>

          <FormSection title={t("governanceTitle")} description={t("governanceDescription")}>
            <Field id="contact-verification" label={t("verification")}>
              <Select id="contact-verification" value={form.verificationStatus} onChange={(event) => update("verificationStatus", event.target.value)}>
                {["UNVERIFIED", "VERIFIED", "REJECTED"].map((value) => <option key={value} value={value}>{t(`verificationStatuses.${value}`)}</option>)}
              </Select>
            </Field>
            <Field id="contact-consent" label={t("consent")}>
              <Select id="contact-consent" value={form.consentStatus} onChange={(event) => update("consentStatus", event.target.value)}>
                {["UNKNOWN", "GRANTED", "REVOKED"].map((value) => <option key={value} value={value}>{t(`consentStatuses.${value}`)}</option>)}
              </Select>
            </Field>
            <Field id="contact-preference" label={t("preferredChannel")}>
              <Select id="contact-preference" value={form.contactPreference} onChange={(event) => update("contactPreference", event.target.value)}>
                <option value="">{t("notSet")}</option>
                {["PHONE", "EMAIL", "WHATSAPP", "VIBER", "TELEGRAM", "DO_NOT_CONTACT"].map((value) => <option key={value} value={value}>{t(`preferences.${value}`)}</option>)}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field id="contact-notes" label={t("notes")}>
                <Textarea id="contact-notes" value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={4} maxLength={2000} />
              </Field>
            </div>
          </FormSection>

          {requestMode ? (
            <div className="grid gap-1.5 rounded-2xl border border-primary/25 bg-primary/5 p-4">
              <Label htmlFor="contact-change-reason">
                {t("reason")}
                <span className="ml-1 text-destructive" aria-hidden="true">*</span>
              </Label>
              <Textarea
                id="contact-change-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value)
                  setError("")
                }}
                placeholder={t("reasonPlaceholder")}
                minLength={3}
                maxLength={1000}
                required
              />
              <p className="text-xs text-muted-foreground">{t("reasonHint")}</p>
            </div>
          ) : null}
        </DialogContent>

        <DialogFooter className="flex-col-reverse sm:flex-row">
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={saving || (!canManage && !canRequestChanges)}>
            {requestMode ? <Send className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saving ? t("saving") : requestMode ? t("submitRequest") : t("save")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
