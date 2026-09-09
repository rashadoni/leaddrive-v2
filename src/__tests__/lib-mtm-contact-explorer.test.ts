import { describe, expect, it } from "vitest"
import {
  contactExplorerStateFromSearchParams,
  contactQuery,
  contactSavedViewFilters,
  contactSavedViewState,
  EMPTY_CONTACT_FILTERS,
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
      new URLSearchParams("type=DROP&status=UNKNOWN&category=Z&objectType=DOCTOR&assignmentState=ANY&coveragePeriod=2026-13"),
    )
    expect(state.filters).toEqual(EMPTY_CONTACT_FILTERS)
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
      specialtyCode: "PE",
      organizationKind: "Adult hospital",
      ownerAgentId: "agent-1",
    }, 100)
    expect(contactSavedViewState(saved)).toEqual({
      filters: {
        ...EMPTY_CONTACT_FILTERS,
        status: "",
        specialtyCode: "PE",
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
})
