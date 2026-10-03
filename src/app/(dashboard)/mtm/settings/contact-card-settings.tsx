"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { IdCard, Loader2, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { legacyContactTypeForCategory } from "@/lib/mtm/contact-category-editor"
import {
  coerceMtmContactHiddenFields,
  type MtmContactSwitchableField,
} from "@/lib/mtm/contact-field-visibility"
import {
  coerceMtmContactRequiredFields,
  type MtmContactRequiredField,
} from "@/lib/mtm/contact-required-fields"
import { coerceMtmContactSpecialties } from "@/lib/mtm/contact-specialties"
import { coerceMtmContactClasses, MTM_CONTACT_CLASS_PRIORITY } from "@/lib/mtm/contact-classes"
import { mtmSettingValuesEqual } from "@/lib/mtm/settings-validation"
import { cn } from "@/lib/utils"
import { ContactCategorySettings } from "./contact-category-settings"
import { ContactFieldSettings } from "./contact-required-field-settings"
import { ContactSpecialtySettings } from "./contact-specialty-settings"

type Tab = "categories" | "classes" | "fields" | "specialties"

/**
 * Everything a tenant decides about its client card, in one place.
 *
 * Owner 2026-10-02, looking at the categories block on this page: «они тут
 * будут отображаться? надо сделать UI часть более юзер френдли». Categories,
 * the fields of the card and the specialty list were three blocks apart on a
 * long page, saved by two different buttons. Here they are three tabs named in
 * words, and every tab has its own «Сохранить» right under what was changed.
 */
export function ContactCardSettings({
  requiredFields,
  hiddenFields,
  specialties,
  classes,
  onSaved,
}: {
  /** The values the server holds (not the page's unsaved draft). */
  requiredFields: unknown
  hiddenFields: unknown
  specialties: unknown
  /** The tenant's client classes (A, B, C, VIP…); absent on an older caller = the defaults. */
  classes?: unknown
  /** Tells the page what is now stored, so its own «unsaved» bar stays quiet. */
  onSaved: (changes: Record<string, unknown>) => void
}) {
  const t = useTranslations("mtmContactCard")
  const [tab, setTab] = useState<Tab>("categories")

  const storedFields = useMemo(() => ({
    required: coerceMtmContactRequiredFields(requiredFields),
    hidden: coerceMtmContactHiddenFields(hiddenFields),
  }), [hiddenFields, requiredFields])
  const storedSpecialties = useMemo(() => coerceMtmContactSpecialties(specialties), [specialties])
  const storedClasses = useMemo(() => coerceMtmContactClasses(classes), [classes])

  const [fieldsDraft, setFieldsDraft] = useState(storedFields)
  const [specialtiesDraft, setSpecialtiesDraft] = useState(storedSpecialties)
  const [classesDraft, setClassesDraft] = useState(storedClasses)
  // What the server holds changed (saved here, or reloaded by the page):
  // take it. An unchanged reload must not wipe what is being edited.
  const [seenFields, setSeenFields] = useState(storedFields)
  if (!mtmSettingValuesEqual(seenFields, storedFields)) {
    setSeenFields(storedFields)
    setFieldsDraft(storedFields)
  }
  const [seenSpecialties, setSeenSpecialties] = useState(storedSpecialties)
  if (!mtmSettingValuesEqual(seenSpecialties, storedSpecialties)) {
    setSeenSpecialties(storedSpecialties)
    setSpecialtiesDraft(storedSpecialties)
  }

  const [seenClasses, setSeenClasses] = useState(storedClasses)
  if (!mtmSettingValuesEqual(seenClasses, storedClasses)) {
    setSeenClasses(storedClasses)
    setClassesDraft(storedClasses)
  }

  const [saving, setSaving] = useState<Tab | null>(null)
  const fieldsDirty = !mtmSettingValuesEqual(fieldsDraft, storedFields)
  const specialtiesDirty = !mtmSettingValuesEqual(specialtiesDraft, storedSpecialties)
  const classesDirty = !mtmSettingValuesEqual(classesDraft, storedClasses)

  const save = async (which: Tab, changes: Record<string, unknown>) => {
    setSaving(which)
    try {
      const response = await fetch("/api/v1/mtm/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(response.status === 403 ? t("saveForbidden") : body?.error || t("saveFailed"))
      toast.success(t("saved"))
      onSaved(changes)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"))
    } finally {
      setSaving(null)
    }
  }

  const showsSpecialty = !fieldsDraft.hidden.includes("specialtyName")
  const tabs: Array<{ id: Tab; label: string; dirty: boolean }> = [
    { id: "categories", label: t("tabs.categories"), dirty: false },
    // The letters themselves in the tab name: a person looking for "A, B, C,
    // VIP" finds it without opening anything.
    { id: "classes", label: t("tabs.classes", { list: classesDraft.join(", ") }), dirty: classesDirty },
    {
      id: "fields",
      label: fieldsDraft.hidden.length > 0 ? t("tabs.fieldsHidden", { count: fieldsDraft.hidden.length }) : t("tabs.fields"),
      dirty: fieldsDirty,
    },
    { id: "specialties", label: t("tabs.specialties", { count: specialtiesDraft.length }), dirty: specialtiesDirty },
  ]

  return (
    <section data-testid="mtm-contact-card-settings" className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5" aria-labelledby="mtm-contact-card-title">
      <div className="grid max-w-3xl gap-1">
        <h2 id="mtm-contact-card-title" className="flex items-center gap-2 text-base font-semibold">
          <IdCard className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div role="tablist" aria-labelledby="mtm-contact-card-title" className="mt-4 flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`mtm-contact-card-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`mtm-contact-card-panel-${item.id}`}
            data-testid={`mtm-contact-card-tab-${item.id}`}
            onClick={() => setTab(item.id)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
              tab === item.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-zinc-200 bg-background text-foreground hover:border-zinc-300 dark:border-zinc-700",
            )}
          >
            {item.label}
            {item.dirty ? <span className={cn("h-2 w-2 rounded-full", tab === item.id ? "bg-primary-foreground" : "bg-amber-500")} title={t("dirty")} aria-label={t("dirty")} /> : null}
          </button>
        ))}
      </div>

      {/* All three stay mounted: switching tabs must not drop what was typed. */}
      <div role="tabpanel" id="mtm-contact-card-panel-categories" aria-labelledby="mtm-contact-card-tab-categories" hidden={tab !== "categories"} className="pt-4">
        <ContactCategorySettings
          embedded
          standardNote={(category) => (
            // Doctors pick a specialty; say so where their fields are listed,
            // with the way to the list.
            legacyContactTypeForCategory(category.code) === "DOCTOR" && showsSpecialty ? (
              <p data-testid="mtm-contact-category-specialty-note" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-primary/5 px-3 py-2 text-sm">
                <span>{t("specialtyNote", { count: specialtiesDraft.length })}</span>
                <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setTab("specialties")}>
                  {t("openSpecialties")}
                </button>
              </p>
            ) : null
          )}
        />
      </div>

      <div role="tabpanel" id="mtm-contact-card-panel-classes" aria-labelledby="mtm-contact-card-tab-classes" hidden={tab !== "classes"} className="pt-4">
        <div data-testid="mtm-contact-class-settings">
          <p className="max-w-3xl text-sm text-muted-foreground">{t("classesHint")}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {MTM_CONTACT_CLASS_PRIORITY.map((value) => {
              const checked = classesDraft.includes(value)
              const last = checked && classesDraft.length === 1
              return (
                <label
                  key={value}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700",
                    last ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    data-testid={`mtm-contact-class-setting-${value}`}
                    className="h-5 w-5 accent-primary"
                    checked={checked}
                    // The last one stays: a card with no category to choose is unusable.
                    disabled={last}
                    onChange={(event) => setClassesDraft(coerceMtmContactClasses(
                      event.target.checked ? [...classesDraft, value] : classesDraft.filter((item) => item !== value),
                    ))}
                  />
                  <span className="font-medium">{t(`classLabel_${value}` as never)}</span>
                </label>
              )
            })}
          </div>
          <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
            {classesDraft.length === 1 ? `${t("classesMinOne")} ` : ""}{t("classesKept")}
          </p>
        </div>
        <SaveBar
          testId="mtm-contact-classes-save"
          dirty={classesDirty}
          saving={saving === "classes"}
          onCancel={() => setClassesDraft(storedClasses)}
          onSave={() => void save("classes", { contactClasses: classesDraft })}
          t={t}
        />
      </div>

      <div role="tabpanel" id="mtm-contact-card-panel-fields" aria-labelledby="mtm-contact-card-tab-fields" hidden={tab !== "fields"} className="pt-4">
        <ContactFieldSettings
          value={fieldsDraft.required}
          onChange={(required: MtmContactRequiredField[]) => setFieldsDraft((current) => ({ ...current, required }))}
          hidden={fieldsDraft.hidden}
          onHiddenChange={(hidden: MtmContactSwitchableField[]) => setFieldsDraft((current) => ({ ...current, hidden }))}
        />
        <SaveBar
          testId="mtm-contact-fields-save"
          dirty={fieldsDirty}
          saving={saving === "fields"}
          onCancel={() => setFieldsDraft(storedFields)}
          onSave={() => void save("fields", { contactRequiredFields: fieldsDraft.required, contactHiddenFields: fieldsDraft.hidden })}
          t={t}
        />
      </div>

      <div role="tabpanel" id="mtm-contact-card-panel-specialties" aria-labelledby="mtm-contact-card-tab-specialties" hidden={tab !== "specialties"} className="pt-4">
        <ContactSpecialtySettings value={specialtiesDraft} onChange={setSpecialtiesDraft} />
        <SaveBar
          testId="mtm-contact-specialties-save"
          dirty={specialtiesDirty}
          saving={saving === "specialties"}
          onCancel={() => setSpecialtiesDraft(storedSpecialties)}
          onSave={() => void save("specialties", { contactSpecialties: specialtiesDraft })}
          t={t}
        />
      </div>
    </section>
  )
}

function SaveBar({
  dirty,
  saving,
  onCancel,
  onSave,
  testId,
  t,
}: {
  dirty: boolean
  saving: boolean
  onCancel: () => void
  onSave: () => void
  testId: string
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
      <span role="status" aria-live="polite" className={cn("text-sm", dirty ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
        {dirty ? t("dirty") : t("noChanges")}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={onCancel} disabled={!dirty || saving}>
          <RotateCcw className="h-4 w-4" />{t("cancel")}
        </Button>
        <Button type="button" data-testid={testId} className="min-h-11" onClick={onSave} disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  )
}
