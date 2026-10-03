import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  CONTACT_HISTORY_ACTIONS, CONTACT_HISTORY_FIELDS, contactHistoryActionKey, contactHistoryChanges,
} from "@/lib/mtm/contact-history"

// The client card's change log printed the audit row as stored: «CONTACT_CREATE»
// and «Saida Qojayeva · contact_create» (owner, 2026-10-04: "what is this
// missing translation"). It now says what happened, in words.

describe("change log — every event has a name", () => {
  it("names known actions and never prints an unknown code", () => {
    expect(contactHistoryActionKey("CONTACT_CREATE")).toBe("CONTACT_CREATE")
    expect(contactHistoryActionKey("SOMETHING_NEW_NOBODY_LABELLED")).toBe("OTHER")
  })

  it.each(["ru", "en", "az"])("%s has a label for every action and every field", (locale) => {
    const detail = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmContactDetail
    const missing = [
      ...[...CONTACT_HISTORY_ACTIONS, "OTHER"].filter((key) => !detail.historyActions?.[key]).map((key) => `historyActions.${key}`),
      ...Object.keys(CONTACT_HISTORY_FIELDS).filter((key) => !detail.historyFields?.[key]).map((key) => `historyFields.${key}`),
      ...["historyChange", "historyChangeSet"].filter((key) => !detail[key]),
    ]
    expect(missing).toEqual([])
    // A label is a sentence for a person, not the code back again.
    const codes = Object.values(detail.historyActions as Record<string, string>).filter((label) => /^[A-Z_]+$/.test(label))
    expect(codes).toEqual([])
  })

  it("covers every action the code writes for the entities this log shows", () => {
    // contacts/[id]/route.ts reads the audit log for exactly these entities.
    const entities = ["contact", "contact_change_request", "doctor_assessment", "field_potential", "contact_dictionary_assignment", "contact_workplace"]
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith(".ts")) files.push(path)
      }
    }
    walk("src/app/api/v1/mtm")
    walk("src/lib/mtm")

    const written = new Set<string>()
    const literal = /"([A-Z][A-Z_]+)"/g
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      for (const match of source.matchAll(/action:\s*([^\n]+?),\s*\n\s*entity:\s*"([a-z_]+)"/g)) {
        if (!entities.includes(match[2])) continue
        for (const action of match[1].matchAll(literal)) written.add(action[1])
        // `DOCTOR_ASSESSMENT_${decision}` / `BRAND_POTENTIAL_${decision}`: both decisions.
        const template = match[1].match(/`([A-Z_]+)\$\{/)
        if (template) for (const decision of ["VERIFIED", "REJECTED"]) written.add(`${template[1]}${decision}`)
      }
    }
    expect(written.size).toBeGreaterThan(10)
    expect([...written].filter((action) => contactHistoryActionKey(action) === "OTHER").sort()).toEqual([])
  })
})

describe("change log — what an update changed", () => {
  it("reads a category change as B → VIP", () => {
    expect(contactHistoryChanges({
      action: "CONTACT_UPDATE",
      oldData: { category: "B", lastName: "Abbasov" },
      newData: { category: "VIP", updatedAt: "2026-10-04T10:00:00Z" },
    })).toEqual([{ field: "category", from: "B", to: "VIP" }])
  })

  it("skips a field saved with the value it already had", () => {
    expect(contactHistoryChanges({
      action: "CONTACT_UPDATE",
      oldData: { category: "B", lastName: "—" },
      newData: { category: "B", lastName: "Qasımova" },
    })).toEqual([{ field: "lastName", from: "—", to: "Qasımova" }])
  })

  it("names a field that holds codes without printing the codes", () => {
    expect(contactHistoryChanges({
      action: "CONTACT_UPDATE",
      oldData: { status: "ACTIVE" },
      newData: { status: "INACTIVE" },
    })).toEqual([{ field: "status", from: null, to: null }])
  })

  it("treats a first value and a cleared value as changes", () => {
    expect(contactHistoryChanges({
      action: "CONTACT_UPDATE",
      oldData: { phone: null, email: "a@example.az" },
      newData: { phone: "+994501234567", email: null },
    })).toEqual([
      { field: "phone", from: null, to: "+994501234567" },
      { field: "email", from: "a@example.az", to: null },
    ])
  })

  it("lists nothing for other actions or a malformed row", () => {
    expect(contactHistoryChanges({ action: "CONTACT_CREATE", newData: { category: "A" } })).toEqual([])
    expect(contactHistoryChanges({ action: "CONTACT_UPDATE", oldData: null, newData: "oops" })).toEqual([])
  })
})
