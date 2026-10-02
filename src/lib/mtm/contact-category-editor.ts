/**
 * Client categories and their tenant-defined fields, as the settings editor
 * and the contact screens see them. Storage is the signed CLIENT_TYPE contact
 * dictionary (`contact-dictionary.ts`); this module is the browser-safe half —
 * no `node:crypto`, no Prisma — so the same rules run in the editor and on the
 * server.
 */

export type ContactCategoryLabels = { ru: string; az: string; en: string }
export type ContactCategoryLocale = keyof ContactCategoryLabels

export const CONTACT_CATEGORY_FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "DATE",
  "PHONE",
  "EMAIL",
  "SELECT",
] as const
export type ContactCategoryFieldType = typeof CONTACT_CATEGORY_FIELD_TYPES[number]

export type ContactCategoryOption = { code: string; labels: ContactCategoryLabels }
export type ContactCategoryField = {
  key: string
  order: number
  type: ContactCategoryFieldType
  required: boolean
  labels: ContactCategoryLabels
  options?: ContactCategoryOption[]
}
export type ContactCategory = {
  code: string
  order: number
  labels: ContactCategoryLabels
  fields?: ContactCategoryField[]
}

export const LEGACY_CONTACT_TYPES = ["DOCTOR", "PHARMACIST", "OTHER"] as const
export type LegacyContactType = typeof LEGACY_CONTACT_TYPES[number]

/**
 * How a dictionary version saved from MTM settings signs itself. The signed
 * dictionary requires an approval reference; for a version an administrator
 * saved directly there is no external approval to cite, so screens that print
 * the reference leave this one out.
 */
export const CONTACT_CATEGORY_SOURCE_SYSTEM = "LeadDrive settings"
export const CONTACT_CATEGORY_APPROVAL_REFERENCE = "Module settings"

export const CONTACT_CATEGORY_LIMITS = { categories: 100, fields: 50, options: 100, label: 200 } as const

/**
 * What a tenant has before it configures anything: the three built-in contact
 * types. Their codes equal `MtmContact.type`, which is how contacts created
 * before any dictionary existed still land in a category.
 */
export const DEFAULT_CONTACT_CATEGORIES: readonly ContactCategory[] = [
  { code: "DOCTOR", order: 1, labels: { ru: "Врач", az: "Həkim", en: "Doctor" }, fields: [] },
  { code: "PHARMACIST", order: 2, labels: { ru: "Фармацевт", az: "Əczaçı", en: "Pharmacist" }, fields: [] },
  { code: "OTHER", order: 3, labels: { ru: "Другой клиент", az: "Digər müştəri", en: "Other client" }, fields: [] },
]

export function defaultContactCategories(): ContactCategory[] {
  return DEFAULT_CONTACT_CATEGORIES.map((category) => ({
    ...category,
    labels: { ...category.labels },
    fields: [],
  }))
}

export function isLegacyContactType(code: string): code is LegacyContactType {
  return (LEGACY_CONTACT_TYPES as readonly string[]).includes(code)
}

/**
 * `MtmContact.type` drives doctor scoring, coverage and pharmacy promotions,
 * and it only knows the three built-in types. A tenant-made category therefore
 * behaves as OTHER there.
 */
export function legacyContactTypeForCategory(code: string): LegacyContactType {
  return isLegacyContactType(code) ? code : "OTHER"
}

/** The category a contact is shown under: its assigned one, else its built-in type. */
export function effectiveContactCategoryCode(contact: { type: string; categoryCode?: string | null }): string {
  return contact.categoryCode || contact.type
}

/**
 * The category definition a contact's card should be read with. The tenant's
 * current definition of that code wins — it carries the latest names and
 * fields — and the version the contact was assigned under is the fallback for
 * a code the tenant has since stopped listing.
 */
export function resolveContactCategory<Entry extends { code: string }>(args: {
  type: string
  assignedCode?: string | null
  assignedEntry?: Entry | null
  activeEntries?: readonly Entry[] | null
}): { code: string; entry: Entry | null } {
  const code = effectiveContactCategoryCode({ type: args.type, categoryCode: args.assignedCode })
  const entry = args.activeEntries?.find((candidate) => candidate.code === code)
    ?? (args.assignedCode ? args.assignedEntry ?? null : null)
  return { code, entry }
}

export function contactCategoryLocale(locale: string): ContactCategoryLocale {
  return locale.startsWith("az") ? "az" : locale.startsWith("ru") ? "ru" : "en"
}

export function localizedContactCategoryLabel(labels: ContactCategoryLabels, locale: string): string {
  const key = contactCategoryLocale(locale)
  return labels[key] || labels.en || labels.ru || labels.az
}

/**
 * The editor shows one name box, in the administrator's own language. The
 * other two languages follow it until someone gives them a different wording —
 * so a name typed once is not blank for a colleague on another language, and
 * the built-in "Врач / Həkim / Doctor" are not flattened by a rename in one.
 */
export function renameContactCategoryLabels(
  labels: ContactCategoryLabels,
  locale: ContactCategoryLocale,
  next: string,
): ContactCategoryLabels {
  const previous = labels[locale]
  const follows = (value: string) => value.trim() === "" || value === previous
  return {
    ru: locale === "ru" || follows(labels.ru) ? next : labels.ru,
    az: locale === "az" || follows(labels.az) ? next : labels.az,
    en: locale === "en" || follows(labels.en) ? next : labels.en,
  }
}

const TRANSLITERATION: Record<string, string> = {
  ə: "e", ı: "i", ö: "o", ü: "u", ş: "s", ç: "c", ğ: "g",
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
}

function slugWords(name: string): string[] {
  const latin = Array.from(name.toLocaleLowerCase("az"))
    .map((char) => TRANSLITERATION[char] ?? char)
    .join("")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
  return latin.split(/[^a-z0-9]+/).filter(Boolean)
}

function unique(base: string, taken: ReadonlySet<string>, separator: string): string {
  if (!taken.has(base)) return base
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, 70)}${separator}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error("No free identifier left")
}

/**
 * Identifiers are derived from the first name a thing is given and never
 * change afterwards: values are stored under the field key, and contacts point
 * at the category code, so a rename must not orphan either.
 */
export function contactCategoryCodeFromName(name: string, taken: ReadonlySet<string>): string {
  const slug = slugWords(name).join("_").toUpperCase().slice(0, 60)
  return unique(slug || "CATEGORY", taken, "_")
}

export function contactCategoryFieldKeyFromName(name: string, taken: ReadonlySet<string>): string {
  const slug = slugWords(name).join("_").slice(0, 60)
  return unique(/^[a-z]/.test(slug) ? slug : `field${slug ? `_${slug}` : ""}`, taken, "_")
}

export function contactCategoryOptionCodeFromName(name: string, taken: ReadonlySet<string>): string {
  const slug = slugWords(name).join("_").toUpperCase().slice(0, 60)
  return unique(slug || "OPTION", taken, "_")
}

export type ContactCategoryIssue =
  | { kind: "NO_CATEGORIES" }
  | { kind: "CATEGORY_NAME_REQUIRED"; categoryIndex: number }
  | { kind: "CATEGORY_NAME_DUPLICATE"; categoryIndex: number; name: string }
  | { kind: "FIELD_NAME_REQUIRED"; categoryIndex: number; fieldIndex: number }
  | { kind: "FIELD_NAME_DUPLICATE"; categoryIndex: number; fieldIndex: number; name: string }
  | { kind: "OPTIONS_REQUIRED"; categoryIndex: number; fieldIndex: number }
  | { kind: "OPTION_NAME_REQUIRED"; categoryIndex: number; fieldIndex: number }

/**
 * Problems an administrator can actually fix, checked in the language they
 * are editing in. Two categories with the same visible name would be
 * indistinguishable in every dropdown, whatever their codes are.
 */
export function contactCategoryIssues(categories: ContactCategory[], locale: ContactCategoryLocale): ContactCategoryIssue[] {
  if (categories.length === 0) return [{ kind: "NO_CATEGORIES" }]
  const issues: ContactCategoryIssue[] = []
  const categoryNames = new Set<string>()
  categories.forEach((category, categoryIndex) => {
    const name = category.labels[locale].trim()
    const folded = name.toLocaleLowerCase(locale)
    if (!name) issues.push({ kind: "CATEGORY_NAME_REQUIRED", categoryIndex })
    else if (categoryNames.has(folded)) issues.push({ kind: "CATEGORY_NAME_DUPLICATE", categoryIndex, name })
    categoryNames.add(folded)

    const fieldNames = new Set<string>()
    ;(category.fields ?? []).forEach((field, fieldIndex) => {
      const fieldName = field.labels[locale].trim()
      const fieldFolded = fieldName.toLocaleLowerCase(locale)
      if (!fieldName) issues.push({ kind: "FIELD_NAME_REQUIRED", categoryIndex, fieldIndex })
      else if (fieldNames.has(fieldFolded)) issues.push({ kind: "FIELD_NAME_DUPLICATE", categoryIndex, fieldIndex, name: fieldName })
      fieldNames.add(fieldFolded)
      if (field.type !== "SELECT") return
      const options = field.options ?? []
      if (options.length === 0) issues.push({ kind: "OPTIONS_REQUIRED", categoryIndex, fieldIndex })
      else if (options.some((option) => !option.labels[locale].trim())) {
        issues.push({ kind: "OPTION_NAME_REQUIRED", categoryIndex, fieldIndex })
      }
    })
  })
  return issues
}

function filledLabels(labels: ContactCategoryLabels, locale: ContactCategoryLocale): ContactCategoryLabels {
  const fallback = labels[locale].trim() || labels.en.trim() || labels.ru.trim() || labels.az.trim()
  return {
    ru: labels.ru.trim() || fallback,
    az: labels.az.trim() || fallback,
    en: labels.en.trim() || fallback,
  }
}

/**
 * The shape the server stores: trimmed, every language filled, order numbers
 * equal to the on-screen order, and options only where the type has them.
 */
export function normalizeContactCategories(categories: ContactCategory[], locale: ContactCategoryLocale): ContactCategory[] {
  return categories.map((category, categoryIndex) => ({
    code: category.code,
    order: categoryIndex + 1,
    labels: filledLabels(category.labels, locale),
    fields: (category.fields ?? []).map((field, fieldIndex) => ({
      key: field.key,
      order: fieldIndex + 1,
      type: field.type,
      required: field.required,
      labels: filledLabels(field.labels, locale),
      ...(field.type === "SELECT" ? {
        options: (field.options ?? []).map((option) => ({
          code: option.code,
          labels: filledLabels(option.labels, locale),
        })),
      } : {}),
    })),
  }))
}

/**
 * Gives every newly added category, field and option its permanent
 * identifier, derived from the name it has at the moment of saving. Things
 * that already have one keep it, whatever they are renamed to. New category
 * codes also stay clear of the built-in type codes: a tenant-made "Doctor"
 * must not silently adopt every contact whose built-in type is DOCTOR.
 */
export function assignContactCategoryIdentifiers(
  categories: ContactCategory[],
  locale: ContactCategoryLocale,
): ContactCategory[] {
  const categoryCodes = new Set<string>([
    ...LEGACY_CONTACT_TYPES,
    ...categories.map((category) => category.code).filter(Boolean),
  ])
  return categories.map((category) => {
    let code = category.code
    if (!code) {
      code = contactCategoryCodeFromName(category.labels[locale], categoryCodes)
      categoryCodes.add(code)
    }
    const fieldKeys = new Set((category.fields ?? []).map((field) => field.key).filter(Boolean))
    const fields = (category.fields ?? []).map((field) => {
      let key = field.key
      if (!key) {
        key = contactCategoryFieldKeyFromName(field.labels[locale], fieldKeys)
        fieldKeys.add(key)
      }
      if (field.type !== "SELECT") return { ...field, key }
      const optionCodes = new Set((field.options ?? []).map((option) => option.code).filter(Boolean))
      const options = (field.options ?? []).map((option) => {
        if (option.code) return option
        const optionCode = contactCategoryOptionCodeFromName(option.labels[locale], optionCodes)
        optionCodes.add(optionCode)
        return { ...option, code: optionCode }
      })
      return { ...field, key, options }
    })
    return { ...category, code, fields }
  })
}

/** Editor state → the exact payload the save endpoint stores. */
export function contactCategoriesForSave(categories: ContactCategory[], locale: ContactCategoryLocale): ContactCategory[] {
  return normalizeContactCategories(assignContactCategoryIdentifiers(categories, locale), locale)
}

/** Reads stored dictionary entries back into the editor's shape, tolerating gaps. */
export function contactCategoriesFromEntries(entries: unknown): ContactCategory[] {
  if (!Array.isArray(entries)) return []
  const labelsOf = (value: unknown): ContactCategoryLabels => {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {}
    const read = (key: string) => typeof record[key] === "string" ? record[key] as string : ""
    return { ru: read("ru"), az: read("az"), en: read("en") }
  }
  return entries.flatMap((rawEntry): ContactCategory[] => {
    if (!rawEntry || typeof rawEntry !== "object") return []
    const entry = rawEntry as Record<string, unknown>
    if (typeof entry.code !== "string" || !entry.code) return []
    const fields = Array.isArray(entry.fields) ? entry.fields : []
    return [{
      code: entry.code,
      order: typeof entry.order === "number" ? entry.order : 0,
      labels: labelsOf(entry.labels),
      fields: fields.flatMap((rawField): ContactCategoryField[] => {
        if (!rawField || typeof rawField !== "object") return []
        const field = rawField as Record<string, unknown>
        if (typeof field.key !== "string" || !field.key) return []
        const type = (CONTACT_CATEGORY_FIELD_TYPES as readonly unknown[]).includes(field.type)
          ? field.type as ContactCategoryFieldType
          : "TEXT"
        const options = Array.isArray(field.options) ? field.options : []
        return [{
          key: field.key,
          order: typeof field.order === "number" ? field.order : 0,
          type,
          required: field.required === true,
          labels: labelsOf(field.labels),
          ...(type === "SELECT" ? {
            options: options.flatMap((rawOption): ContactCategoryOption[] => {
              if (!rawOption || typeof rawOption !== "object") return []
              const option = rawOption as Record<string, unknown>
              return typeof option.code === "string" && option.code
                ? [{ code: option.code, labels: labelsOf(option.labels) }]
                : []
            }),
          } : {}),
        }]
      }).sort((left, right) => left.order - right.order),
    }]
  }).sort((left, right) => left.order - right.order)
}

/** A stored value as a person reads it: the option's name, not its code. */
export function contactCategoryFieldDisplayValue(
  field: ContactCategoryField,
  value: unknown,
  locale: string,
): string | null {
  if (value === undefined || value === null || value === "") return null
  if (field.type === "SELECT") {
    const option = field.options?.find((candidate) => candidate.code === value)
    return option ? localizedContactCategoryLabel(option.labels, locale) : String(value)
  }
  return String(value)
}
