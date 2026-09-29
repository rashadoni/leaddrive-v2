import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES,
  nextWorkforceShiftSegmentWindow,
  validateWorkforceShiftSegmentDraft,
  workforceShiftSegmentPayload,
  type WorkforceShiftSegmentDraft,
} from "@/lib/workforce/shift-segment-draft"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).workforceConfigurationPage as Record<string, unknown>
}

function segment(overrides: Partial<WorkforceShiftSegmentDraft> = {}): WorkforceShiftSegmentDraft {
  return {
    editorKey: "segment-test",
    mode: "REMOTE",
    siteId: null,
    startTime: "09:00",
    endTime: "12:00",
    lateGraceSeconds: "0",
    proofPolicyReference: null,
    ...overrides,
  }
}

function validate(
  segments: WorkforceShiftSegmentDraft[],
  plannedBreaks: Array<{ startTime: string; endTime: string }> = [],
) {
  return validateWorkforceShiftSegmentDraft({
    segments,
    shiftStartTime: "09:00",
    shiftEndTime: "18:00",
    plannedBreaks,
    activeSiteIds: new Set(["site-a", "site-b"]),
  })
}

describe("Workforce shift segment editor contract", () => {
  const workbench = source("src/components/workforce/workforce-configuration-workbench.tsx")
  const editor = source("src/components/workforce/workforce-shift-segment-editor.tsx")

  it("keeps the legacy continuous shift and accepts an ordered Site → Travel → Site draft", () => {
    expect(validate([])).toBeNull()
    expect(validate([
      segment({ mode: "SITE", siteId: "site-a", startTime: "09:00", endTime: "12:00" }),
      segment({ mode: "TRAVEL", startTime: "12:00", endTime: "13:00" }),
      segment({ mode: "SITE", siteId: "site-b", startTime: "13:00", endTime: "18:00" }),
    ])).toBeNull()
  })

  it("suggests valid work windows around planned breaks instead of creating an invalid default", () => {
    const plannedBreaks = [{ startTime: "13:00", endTime: "14:00" }]
    const first = nextWorkforceShiftSegmentWindow({
      segments: [],
      shiftStartTime: "09:00",
      shiftEndTime: "18:00",
      plannedBreaks,
    })
    const second = nextWorkforceShiftSegmentWindow({
      segments: [segment({ startTime: first.startTime, endTime: first.endTime })],
      shiftStartTime: "09:00",
      shiftEndTime: "18:00",
      plannedBreaks,
    })

    expect(first).toEqual({ startTime: "09:00", endTime: "13:00" })
    expect(second).toEqual({ startTime: "14:00", endTime: "18:00" })
  })

  it("round-trips order and hidden proof-policy references without normalization", () => {
    const payload = workforceShiftSegmentPayload([
      segment({
        mode: "SITE",
        siteId: "site-a",
        proofPolicyReference: "office-assurance-v1",
        lateGraceSeconds: "900",
      }),
      segment({
        mode: "TRAVEL",
        startTime: "12:00",
        endTime: "13:00",
        proofPolicyReference: "travel-review-v1",
      }),
    ])

    expect(payload.map((item) => item.mode)).toEqual(["SITE", "TRAVEL"])
    expect(payload[0]).toMatchObject({
      siteId: "site-a",
      lateGraceSeconds: 900,
      proofPolicyReference: "office-assurance-v1",
    })
    expect(payload[1]?.proofPolicyReference).toBe("travel-review-v1")
  })

  it("fails closed for invalid site, timeline, break, grace, count and unreleased mode inputs", () => {
    expect(validate([segment({ mode: "SITE", siteId: null })])).toBe("SITE_REQUIRED")
    expect(validate([segment({ mode: "SITE", siteId: "archived-site" })])).toBe("SITE_UNAVAILABLE")
    expect(validate([segment({ mode: "TRAVEL", siteId: "site-a" })])).toBe("NON_SITE_SITE")
    expect(validate([segment({ lateGraceSeconds: "" })])).toBe("GRACE_INVALID")
    expect(validate([segment({ lateGraceSeconds: "7201" })])).toBe("GRACE_INVALID")
    expect(validate([segment({ startTime: "08:00" })])).toBe("OUTSIDE_SHIFT")
    expect(validate([
      segment({ startTime: "09:00", endTime: "13:00" }),
      segment({ startTime: "12:00", endTime: "14:00" }),
    ])).toBe("OVERLAP")
    expect(validate(
      [segment({ startTime: "12:30", endTime: "13:30" })],
      [{ startTime: "13:00", endTime: "14:00" }],
    )).toBe("BREAK_OVERLAP")
    expect(validate([segment({ mode: "ON_CALL" })])).toBe("UNRELEASED_MODE")
    expect(validate(Array.from({ length: 25 }, (_, index) => segment({
      startTime: index === 0 ? "09:00" : "10:00",
      endTime: index === 0 ? "10:00" : "11:00",
    })))).toBe("TOO_MANY")
  })

  it("offers only released modes and named active sites with keyboard/touch controls", () => {
    expect(WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES).toEqual([
      "SITE",
      "REMOTE",
      "FIELD",
      "TRAVEL",
      "EXCEPTION",
    ])
    expect(WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES).not.toContain("ON_CALL")
    expect(editor).toContain('site.status === "ACTIVE"')
    expect(editor).toContain('id={`workforce-shift-segment-${index}-site`}')
    expect(editor).toContain('disabled={props.segments.length >= 24}')
    expect(editor).toContain('className="size-11"')
    expect(editor).toContain('aria-label={t("moveShiftSegmentUp"')
    expect(editor).toContain('aria-label={t("moveShiftSegmentDown"')
    expect(editor).toContain('aria-label={t("removeShiftSegment"')
    expect(editor).not.toContain("segment.proofPolicyReference")
  })

  it("sends the complete ordered array for create and draft edit, while active history stays read-only", () => {
    expect(workbench).toContain("<WorkforceShiftSegmentEditor")
    expect(workbench).toContain("const segments = workforceShiftSegmentPayload(shiftForm.segments)")
    expect(workbench.match(/\.\.\.\(segments\.length > 0 \? \{ segments \} : \{\}\)/g)).toHaveLength(2)
    expect(workbench).toContain("segments: shift.segments.map")
    expect(workbench).toContain("proofPolicyReference: segment.proofPolicyReference")
    expect(workbench).toContain("<WorkforceShiftSegmentSummary segments={shift.segments} sites={data.sites} />")
    expect(workbench).toContain('shift.status === "DRAFT" ? <div')
  })

  it("has complete EN, RU and AZ copy for modes, validation and accessible actions", () => {
    const keys = [
      "shiftSegments",
      "shiftSegmentsHint",
      "shiftSegmentCount",
      "shiftSegmentsEmptyTitle",
      "shiftSegmentsEmptyHint",
      "shiftSegmentTitle",
      "moveShiftSegmentUp",
      "moveShiftSegmentDown",
      "removeShiftSegment",
      "shiftSegmentMode",
      "shiftSegmentSite",
      "selectActiveSite",
      "shiftSegmentStart",
      "shiftSegmentEnd",
      "shiftSegmentGrace",
      "addShiftSegment",
      "shiftSegmentProofPolicyHint",
      "shiftSegmentsSingleWindowSummary",
      "shiftSegmentGraceSummary",
    ]
    for (const locale of ["en", "ru", "az"]) {
      const localized = messages(locale)
      for (const key of keys) {
        expect(localized[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((localized[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
      const modes = localized.shiftSegmentModes as Record<string, unknown>
      for (const mode of ["SITE", "REMOTE", "FIELD", "TRAVEL", "EXCEPTION", "ON_CALL"]) {
        expect(modes[mode], `${locale}.shiftSegmentModes.${mode} is missing`).toEqual(expect.any(String))
      }
      const validation = localized.shiftSegmentValidation as Record<string, unknown>
      for (const issue of [
        "TOO_MANY",
        "UNRELEASED_MODE",
        "INCOMPLETE",
        "TIME_ORDER",
        "SITE_REQUIRED",
        "SITE_UNAVAILABLE",
        "NON_SITE_SITE",
        "GRACE_INVALID",
        "OUTSIDE_SHIFT",
        "OVERLAP",
        "BREAK_OVERLAP",
      ]) {
        expect(validation[issue], `${locale}.shiftSegmentValidation.${issue} is missing`).toEqual(expect.any(String))
      }
    }
  })
})
