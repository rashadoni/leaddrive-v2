import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const detail = readFileSync(join(process.cwd(), "src/components/mtm/contact-detail.tsx"), "utf8")
const panel = readFileSync(join(process.cwd(), "src/components/mtm/contact-dictionary-assignment-panel.tsx"), "utf8")
const contactApi = readFileSync(join(process.cwd(), "src/app/api/v1/mtm/contacts/[id]/route.ts"), "utf8")
const mobileSync = readFileSync(join(process.cwd(), "src/app/api/v1/mtm/mobile/sync/pull/route.ts"), "utf8")
const settings = readFileSync(join(process.cwd(), "src/app/(dashboard)/mtm/settings/contact-dictionary-settings.tsx"), "utf8")
const createDialog = readFileSync(join(process.cwd(), "src/components/mtm/contact-create-dialog.tsx"), "utf8")

describe("SWM03 contact dictionary UI contract", () => {
  it("renders governed master data before assessment snapshots and potentials", () => {
    expect(detail).toContain("MtmContactDictionaryAssignmentPanel")
    expect(detail.indexOf("<MtmContactDictionaryAssignmentPanel")).toBeLessThan(detail.indexOf("<MtmContactScoringPanel"))
    expect(detail).toContain("governedProductCategory")
    expect(detail).not.toContain("productCategory={contact.productCategory}")
  })

  it("keeps psychotype, product categories, and brand categories separate", () => {
    expect(panel).toContain('"PSYCHOTYPE"')
    expect(panel).toContain('"PRODUCT_CATEGORY"')
    expect(panel).toContain('"BRAND_CATEGORY"')
    expect(panel).toContain("psychotypeDictionary")
    expect(panel).toContain("productDictionary")
    expect(panel).toContain("brandDictionary")
  })

  it("supports manager edits and agent approval requests with conflict hashes", () => {
    expect(panel).toContain("expectedStateHash: stateHash")
    expect(panel).toContain("DICTIONARY_ASSIGNMENTS")
    expect(panel).toContain("dictionary-assignments")
    expect(panel).toContain("/decision")
  })

  it("projects governed assignments to web and offline mobile clients", () => {
    expect(contactApi).toContain("verifiedContactDictionaryEntries")
    expect(contactApi).toContain("dictionaryAssignmentStateHash")
    expect(mobileSync).toContain("contact-core-v4-governed-dictionaries")
    expect(mobileSync).toContain("dictionaryAssignments")
  })

  it("lets tenant administrators manage client categories without editing JSON", () => {
    expect(settings).toContain("ClientTypeBuilder")
    expect(settings).toContain("addCategory")
    expect(settings).toContain("addField")
    expect(settings).toContain("createNewVersion")
    expect(createDialog).toContain("loadClientTypes")
    expect(createDialog).toContain("categoryFieldRequired")
    expect(createDialog).toContain("clientType:")
  })
})
