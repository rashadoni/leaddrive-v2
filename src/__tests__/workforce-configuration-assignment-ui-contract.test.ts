import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).workforceConfigurationPage as Record<string, unknown>
}

describe("Workforce assignment configuration UI contract", () => {
  const workbench = source("src/components/workforce/workforce-configuration-workbench.tsx")

  it("uses named roster pickers and explicit future-effective writes", () => {
    expect(workbench).toContain('id="workforce-assignment-employee"')
    expect(workbench).toContain('id="workforce-assignment-template"')
    expect(workbench).toContain('label={t("employee")}')
    expect(workbench).toContain('label={t("shiftTemplate")}')
    expect(workbench).toContain('id="workforce-assignment-effective-from"')
    expect(workbench).toContain('request("/api/v1/workforce/configuration/assignments", "POST", assignmentForm)')
    expect(workbench).toContain('data.roster.employees.map')
    expect(workbench).toContain('data.roster.shiftTemplates.map')
    expect(workbench).not.toContain('id="workforce-assignment-agent-id"')
  })

  it("keeps an on-demand, date-scoped preview separate from schedule mutation", () => {
    expect(workbench).toContain('id="workforce-assignment-preview-date"')
    expect(workbench).toContain('"/api/v1/workforce/configuration/assignments?effectiveDate=" + encodeURIComponent(assignmentPreviewDate)')
    expect(workbench).toContain('setAssignmentPreview(previewData.preview?.assignments ?? [])')
    expect(workbench).toContain('assignmentPreview !== null')
  })

  it("shows and writes the immutable organization-default timeline separately", () => {
    expect(workbench).toContain('request("/api/v1/workforce/configuration/shifts/default", "GET")')
    expect(workbench).toContain('request("/api/v1/workforce/configuration/shifts/default", "POST", defaultAssignmentForm)')
    expect(workbench).toContain('id="workforce-default-assignment-template"')
    expect(workbench).toContain('data.roster.shiftTemplates.filter((template) => template.teamId === null)')
    expect(workbench).toContain('data.defaultAssignments.map')
  })

  it("has complete, non-empty translation copy for the visible scheduling controls", () => {
    const keys = [
      "scheduleIndividualAssignment",
      "employee",
      "shiftTemplate",
      "assignmentPreviewTitle",
      "showPreview",
      "assignmentTimelineTitle",
      "scheduleDefaultAssignment",
      "defaultTimelineTitle",
    ]
    for (const locale of ["en", "az", "ru"]) {
      const localized = messages(locale)
      for (const key of keys) {
        expect(localized[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((localized[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
