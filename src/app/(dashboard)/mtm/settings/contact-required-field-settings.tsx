"use client"

import { useTranslations } from "next-intl"
import { Switch } from "@/components/ui/switch"
import {
  coerceMtmContactHiddenFields,
  isMtmContactSwitchableField,
  MTM_CONTACT_SWITCHABLE_FIELD_KEYS,
  type MtmContactSwitchableField,
} from "@/lib/mtm/contact-field-visibility"
import {
  coerceMtmContactRequiredFields,
  MTM_CONTACT_REQUIRED_FIELD_KEYS,
  type MtmContactRequiredField,
} from "@/lib/mtm/contact-required-fields"
import { cn } from "@/lib/utils"

type ContactField = MtmContactRequiredField | MtmContactSwitchableField
type FieldState = "hidden" | "shown" | "required"

const LOCKED_FIELDS = new Set<ContactField>(["firstName", "lastName"])
const REQUIRABLE = new Set<string>(MTM_CONTACT_REQUIRED_FIELD_KEYS)

const FIELD_GROUPS: readonly { key: string; fields: readonly ContactField[] }[] = [
  { key: "identity", fields: ["firstName", "lastName", "middleName", "externalCode", "birthDate", "gender"] },
  { key: "professional", fields: ["specialtyName", "specialtyCode", "qualificationCategory", "profile", "productCategory", "coverage"] },
  { key: "communication", fields: ["email", "phone", "mobilePhone", "workPhone", "homePhone", "messengerPhone", "viberPhone", "whatsappPhone", "telegramPhone"] },
  { key: "address", fields: ["postalCode", "addressRegion", "addressLocality", "addressDistrict", "addressStreet"] },
]

/**
 * What a client card consists of in this tenant. Owner 2026-10-02: «чтобы
 * завтра, если буду продавать другому профилю, была возможность отключать
 * ненужные поля». A switch per field — on or off, the way a phone's settings
 * do it — and a tick for «required» on the fields that are on.
 */
export function ContactFieldSettings({
  value,
  onChange,
  hidden,
  onHiddenChange,
}: {
  value: unknown
  onChange: (value: MtmContactRequiredField[]) => void
  hidden: unknown
  onHiddenChange: (value: MtmContactSwitchableField[]) => void
}) {
  const t = useTranslations("mtmContactFieldPolicy")
  const hiddenFields = coerceMtmContactHiddenFields(hidden)
  const hiddenSet = new Set<string>(hiddenFields)
  // A hidden field is never required, whatever the stored list says.
  const required = coerceMtmContactRequiredFields(value)
  const requiredSet = new Set<string>(required.filter((field) => !hiddenSet.has(field)))

  const stateOf = (field: ContactField): FieldState => (
    hiddenSet.has(field) ? "hidden" : requiredSet.has(field) ? "required" : "shown"
  )

  const setState = (field: ContactField, state: FieldState) => {
    if (LOCKED_FIELDS.has(field) || stateOf(field) === state) return
    if (isMtmContactSwitchableField(field)) {
      const nextHidden = state === "hidden"
        ? [...hiddenFields, field]
        : hiddenFields.filter((candidate) => candidate !== field)
      if (nextHidden.length !== hiddenFields.length) onHiddenChange(coerceMtmContactHiddenFields(nextHidden))
    }
    if (REQUIRABLE.has(field)) {
      const requirable = field as MtmContactRequiredField
      const nextRequired = state === "required"
        ? [...required, requirable]
        : required.filter((candidate) => candidate !== requirable)
      if (nextRequired.length !== required.length) onChange(coerceMtmContactRequiredFields(nextRequired))
    }
  }

  return (
    <div data-testid="mtm-contact-field-settings">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
        <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">{t("selectedCount", { count: requiredSet.size })}</span>
        {hiddenFields.length > 0 ? (
          <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">{t("hiddenCount", { count: hiddenFields.length })}</span>
        ) : null}
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-6 lg:grid-cols-2">
        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.key} className="grid content-start">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`groups.${group.key}`)}
            </legend>
            <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
              {group.fields.map((field) => {
                const state = stateOf(field)
                const locked = LOCKED_FIELDS.has(field)
                const label = t(`fields.${field}`)
                return (
                  <div
                    key={field}
                    data-field={field}
                    data-state={locked ? "locked" : state}
                    className={cn("flex min-h-12 items-center gap-3 px-3 py-1.5", state === "hidden" && "bg-muted/40")}
                  >
                    {locked ? (
                      <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
                    ) : (
                      // The whole row toggles: the name is the switch's label.
                      <label className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <Switch
                          checked={state !== "hidden"}
                          aria-label={`${label}: ${t("stateShown")}`}
                          onCheckedChange={(on) => setState(field, on ? "shown" : "hidden")}
                        />
                        <span className={cn("min-w-0 text-sm font-medium", state === "hidden" && "text-muted-foreground")}>{label}</span>
                        {state === "hidden" ? <span className="text-xs text-muted-foreground">· {t("stateHidden")}</span> : null}
                      </label>
                    )}
                    {locked ? (
                      <span className="text-xs text-muted-foreground">{t("alwaysRequired")}</span>
                    ) : REQUIRABLE.has(field) && state !== "hidden" ? (
                      <label className="flex min-h-9 shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={state === "required"}
                          onChange={(event) => setState(field, event.target.checked ? "required" : "shown")}
                        />
                        <span className={cn(state === "required" && "font-semibold text-foreground")}>{t("stateRequired")}</span>
                      </label>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t("enforcementHint")}</p>
    </div>
  )
}

const RENDERED = new Set<string>(FIELD_GROUPS.flatMap((group) => group.fields))
if (
  MTM_CONTACT_REQUIRED_FIELD_KEYS.some((field) => !RENDERED.has(field))
  || MTM_CONTACT_SWITCHABLE_FIELD_KEYS.some((field) => !RENDERED.has(field))
) {
  throw new Error("Every MTM contact field that can be required or hidden must be rendered in settings")
}
