import { describe, expect, it } from "vitest"
import {
  contactExplorerStateFromSearchParams,
  contactFilterIsActive,
  contactQuery,
  contactSavedViewFilters,
  contactSavedViewState,
  contactSpecialtyFilterValues,
  EMPTY_CONTACT_FILTERS,
  MTM_CONTACT_SPECIALTY_FILTER_LIMIT,
} from "@/lib/mtm/contact-explorer"

describe("MTM contact explorer", () => {
  it("round-trips URL filters including the explicit all-status state", () => {
    const params = contactQuery({
      ...EMPTY_CONTACT_FILTERS,
      status: "",
      search: "clinic",
      region: "Baku",
      profile: "Hospital",
      assignmentState: "UNASSIGNED",
    }, 3, 25)

    expect(params.toString()).toBe(
      "search=clinic&status=&profile=Hospital&assignmentState=UNASSIGNED&region=Baku&page=3&limit=25",
    )
    expect(contactExplorerStateFromSearchParams(params)).toEqual({
      filters: {
        ...EMPTY_CONTACT_FILTERS,
        status: "",
        search: "clinic",
        region: "Baku",
        profile: "Hospital",
        assignmentState: "UNASSIGNED",
      },
      page: 3,
      limit: 25,
    })
  })

  it("rejects unsupported enum values restored from a URL", () => {
    const state = contactExplorerStateFromSearchParams(
      new URLSearchParams("type=drop%20it&status=UNKNOWN&category=Z&objectType=DOCTOR&assignmentState=ANY&coveragePeriod=2026-13"),
    )
    expect(state.filters).toEqual(EMPTY_CONTACT_FILTERS)
  })

  it("restores a tenant-made client category from a URL, like a built-in type", () => {
    const state = contactExplorerStateFromSearchParams(new URLSearchParams("type=TIBB_BACISI"))
    expect(state.filters.type).toBe("TIBB_BACISI")
    expect(contactQuery(state.filters, 1, 50).get("type")).toBe("TIBB_BACISI")
    expect(contactExplorerStateFromSearchParams(new URLSearchParams("type=DOCTOR")).filters.type).toBe("DOCTOR")
  })

  it("restores a valid governed coverage month from the URL", () => {
    const state = contactExplorerStateFromSearchParams(new URLSearchParams("coveragePeriod=2026-07"))
    expect(state.filters.coveragePeriod).toBe("2026-07")
    expect(contactQuery(state.filters, 1, 50).get("coveragePeriod")).toBe("2026-07")
  })

  it("round-trips a saved view and bounds its page size", () => {
    const saved = contactSavedViewFilters({
      ...EMPTY_CONTACT_FILTERS,
      status: "",
      specialties: ["Pediatr", "Kardioloq"],
      organizationKind: "Adult hospital",
      ownerAgentId: "agent-1",
    }, 100)
    expect(contactSavedViewState(saved)).toEqual({
      filters: {
        ...EMPTY_CONTACT_FILTERS,
        status: "",
        specialties: ["Pediatr", "Kardioloq"],
        organizationKind: "Adult hospital",
        ownerAgentId: "agent-1",
      },
      limit: 100,
    })
    expect(contactSavedViewState({ ...saved, limit: 999, objectType: "DOCTOR" })).toMatchObject({
      filters: { objectType: "" },
      limit: 50,
    })
  })

  it("carries several specialties and the four typed fields through the URL", () => {
    const params = contactQuery({
      ...EMPTY_CONTACT_FILTERS,
      name: "Aysel",
      address: "Nizami 76",
      area: "Yasamal",
      workplace: "Mərkəzi klinika",
      specialties: ["Pediatr", "Cərrah ümumi"],
    }, 1, 50)

    expect(params.getAll("specialty")).toEqual(["Pediatr", "Cərrah ümumi"])
    expect(contactExplorerStateFromSearchParams(params).filters).toEqual({
      ...EMPTY_CONTACT_FILTERS,
      name: "Aysel",
      address: "Nizami 76",
      area: "Yasamal",
      workplace: "Mərkəzi klinika",
      specialties: ["Pediatr", "Cərrah ümumi"],
    })
  })

  it("reads the old single specialty filter from a link and from a saved view", () => {
    expect(contactExplorerStateFromSearchParams(new URLSearchParams("specialtyCode=PE")).filters.specialties)
      .toEqual(["PE"])
    expect(contactSavedViewState({ specialtyCode: "PE", status: "ACTIVE" }).filters.specialties).toEqual(["PE"])
  })

  it("drops a repeated specialty whatever case it was typed in, and bounds the list", () => {
    expect(contactSpecialtyFilterValues(["Pediatr", " pediatr ", "", "İnfeksionist", "INFEKSIONIST", 7]))
      .toEqual(["Pediatr", "İnfeksionist"])
    expect(contactSpecialtyFilterValues(Array.from({ length: 200 }, (_, index) => `S${index}`)))
      .toHaveLength(MTM_CONTACT_SPECIALTY_FILTER_LIMIT)
  })

  it("tells a set filter from the opening state, so «Сбросить» shows only when needed", () => {
    expect(contactFilterIsActive(EMPTY_CONTACT_FILTERS, "status")).toBe(false)
    expect(contactFilterIsActive({ ...EMPTY_CONTACT_FILTERS, status: "" }, "status")).toBe(true)
    expect(contactFilterIsActive(EMPTY_CONTACT_FILTERS, "specialties")).toBe(false)
    expect(contactFilterIsActive({ ...EMPTY_CONTACT_FILTERS, specialties: ["Lor"] }, "specialties")).toBe(true)
  })
})
