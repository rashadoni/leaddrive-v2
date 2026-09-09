"use client"

import { useTranslations } from "next-intl"
import { Check, ShieldCheck } from "lucide-react"
import {
  coerceMtmContactRequiredFields,
  MTM_CONTACT_REQUIRED_FIELD_KEYS,
  type MtmContactRequiredField,
} from "@/lib/mtm/contact-required-fields"
import { cn } from "@/lib/utils"

const LOCKED_FIELDS = new Set<MtmContactRequiredField>(["firstName", "lastName"])

const FIELD_GROUPS: readonly { key: string; fields: readonly MtmContactRequiredField[] }[] = [
  { key: "identity", fields: ["firstName", "lastName", "middleName", "externalCode", "birthDate", "gender"] },
  { key: "professional", fields: ["specialtyName", "qualificationCategory", "profile", "productCategory"] },
  { key: "communication", fields: ["email", "phone", "mobilePhone", "workPhone", "messengerPhone"] },
  { key: "address", fields: ["postalCode", "addressRegion", "addressLocality", "addressDistrict", "addressStreet"] },
]

export function ContactRequiredFieldSettings({
  value,
  onChange,
}: {
  value: unknown
  onChange: (value: MtmContactRequiredField[]) => void
}) {
  const t = useTranslations("mtmContactFieldPolicy")
  const selected = coerceMtmContactRequiredFields(value)
  const selectedSet = new Set(selected)

  const toggle = (field: MtmContactRequiredField) => {
    if (LOCKED_FIELDS.has(field)) return
    onChange(coerceMtmContactRequiredFields(
      selectedSet.has(field)
        ? selected.filter((candidate) => candidate !== field)
        : [...selected, field],
    ))
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid max-w-3xl gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {t("selectedCount", { count: selected.length })}
        </span>
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-6 lg:grid-cols-2">
        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.key} className="grid gap-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`groups.${group.key}`)}
            </legend>
            {group.fields.map((field) => {
              const checked = selectedSet.has(field)
              const locked = LOCKED_FIELDS.has(field)
              return (
                <label
                  key={field}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors",
                    checked
                      ? "border-primary/35 bg-primary/5"
                      : "border-zinc-200 hover:bg-muted/50 dark:border-zinc-700",
                    locked && "cursor-default",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    disabled={locked}
                    onChange={() => toggle(field)}
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid h-5 w-5 flex-none place-items-center rounded-md border",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600",
                    )}
                  >
                    {checked ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{t(`fields.${field}`)}</span>
                  {locked ? <span className="text-xs text-muted-foreground">{t("alwaysRequired")}</span> : null}
                </label>
              )
            })}
          </fieldset>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t("enforcementHint")}</p>
    </section>
  )
}

if (FIELD_GROUPS.flatMap((group) => group.fields).length !== MTM_CONTACT_REQUIRED_FIELD_KEYS.length) {
  throw new Error("Every MTM contact required field must be rendered in settings")
}
