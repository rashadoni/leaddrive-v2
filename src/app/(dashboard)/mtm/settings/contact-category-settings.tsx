"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, CircleAlert, Loader2, Plus, RotateCcw, Save, Tags, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  CONTACT_CATEGORY_FIELD_TYPES,
  CONTACT_CATEGORY_LIMITS,
  contactCategoriesForSave,
  contactCategoriesFromEntries,
  contactCategoryIssues,
  contactCategoryLocale,
  renameContactCategoryLabels,
  type ContactCategory,
  type ContactCategoryField,
  type ContactCategoryFieldType,
  type ContactCategoryIssue,
  type ContactCategoryLabels,
  type ContactCategoryOption,
} from "@/lib/mtm/contact-category-editor"
import { cn } from "@/lib/utils"

/**
 * Editor rows carry a `uid` so React keeps an input mounted while its row is
 * renamed or moved. Identifiers that are stored (`code`, `key`) stay empty for
 * a new row until the save assigns them.
 */
type EditorOption = ContactCategoryOption & { uid: string }
type EditorField = Omit<ContactCategoryField, "options"> & { uid: string; options?: EditorOption[] }
type EditorCategory = Omit<ContactCategory, "fields"> & { uid: string; fields: EditorField[] }

type LoadedState = {
  dictionaryId: string | null
  categories: ContactCategory[]
  usage: Record<string, number>
}

const EMPTY_LABELS: ContactCategoryLabels = { ru: "", az: "", en: "" }

let uidCounter = 0
function nextUid(): string {
  uidCounter += 1
  return `row-${uidCounter}`
}

function toEditor(categories: ContactCategory[]): EditorCategory[] {
  return categories.map((category) => ({
    ...category,
    uid: nextUid(),
    fields: (category.fields ?? []).map(({ options, ...field }): EditorField => ({
      ...field,
      uid: nextUid(),
      ...(options ? { options: options.map((option) => ({ ...option, uid: nextUid() })) } : {}),
    })),
  }))
}

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function ContactCategorySettings({
  embedded = false,
  standardNote,
}: {
  /** Inside «Карточка клиента»: the tab carries the title and the frame. */
  embedded?: boolean
  /** What a category has besides its own fields (e.g. doctors: the specialty list). */
  standardNote?: (category: { code: string }) => ReactNode
} = {}) {
  const t = useTranslations("mtmContactCategories")
  const locale = contactCategoryLocale(useLocale())
  const [loaded, setLoaded] = useState<LoadedState | null>(null)
  const [categories, setCategories] = useState<EditorCategory[]>([])
  const [canConfigure, setCanConfigure] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [showIssues, setShowIssues] = useState(false)
  const newRowRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const response = await fetch("/api/v1/mtm/contact-categories", { headers: { Accept: "application/json" } })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: {
          dictionaryId: string | null
          categories: unknown
          usage: Record<string, number> | null
          capabilities?: { canConfigure?: boolean }
        }
      } | null
      if (!response.ok || !body?.success || !body.data) throw new Error(body?.error || t("loadFailed"))
      const next: LoadedState = {
        dictionaryId: body.data.dictionaryId,
        categories: contactCategoriesFromEntries(body.data.categories),
        usage: body.data.usage ?? {},
      }
      setLoaded(next)
      setCategories(toEditor(next.categories))
      setCanConfigure(Boolean(body.data.capabilities?.canConfigure))
      setShowIssues(false)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  // A freshly added row gets the cursor, so "add" followed by typing just works.
  useEffect(() => {
    if (!newRowRef.current) return
    const input = document.getElementById(newRowRef.current)
    newRowRef.current = null
    if (input instanceof HTMLInputElement) input.focus()
  })

  const payload = useMemo(() => contactCategoriesForSave(categories, locale), [categories, locale])
  const dirty = useMemo(() => {
    if (!loaded) return false
    // A brand-new row has no identifier yet, so compare what would be stored
    // against what is stored rather than the two editor states.
    return JSON.stringify(payload) !== JSON.stringify(contactCategoriesForSave(loaded.categories, locale))
  }, [loaded, locale, payload])
  const issues = useMemo(() => contactCategoryIssues(categories, locale), [categories, locale])

  const removedFields = useMemo(() => {
    if (!loaded) return []
    return loaded.categories.flatMap((before) => {
      const after = categories.find((category) => category.code === before.code)
      if (!after) return []
      const kept = new Set(after.fields.map((field) => field.key))
      return (before.fields ?? [])
        .filter((field) => !kept.has(field.key))
        .map((field) => `${field.labels[locale] || field.key} (${after.labels[locale] || before.labels[locale]})`)
    })
  }, [categories, loaded, locale])

  const updateCategory = (uid: string, updater: (category: EditorCategory) => EditorCategory) => {
    setCategories((current) => current.map((category) => category.uid === uid ? updater(category) : category))
  }
  const updateField = (categoryUid: string, fieldUid: string, updater: (field: EditorField) => EditorField) => {
    updateCategory(categoryUid, (category) => ({
      ...category,
      fields: category.fields.map((field) => field.uid === fieldUid ? updater(field) : field),
    }))
  }

  const addCategory = () => {
    const uid = nextUid()
    newRowRef.current = `contact-category-name-${uid}`
    setCategories((current) => [...current, { uid, code: "", order: current.length + 1, labels: { ...EMPTY_LABELS }, fields: [] }])
  }
  const addField = (categoryUid: string) => {
    const uid = nextUid()
    newRowRef.current = `contact-category-field-name-${uid}`
    updateCategory(categoryUid, (category) => ({
      ...category,
      fields: [...category.fields, { uid, key: "", order: category.fields.length + 1, type: "TEXT", required: false, labels: { ...EMPTY_LABELS } }],
    }))
  }
  const addOption = (categoryUid: string, fieldUid: string) => {
    const uid = nextUid()
    newRowRef.current = `contact-category-option-${uid}`
    updateField(categoryUid, fieldUid, (field) => ({
      ...field,
      options: [...(field.options ?? []), { uid, code: "", labels: { ...EMPTY_LABELS } }],
    }))
  }

  const removeCategory = (category: EditorCategory) => {
    if (categories.length === 1) {
      toast.error(t("lastCategory"))
      return
    }
    const contacts = category.code ? loaded?.usage[category.code] ?? 0 : 0
    if (contacts > 0) {
      toast.error(t("inUse", { name: category.labels[locale] || category.code, count: contacts }))
      return
    }
    setCategories((current) => current.filter((candidate) => candidate.uid !== category.uid))
  }

  const issueText = (issue: ContactCategoryIssue): string => {
    if (issue.kind === "NO_CATEGORIES") return t("issues.noCategories")
    const category = categories[issue.categoryIndex]
    const categoryName = category?.labels[locale].trim() || t("unnamedCategory", { number: issue.categoryIndex + 1 })
    if (issue.kind === "CATEGORY_NAME_REQUIRED") return t("issues.categoryNameRequired", { number: issue.categoryIndex + 1 })
    if (issue.kind === "CATEGORY_NAME_DUPLICATE") return t("issues.categoryNameDuplicate", { name: issue.name })
    const fieldName = category?.fields[issue.fieldIndex]?.labels[locale].trim() ?? ""
    if (issue.kind === "FIELD_NAME_REQUIRED") return t("issues.fieldNameRequired", { category: categoryName })
    if (issue.kind === "FIELD_NAME_DUPLICATE") return t("issues.fieldNameDuplicate", { category: categoryName, name: issue.name })
    if (issue.kind === "OPTIONS_REQUIRED") return t("issues.optionsRequired", { field: fieldName })
    return t("issues.optionNameRequired", { field: fieldName })
  }
  const hasIssue = (predicate: (issue: ContactCategoryIssue) => boolean) => showIssues && issues.some(predicate)

  const save = async () => {
    if (!loaded) return
    if (issues.length > 0) {
      setShowIssues(true)
      toast.error(issueText(issues[0]))
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/v1/mtm/contact-categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ expectedDictionaryId: loaded.dictionaryId, categories: payload }),
      })
      const body = await response.json().catch(() => null) as {
        error?: string
        code?: string
        data?: { inUse?: Array<{ code: string; contacts: number }> }
      } | null
      if (!response.ok) {
        if (body?.code === "MTM_CONTACT_CATEGORIES_STALE") {
          toast.error(t("stale"))
          await load()
          return
        }
        if (body?.code === "MTM_CONTACT_CATEGORY_IN_USE" && body.data?.inUse?.length) {
          const blocked = body.data.inUse[0]
          const name = loaded.categories.find((category) => category.code === blocked.code)?.labels[locale] || blocked.code
          toast.error(t("inUse", { name, count: blocked.contacts }))
          await load()
          return
        }
        throw new Error(body?.error || t("saveFailed"))
      }
      toast.success(t("saved"))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    if (!loaded) return
    setCategories(toEditor(loaded.categories))
    setShowIssues(false)
  }

  if (loading && !loaded) {
    return <section className="h-40 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
  }
  if (loadError && !loaded) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
        <p>{loadError}</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>{t("retry")}</Button>
      </section>
    )
  }
  // Only an MTM administrator configures categories; everyone else meets them
  // in the contact form and has nothing to do here.
  if (!canConfigure) {
    return embedded ? <p className="text-sm text-muted-foreground">{t("adminOnly")}</p> : null
  }

  return (
    <section data-testid="mtm-contact-category-settings" className={embedded ? undefined : "rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5"} aria-labelledby={embedded ? undefined : "contact-category-settings-title"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid max-w-3xl gap-1">
          {embedded ? null : (
            <h2 id="contact-category-settings-title" className="flex items-center gap-2 text-base font-semibold">
              <Tags className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("title")}
            </h2>
          )}
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={addCategory} disabled={categories.length >= CONTACT_CATEGORY_LIMITS.categories}>
          <Plus className="h-4 w-4" />{t("addCategory")}
        </Button>
      </div>

      <div className="mt-5 grid gap-4">
        {categories.map((category, categoryIndex) => {
          const contacts = category.code ? loaded?.usage[category.code] ?? 0 : 0
          const nameInvalid = hasIssue((issue) => (
            (issue.kind === "CATEGORY_NAME_REQUIRED" || issue.kind === "CATEGORY_NAME_DUPLICATE")
            && issue.categoryIndex === categoryIndex
          ))
          return (
            <article key={category.uid} data-testid="mtm-contact-category" className="rounded-xl border border-zinc-200 bg-muted/20 p-3 dark:border-zinc-700 sm:p-4">
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid min-w-0 flex-1 basis-56 gap-1 text-xs">
                  <span className="text-muted-foreground">{t("categoryName")}</span>
                  <Input
                    id={`contact-category-name-${category.uid}`}
                    value={category.labels[locale]}
                    maxLength={CONTACT_CATEGORY_LIMITS.label}
                    placeholder={t("categoryNamePlaceholder")}
                    aria-invalid={nameInvalid}
                    className={cn("min-h-11 text-sm font-medium", nameInvalid && "border-destructive")}
                    onChange={(event) => updateCategory(category.uid, (current) => ({
                      ...current,
                      labels: renameContactCategoryLabels(current.labels, locale, event.target.value),
                    }))}
                  />
                </label>
                <span className="min-h-11 content-center rounded-full px-1 text-xs text-muted-foreground">
                  {category.code ? (contacts > 0 ? t("usage", { count: contacts }) : t("usageNone")) : t("usageNew")}
                </span>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("moveUp")} disabled={categoryIndex === 0} onClick={() => setCategories((current) => move(current, categoryIndex, -1))}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("moveDown")} disabled={categoryIndex === categories.length - 1} onClick={() => setCategories((current) => move(current, categoryIndex, 1))}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-11 text-destructive" onClick={() => removeCategory(category)}>
                    <Trash2 className="h-4 w-4" />{t("removeCategory")}
                  </Button>
                </div>
              </div>

              {category.code && standardNote?.(category)}

              <div className="mt-4 grid gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldsTitle")}</p>
                {category.fields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noFields")}</p>
                ) : null}
                {category.fields.map((field, fieldIndex) => {
                  const fieldInvalid = hasIssue((issue) => (
                    (issue.kind === "FIELD_NAME_REQUIRED" || issue.kind === "FIELD_NAME_DUPLICATE")
                    && issue.categoryIndex === categoryIndex && issue.fieldIndex === fieldIndex
                  ))
                  const optionsInvalid = hasIssue((issue) => (
                    (issue.kind === "OPTIONS_REQUIRED" || issue.kind === "OPTION_NAME_REQUIRED")
                    && issue.categoryIndex === categoryIndex && issue.fieldIndex === fieldIndex
                  ))
                  // Values already entered were typed for this kind of field;
                  // changing it underneath them would make them unreadable.
                  const typeLocked = Boolean(field.key)
                  return (
                    <div key={field.uid} data-testid="mtm-contact-category-field" className="grid gap-3 rounded-lg border border-zinc-200 bg-background p-3 dark:border-zinc-700">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="grid min-w-0 flex-1 basis-56 gap-1 text-xs">
                          <span className="text-muted-foreground">{t("fieldName")}</span>
                          <Input
                            id={`contact-category-field-name-${field.uid}`}
                            value={field.labels[locale]}
                            maxLength={CONTACT_CATEGORY_LIMITS.label}
                            placeholder={t("fieldNamePlaceholder")}
                            aria-invalid={fieldInvalid}
                            className={cn("min-h-11", fieldInvalid && "border-destructive")}
                            onChange={(event) => updateField(category.uid, field.uid, (current) => ({
                              ...current,
                              labels: renameContactCategoryLabels(current.labels, locale, event.target.value),
                            }))}
                          />
                        </label>
                        {typeLocked ? (
                          // Plain text, not a greyed-out dropdown: a control
                          // that cannot be used reads as a broken one.
                          <div className="grid basis-44 gap-1 text-xs">
                            <span className="text-muted-foreground">{t("fieldType")}</span>
                            <span data-testid="mtm-contact-category-field-type" className="flex min-h-11 items-center text-sm font-medium">{t(`fieldTypes.${field.type}`)}</span>
                          </div>
                        ) : (
                          <label className="grid basis-44 gap-1 text-xs">
                            <span className="text-muted-foreground">{t("fieldType")}</span>
                            <Select
                              value={field.type}
                              className="min-h-11"
                              onChange={(event) => {
                                const type = event.target.value as ContactCategoryFieldType
                                updateField(category.uid, field.uid, (current) => ({
                                  ...current,
                                  type,
                                  options: type === "SELECT" ? current.options ?? [] : undefined,
                                }))
                              }}
                            >
                              {CONTACT_CATEGORY_FIELD_TYPES.map((type) => <option key={type} value={type}>{t(`fieldTypes.${type}`)}</option>)}
                            </Select>
                          </label>
                        )}
                        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={field.required}
                            onChange={(event) => updateField(category.uid, field.uid, (current) => ({ ...current, required: event.target.checked }))}
                          />
                          {t("required")}
                        </label>
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("moveUp")} disabled={fieldIndex === 0} onClick={() => updateCategory(category.uid, (current) => ({ ...current, fields: move(current.fields, fieldIndex, -1) }))}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("moveDown")} disabled={fieldIndex === category.fields.length - 1} onClick={() => updateCategory(category.uid, (current) => ({ ...current, fields: move(current.fields, fieldIndex, 1) }))}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 text-destructive" aria-label={t("removeField")} onClick={() => updateCategory(category.uid, (current) => ({ ...current, fields: current.fields.filter((candidate) => candidate.uid !== field.uid) }))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {field.type === "SELECT" ? (
                        <div className="grid gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                          <p className={cn("text-xs font-medium", optionsInvalid ? "text-destructive" : "text-muted-foreground")}>{t("options")}</p>
                          <div className="flex flex-wrap gap-2">
                            {(field.options ?? []).map((option) => (
                              <span key={option.uid} className="flex items-center gap-1">
                                <Input
                                  id={`contact-category-option-${option.uid}`}
                                  value={option.labels[locale]}
                                  maxLength={CONTACT_CATEGORY_LIMITS.label}
                                  placeholder={t("optionPlaceholder")}
                                  aria-label={t("optionPlaceholder")}
                                  className="min-h-11 w-44"
                                  onChange={(event) => updateField(category.uid, field.uid, (current) => ({
                                    ...current,
                                    options: (current.options ?? []).map((candidate) => candidate.uid === option.uid
                                      ? { ...candidate, labels: renameContactCategoryLabels(candidate.labels, locale, event.target.value) }
                                      : candidate),
                                  }))}
                                />
                                <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 text-destructive" aria-label={t("removeOption")} onClick={() => updateField(category.uid, field.uid, (current) => ({ ...current, options: (current.options ?? []).filter((candidate) => candidate.uid !== option.uid) }))}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </span>
                            ))}
                            <Button type="button" variant="outline" className="min-h-11" disabled={(field.options?.length ?? 0) >= CONTACT_CATEGORY_LIMITS.options} onClick={() => addOption(category.uid, field.uid)}>
                              <Plus className="h-4 w-4" />{t("addOption")}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                <div>
                  <Button type="button" variant="outline" className="min-h-11" disabled={category.fields.length >= CONTACT_CATEGORY_LIMITS.fields} onClick={() => addField(category.uid)}>
                    <Plus className="h-4 w-4" />{t("addField")}
                  </Button>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {t("behaviourHint")}
        {categories.some((category) => category.fields.some((field) => field.key)) ? ` ${t("fieldTypeLocked")}` : null}
      </p>

      {removedFields.length > 0 ? (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
          <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          <span>{t("removedFields", { fields: removedFields.join(", ") })}</span>
        </p>
      ) : null}
      {showIssues && issues.length > 0 ? (
        <ul role="alert" className="mt-3 grid gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {issues.map((issue, index) => <li key={index}>{issueText(issue)}</li>)}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <span role="status" aria-live="polite" className={cn("text-sm", dirty ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
          {dirty ? t("dirty") : t("noChanges")}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={reset} disabled={!dirty || saving}>
            <RotateCcw className="h-4 w-4" />{t("cancel")}
          </Button>
          <Button type="button" className="min-h-11" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </section>
  )
}
