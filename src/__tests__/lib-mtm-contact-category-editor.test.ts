import { describe, expect, it } from "vitest"
import {
  contactCategoriesForSave,
  contactCategoriesFromEntries,
  contactCategoryCodeFromName,
  contactCategoryFieldDisplayValue,
  contactCategoryFieldKeyFromName,
  contactCategoryIssues,
  contactCategoryOptionCodeFromName,
  defaultContactCategories,
  effectiveContactCategoryCode,
  legacyContactTypeForCategory,
  normalizeContactCategories,
  renameContactCategoryLabels,
  resolveContactCategory,
  type ContactCategory,
} from "@/lib/mtm/contact-category-editor"
import { ContactDictionaryEntriesSchema } from "@/lib/mtm/contact-dictionary"
import {
  contactCategoryRemovalsInUse,
  contactCategoryWhere,
} from "@/lib/mtm/contact-categories"

describe("client category identifiers", () => {
  it("derives a readable field key from an Azerbaijani name", () => {
    expect(contactCategoryFieldKeyFromName("Xəstə sayı", new Set())).toBe("xeste_sayi")
  })

  it("derives a readable field key from a Russian name", () => {
    expect(contactCategoryFieldKeyFromName("Количество больных", new Set())).toBe("kolichestvo_bolnyh")
  })

  it("keeps keys unique inside one category", () => {
    expect(contactCategoryFieldKeyFromName("Xəstə sayı", new Set(["xeste_sayi"]))).toBe("xeste_sayi_2")
    expect(contactCategoryFieldKeyFromName("Xəstə sayı", new Set(["xeste_sayi", "xeste_sayi_2"]))).toBe("xeste_sayi_3")
  })

  it("produces a key the dictionary schema accepts even for a name with no letters", () => {
    expect(contactCategoryFieldKeyFromName("№ 5", new Set())).toBe("field_5")
    expect(contactCategoryFieldKeyFromName("—", new Set())).toBe("field")
    expect(contactCategoryCodeFromName("—", new Set())).toBe("CATEGORY")
    expect(contactCategoryOptionCodeFromName("?", new Set(["OPTION"]))).toBe("OPTION_2")
  })

  it("derives a category code that never collides with a built-in type", () => {
    expect(contactCategoryCodeFromName("Tibb bacısı", new Set(["DOCTOR", "PHARMACIST", "OTHER"]))).toBe("TIBB_BACISI")
    expect(contactCategoryCodeFromName("Doctor", new Set(["DOCTOR", "PHARMACIST", "OTHER"]))).toBe("DOCTOR_2")
  })
})

describe("client category names across languages", () => {
  it("carries a first-typed name into the languages nobody has worded yet", () => {
    expect(renameContactCategoryLabels({ ru: "", az: "", en: "" }, "az", "Tibb bacısı"))
      .toEqual({ ru: "Tibb bacısı", az: "Tibb bacısı", en: "Tibb bacısı" })
  })

  it("keeps the other languages following while they still mirror the edited one", () => {
    const typed = renameContactCategoryLabels({ ru: "", az: "", en: "" }, "az", "Tibb")
    expect(renameContactCategoryLabels(typed, "az", "Tibb bacısı"))
      .toEqual({ ru: "Tibb bacısı", az: "Tibb bacısı", en: "Tibb bacısı" })
  })

  it("does not flatten a built-in category's translations on a rename in one language", () => {
    expect(renameContactCategoryLabels({ ru: "Врач", az: "Həkim", en: "Doctor" }, "az", "Doktor"))
      .toEqual({ ru: "Врач", az: "Doktor", en: "Doctor" })
  })
})

describe("client category editor rules", () => {
  const withPatients = (): ContactCategory[] => {
    const categories = defaultContactCategories()
    categories[0].fields = [{
      key: "xeste_sayi",
      order: 7,
      type: "NUMBER",
      required: false,
      labels: { ru: "Xəstə sayı", az: " Xəstə sayı ", en: "Xəstə sayı" },
    }]
    return categories
  }

  it("turns the editor state into entries the signed dictionary accepts", () => {
    const normalized = normalizeContactCategories(withPatients(), "az")
    expect(ContactDictionaryEntriesSchema.safeParse(normalized).success).toBe(true)
    expect(normalized[0].fields).toEqual([{
      key: "xeste_sayi",
      order: 1,
      type: "NUMBER",
      required: false,
      labels: { ru: "Xəstə sayı", az: "Xəstə sayı", en: "Xəstə sayı" },
    }])
  })

  it("keeps options only on a list field", () => {
    const categories = defaultContactCategories()
    categories[0].fields = [
      { key: "level", order: 1, type: "SELECT", required: true, labels: { ru: "Уровень", az: "Səviyyə", en: "Level" }, options: [{ code: "HIGH", labels: { ru: "", az: "Yüksək", en: "" } }] },
      { key: "note", order: 2, type: "TEXT", required: false, labels: { ru: "", az: "Qeyd", en: "" }, options: [{ code: "X", labels: { ru: "x", az: "x", en: "x" } }] },
    ]
    const normalized = normalizeContactCategories(categories, "az")
    expect(ContactDictionaryEntriesSchema.safeParse(normalized).success).toBe(true)
    expect(normalized[0].fields?.[0].options).toEqual([{ code: "HIGH", labels: { ru: "Yüksək", az: "Yüksək", en: "Yüksək" } }])
    expect(normalized[0].fields?.[1]).not.toHaveProperty("options")
  })

  it("reports what an administrator has to fix before saving", () => {
    const categories = defaultContactCategories()
    categories[1].labels.az = "həkim"
    categories[0].fields = [
      { key: "a", order: 1, type: "TEXT", required: false, labels: { ru: "", az: "", en: "" } },
      { key: "b", order: 2, type: "SELECT", required: false, labels: { ru: "", az: "Səviyyə", en: "" }, options: [] },
    ]
    expect(contactCategoryIssues(categories, "az")).toEqual([
      { kind: "FIELD_NAME_REQUIRED", categoryIndex: 0, fieldIndex: 0 },
      { kind: "OPTIONS_REQUIRED", categoryIndex: 0, fieldIndex: 1 },
      { kind: "CATEGORY_NAME_DUPLICATE", categoryIndex: 1, name: "həkim" },
    ])
    expect(contactCategoryIssues([], "az")).toEqual([{ kind: "NO_CATEGORIES" }])
    expect(contactCategoryIssues(defaultContactCategories(), "ru")).toEqual([])
  })

  it("names new things once on save and never renames what is already stored", () => {
    const categories = withPatients()
    categories[0].labels.az = "Doktor"
    categories[0].fields![0].labels.az = "Pasiyent sayı"
    categories[0].fields!.push({ key: "", order: 0, type: "SELECT", required: true, labels: { ru: "", az: "Səviyyə", en: "" }, options: [{ code: "", labels: { ru: "", az: "Yüksək", en: "" } }] })
    categories.push({ code: "", order: 0, labels: { ru: "", az: "Tibb bacısı", en: "" }, fields: [] })
    categories.push({ code: "", order: 0, labels: { ru: "", az: "Doctor", en: "" }, fields: [] })

    const saved = contactCategoriesForSave(categories, "az")

    expect(ContactDictionaryEntriesSchema.safeParse(saved).success).toBe(true)
    expect(saved.map((category) => category.code)).toEqual(["DOCTOR", "PHARMACIST", "OTHER", "TIBB_BACISI", "DOCTOR_2"])
    expect(saved[0].fields?.map((field) => field.key)).toEqual(["xeste_sayi", "seviyye"])
    expect(saved[0].fields?.[1].options).toEqual([{ code: "YUKSEK", labels: { ru: "Yüksək", az: "Yüksək", en: "Yüksək" } }])
    expect(saved[3].labels).toEqual({ ru: "Tibb bacısı", az: "Tibb bacısı", en: "Tibb bacısı" })
  })

  it("reads stored entries back in their saved order", () => {
    const stored = normalizeContactCategories(withPatients(), "az")
    expect(contactCategoriesFromEntries([...stored].reverse()).map((category) => category.code))
      .toEqual(["DOCTOR", "PHARMACIST", "OTHER"])
    expect(contactCategoriesFromEntries(null)).toEqual([])
  })

  it("shows a list value by its name and leaves an empty value empty", () => {
    const field = {
      key: "level", order: 1, type: "SELECT" as const, required: false,
      labels: { ru: "Уровень", az: "Səviyyə", en: "Level" },
      options: [{ code: "HIGH", labels: { ru: "Высокий", az: "Yüksək", en: "High" } }],
    }
    expect(contactCategoryFieldDisplayValue(field, "HIGH", "ru")).toBe("Высокий")
    expect(contactCategoryFieldDisplayValue(field, "GONE", "ru")).toBe("GONE")
    expect(contactCategoryFieldDisplayValue(field, "", "ru")).toBeNull()
    expect(contactCategoryFieldDisplayValue({ ...field, type: "NUMBER", options: undefined }, 0, "ru")).toBe("0")
  })
})

describe("which category a contact belongs to", () => {
  it("uses the assigned category, and the built-in type for a contact never assigned", () => {
    expect(effectiveContactCategoryCode({ type: "OTHER", categoryCode: "TIBB_BACISI" })).toBe("TIBB_BACISI")
    expect(effectiveContactCategoryCode({ type: "DOCTOR", categoryCode: null })).toBe("DOCTOR")
  })

  it("reads a contact with the tenant's current definition of its category", () => {
    const assignedUnder = { code: "DOCTOR", name: "v1, no fields" }
    const current = [{ code: "DOCTOR", name: "v2, with patient count" }, { code: "OTHER", name: "other" }]
    // Assigned under an older version: the fields added since must show.
    expect(resolveContactCategory({ type: "DOCTOR", assignedCode: "DOCTOR", assignedEntry: assignedUnder, activeEntries: current }))
      .toEqual({ code: "DOCTOR", entry: current[0] })
    // Never assigned: the built-in type picks the category.
    expect(resolveContactCategory({ type: "DOCTOR", activeEntries: current }))
      .toEqual({ code: "DOCTOR", entry: current[0] })
    // The tenant no longer lists the code: keep reading it as it was assigned.
    const retired = { code: "TIBB_BACISI", name: "nurse" }
    expect(resolveContactCategory({ type: "OTHER", assignedCode: "TIBB_BACISI", assignedEntry: retired, activeEntries: current }))
      .toEqual({ code: "TIBB_BACISI", entry: retired })
    // No categories configured at all.
    expect(resolveContactCategory({ type: "PHARMACIST", activeEntries: null }))
      .toEqual({ code: "PHARMACIST", entry: null })
  })

  it("treats a tenant-made category as OTHER for the built-in type", () => {
    expect(legacyContactTypeForCategory("PHARMACIST")).toBe("PHARMACIST")
    expect(legacyContactTypeForCategory("TIBB_BACISI")).toBe("OTHER")
  })

  it("filters a built-in category the way the old type filter did, plus assigned contacts", () => {
    expect(contactCategoryWhere("DOCTOR")).toEqual({
      OR: [
        { dictionaryAssignments: { some: { kind: "CLIENT_TYPE", effectiveTo: null, entryCode: "DOCTOR" } } },
        { type: "DOCTOR", dictionaryAssignments: { none: { kind: "CLIENT_TYPE", effectiveTo: null } } },
      ],
    })
  })

  it("filters a tenant-made category by assignment only and ignores a malformed code", () => {
    expect(contactCategoryWhere("TIBB_BACISI")).toEqual({
      OR: [{ dictionaryAssignments: { some: { kind: "CLIENT_TYPE", effectiveTo: null, entryCode: "TIBB_BACISI" } } }],
    })
    expect(contactCategoryWhere("doctor'; --")).toBeNull()
    expect(contactCategoryWhere(null)).toBeNull()
  })

  it("refuses to drop only the categories that still hold contacts", () => {
    const previous = [{ code: "DOCTOR" }, { code: "PHARMACIST" }, { code: "OTHER" }]
    expect(contactCategoryRemovalsInUse(previous, [{ code: "DOCTOR" }], { DOCTOR: 4, PHARMACIST: 2 }))
      .toEqual([{ code: "PHARMACIST", contacts: 2 }])
    expect(contactCategoryRemovalsInUse(previous, previous, { DOCTOR: 4 })).toEqual([])
  })
})
