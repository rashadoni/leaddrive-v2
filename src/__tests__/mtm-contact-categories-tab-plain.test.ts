// @vitest-environment jsdom

/**
 * The client card, tab «Категории и оценка», says only what there is to say.
 *
 * For a client of a tenant that had not created a single category list — on
 * production (2026-10-02) that was every tenant — the tab printed four columns
 * of «нет подписанного справочника / не назначено», then six framed sections
 * of «подтверждённой оценки нет», «факторы пока недоступны», a warning about
 * «границу авторитетных данных», and descriptions written for an auditor.
 * Owner, looking at it: «что это? тут чёрт голову сломает», then «максимально
 * надо упростить».
 *
 * A kind of category is shown once it has a list or a value; a section of the
 * assessment block once something was recorded in it. The last case here has
 * everything, so the cleanup cannot quietly hide data a tenant did enter.
 */
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const messages = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, unknown>

// Answers with the key, and only for a key that exists under the namespace the
// component asked for — a label that would print as «ns.key» fails here.
const translators = new Map<string, (key: string) => string>()
function translator(namespace: string) {
  const known = translators.get(namespace)
  if (known) return known
  const translate = (key: string) => {
    const value = `${namespace}.${key}`.split(".").reduce<unknown>(
      (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
      messages,
    )
    if (typeof value !== "string") throw new Error(`missing message ${namespace}.${key}`)
    return key
  }
  translators.set(namespace, translate)
  return translate
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => translator(namespace),
  useLocale: () => "en",
}))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}))
// The entry dialogs are closed on this tab; their own tests cover them.
vi.mock("@/components/mtm/contact-scoring-entry-dialogs", () => ({
  MtmAssessmentCreateDialog: () => null,
  MtmPotentialCreateDialog: () => null,
  MtmPotentialEndDialog: () => null,
}))

import { MtmContactDictionaryAssignmentPanel } from "@/components/mtm/contact-dictionary-assignment-panel"
import { MtmContactScoringPanel } from "@/components/mtm/contact-scoring-panel"

type CategoryProps = ComponentProps<typeof MtmContactDictionaryAssignmentPanel>
type ScoringProps = ComponentProps<typeof MtmContactScoringPanel>

const labels = (text: string) => ({ ru: text, az: text, en: text })

const clientTypes: CategoryProps["dictionaries"][number] = {
  id: "dictionary-1",
  kind: "CLIENT_TYPE",
  version: 3,
  nameRu: "Типы",
  nameAz: "Növlər",
  nameEn: "Types",
  approvalReference: "MEMO-17",
  signedAt: "2026-10-01T00:00:00.000Z",
  entries: [{ code: "DOCTOR", order: 0, labels: labels("Doctor") }, { code: "PHARMACIST", order: 1, labels: labels("Pharmacist") }],
}

const categoryDefaults: CategoryProps = {
  contactId: "contact-1",
  contactUpdatedAt: "2026-10-02T08:00:00.000Z",
  categoryData: {},
  contactType: "DOCTOR",
  stateHash: "hash",
  dictionaries: [],
  assignments: [],
  changeRequests: [],
  canManage: true,
  canRequestChanges: false,
  onChanged: () => {},
}

const scoringDefaults: ScoringProps = {
  contactId: "contact-1",
  contactType: "DOCTOR",
  productCategory: null,
  qualificationCategory: null,
  assessments: [],
  potentials: [],
  eligiblePotentialVisits: [],
  potentialAgents: [],
  asOf: "2026-10-02",
  actorAgentId: null,
  canAssess: true,
  canRecordPotential: true,
  canReviewAssessment: true,
  canReviewPotential: true,
  perAgentDimension: false,
  onChanged: () => {},
}

const assessment: ScoringProps["assessments"][number] = {
  id: "assessment-1",
  status: "VERIFIED",
  office: "Room 4",
  patientsPerMonth: 120,
  bedCount: null,
  isKol: false,
  kolLevel: null,
  profile: "Outpatient",
  psychotype: "Analytical",
  granularCategory: "A1",
  actualScore: "18.5",
  targetScore: "20",
  periodStart: "2026-09-01",
  periodEnd: null,
  source: "MANAGER_INTERVIEW",
  provenance: null,
  formulaVersion: "v1",
  reviewComment: null,
  reviewedAt: "2026-09-02T08:00:00.000Z",
  createdAt: "2026-09-01T08:00:00.000Z",
  enteredByAgent: { id: "agent-1", name: "Aysel" },
  reviewedByAgent: { id: "agent-2", name: "Kamran" },
  formula: { name: "Doctor score", version: "v1", signedAt: null },
}

const potential: ScoringProps["potentials"][number] = {
  id: "potential-1",
  brandExternalId: null,
  brandName: "Brand A",
  productExternalId: null,
  productName: null,
  category: "B",
  categoryLabel: null,
  potentialValue: "40",
  coverageValue: "10",
  periodStart: "2026-09-01",
  periodEnd: null,
  source: "FIELD_INTERVIEW",
  formulaVersion: null,
  provenance: null,
  status: "VERIFIED",
  reviewComment: null,
  reviewedAt: null,
  closedAt: null,
  createdAt: "2026-09-01T08:00:00.000Z",
  agent: null,
  enteredByAgent: null,
  reviewedByAgent: null,
  evidenceVisits: [],
}

let container: HTMLDivElement
let root: Root

async function renderCategories(props: Partial<CategoryProps> = {}) {
  await act(async () => { root.render(createElement(MtmContactDictionaryAssignmentPanel, { ...categoryDefaults, ...props })) })
  return container.textContent ?? ""
}

async function renderScoring(props: Partial<ScoringProps> = {}) {
  await act(async () => { root.render(createElement(MtmContactScoringPanel, { ...scoringDefaults, ...props })) })
  return container.textContent ?? ""
}

const headings = () => [...container.querySelectorAll("h2")].map((node) => node.textContent)
const buttons = () => [...container.querySelectorAll("button")].map((node) => node.textContent)

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe("client categories on the card", () => {
  it("tells a manager in one line that no lists exist, and where to create them", async () => {
    const text = await renderCategories()

    expect(text).toBe("titlenoListsopenSettings")
    expect(container.querySelector('a[href="/mtm/settings"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid^="mtm-contact-category-group-"]')).toHaveLength(0)
  })

  it("shows nothing to someone who cannot create the lists", async () => {
    expect(await renderCategories({ canManage: false, canRequestChanges: true })).toBe("")
  })

  it("shows only the kind of category the tenant has a list for, without versions or approvals", async () => {
    const text = await renderCategories({ dictionaries: [clientTypes] })

    expect([...container.querySelectorAll('[data-testid^="mtm-contact-category-group-"]')].map((node) => node.getAttribute("data-testid")))
      .toEqual(["mtm-contact-category-group-CLIENT_TYPE"])
    expect(buttons()).toEqual(["edit"])
    const leftovers = ["psychotype", "productCategories", "brandCategories", "dictionaryMissing", "description", "v3", "MEMO-17"]
      .filter((word) => text.includes(word))
    expect(leftovers).toEqual([])
  })

  it("keeps a value the client already carries, even after its list was retired", async () => {
    const text = await renderCategories({
      assignments: [{
        id: "assignment-1",
        dictionaryId: "retired",
        kind: "PSYCHOTYPE",
        entryCode: "ANALYTICAL",
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        effectiveTo: null,
        source: "MANAGER",
        valid: false,
        issue: "DICTIONARY_RETIRED",
        entry: { code: "ANALYTICAL", order: 0, labels: labels("Analytical") },
        dictionary: {
          id: "retired", kind: "PSYCHOTYPE", version: 1, nameRu: "", nameAz: "", nameEn: "",
          approvalReference: null, signedAt: null, retiredAt: "2026-09-20T00:00:00.000Z", status: "RETIRED",
        },
      }],
    })

    expect(text).toContain("psychotype")
    expect(text).toContain("Analytical")
    // Nothing to choose from, so no editor is offered.
    expect(buttons()).toEqual([])
  })
})

describe("doctor assessment and potential on the card", () => {
  it("is one line and two buttons until something is recorded", async () => {
    const text = await renderScoring()

    expect(headings()).toEqual(["lifecycleActionsTitle"])
    expect(text).toContain("nothingRecorded")
    expect(buttons()).toEqual(["newAssessment", "newPotential"])
    const leftovers = [
      "currentAssessmentTitle", "noVerifiedAssessment", "profileFactorsTitle", "profileFactorsEmpty",
      "assessmentHistoryTitle", "assessmentHistoryEmpty", "brandCategoryBoundaryTitle",
      "activePotentialsTitle", "activePotentialsEmpty", "potentialHistoryTitle", "potentialHistoryEmpty",
    ].filter((word) => text.includes(word))
    expect(leftovers).toEqual([])
  })

  it("is absent for someone who can add nothing, and for a client who is not a doctor", async () => {
    expect(await renderScoring({ canAssess: false, canRecordPotential: false })).toBe("")
    expect(await renderScoring({ contactType: "PHARMACIST", productCategory: "OTC" })).toBe("")
  })

  it("shows what was recorded, section by section", async () => {
    const text = await renderScoring({
      assessments: [assessment, { ...assessment, id: "assessment-0", status: "REJECTED", periodStart: "2026-08-01", periodEnd: "2026-08-31" }],
      potentials: [potential, { ...potential, id: "potential-0", status: "ENDED", brandName: "Brand B", periodEnd: "2026-08-31" }],
    })

    expect(headings()).toEqual([
      "lifecycleActionsTitle",
      "currentAssessmentTitle",
      "profileFactorsTitle",
      "assessmentHistoryTitle",
      "activePotentialsTitle",
      "potentialHistoryTitle",
    ])
    expect(text).not.toContain("nothingRecorded")
    expect(text).toContain("Room 4")
    expect(text).toContain("Brand A")
    expect(text).toContain("Brand B")
    // Each potential is listed once: current ones above, the rest in history.
    expect(text.split("Brand A")).toHaveLength(2)
    const leftovers = ["legacyGlossaryWarning", "brandCategoryBoundaryTitle", "formulaSignature", "evidenceMissing", "psychotypeSnapshot"]
      .filter((word) => text.includes(word))
    expect(leftovers).toEqual([])
  })
})
