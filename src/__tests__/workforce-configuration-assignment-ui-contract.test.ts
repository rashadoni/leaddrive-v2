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

  it("keeps the active employee roster explicitly bounded and searchable", () => {
    expect(workbench).toContain('id="workforce-roster-search"')
    expect(workbench).toContain('rosterLimit=200&rosterQuery=" + encodeURIComponent(rosterSearch)')
    expect(workbench).toContain('data.roster.hasMore')
    expect(workbench).toContain('t("rosterSearchHasMore"')
    expect(workbench).toContain('bulkAssignmentSelections')
    expect(workbench).toContain('bulkSiteAssignmentSelections')
    expect(workbench).toContain('t("bulkSelectionRetainedHint")')
  })

  it("keeps an on-demand, date-scoped preview separate from schedule mutation", () => {
    expect(workbench).toContain('id="workforce-assignment-preview-date"')
    expect(workbench).toContain('"/api/v1/workforce/configuration/assignments?effectiveDate=" + encodeURIComponent(assignmentPreviewDate)')
    expect(workbench).toContain('setAssignmentPreview(previewData.preview?.assignments ?? [])')
    expect(workbench).toContain('assignmentPreview !== null')
  })

  it("requires an explicit confirmation before atomically publishing a reviewed bulk shift draft", () => {
    expect(workbench).toContain('id="workforce-bulk-assignment-template"')
    expect(workbench).toContain('id="workforce-bulk-assignment-effective-from"')
    expect(workbench).toContain('"/api/v1/workforce/configuration/assignments/preview"')
    expect(workbench).toContain('setBulkAssignmentPreview(null)')
    expect(workbench).toContain('setBulkAssignmentDraft(emptyBulkAssignmentDraft())')
    expect(workbench).toContain('bulkAssignmentPreview !== null')
    expect(workbench).toContain('aria-describedby="workforce-bulk-assignment-employees-hint"')
    expect(workbench).toContain('role="status" aria-live="polite" aria-atomic="true"')
    expect(workbench).toContain('t("bulkAssignmentSummary"')
    expect(workbench).toContain('<ul className="mt-3 divide-y')
    expect(workbench).toContain('"/api/v1/workforce/configuration/assignments/bulk/publish"')
    expect(workbench).toContain('id="workforce-bulk-assignment-publish-confirm"')
    expect(workbench).toContain('bulkAssignmentPublishConfirmed')
    expect(workbench).toContain('bulkAssignmentPublishOperationId')
    expect(workbench).toContain('crypto.randomUUID()')
  })

  it("requires an explicit confirmation before atomically publishing a reviewed site eligibility draft", () => {
    expect(workbench).toContain('id="workforce-bulk-site-assignment-site"')
    expect(workbench).toContain('id="workforce-bulk-site-assignment-effective-from"')
    expect(workbench).toContain('"/api/v1/workforce/configuration/site-assignments/preview"')
    expect(workbench).toContain('setBulkSiteAssignmentPreview(null)')
    expect(workbench).toContain('setBulkSiteAssignmentDraft(emptyBulkSiteAssignmentDraft())')
    expect(workbench).toContain('bulkSiteAssignmentPreview !== null')
    expect(workbench).toContain('"/api/v1/workforce/configuration/site-assignments/bulk/publish"')
    expect(workbench).toContain('id="workforce-bulk-site-assignment-publish-confirm"')
    expect(workbench).toContain('bulkSiteAssignmentPublishConfirmed')
    expect(workbench).toContain('crypto.randomUUID()')
  })

  it("shows and writes the immutable organization-default timeline separately", () => {
    expect(workbench).toContain('request("/api/v1/workforce/configuration/shifts/default", "GET")')
    expect(workbench).toContain('request("/api/v1/workforce/configuration/shifts/default", "POST", {')
    expect(workbench).toContain('defaultAssignmentPublishConfirmed')
    expect(workbench).toContain('defaultAssignmentPublishOperationId')
    expect(workbench).toContain('id="workforce-default-assignment-publish-confirmation"')
    expect(workbench).toContain('crypto.randomUUID()')
    expect(workbench).toContain('id="workforce-default-assignment-template"')
    expect(workbench).toContain('data.roster.shiftTemplates.filter((template) => template.teamId === null)')
    expect(workbench).toContain('data.defaultAssignments.map')
  })

  it("keeps the team fallback timeline separate and tied to a named team template", () => {
    expect(workbench).toContain('request("/api/v1/workforce/configuration/shifts/team-default", "GET")')
    expect(workbench).toContain('request("/api/v1/workforce/configuration/shifts/team-default", "POST", {')
    expect(workbench).toContain('id="workforce-team-default-assignment-team"')
    expect(workbench).toContain('id="workforce-team-default-assignment-template"')
    expect(workbench).toContain('id="workforce-team-default-assignment-publish-confirmation"')
    expect(workbench).toContain('template.teamId === teamDefaultAssignmentForm.teamId')
    expect(workbench).toContain('teamDefaultAssignmentPublishOperationId')
    expect(workbench).toContain('data.teamDefaultAssignments.map')
  })

  it("uses named team and site pickers with status and effective-date context", () => {
    expect(workbench).toContain('id="workforce-policy-team"')
    expect(workbench).toContain('label={t("teamScopePicker")}')
    expect(workbench).toContain('id="workforce-site-assignment-employee"')
    expect(workbench).toContain('id="workforce-site-assignment-site"')
    expect(workbench).toContain('id="workforce-site-assignment-effective-from"')
    expect(workbench).toContain('request("/api/v1/workforce/configuration/site-assignments", "POST"')
    expect(workbench).toContain("directoryStatus.")
    expect(workbench).not.toContain('id="workforce-policy-team" value={policyForm.teamId} onChange={(event) => setPolicyForm')
  })

  it("has complete, non-empty translation copy for the visible scheduling controls", () => {
    const keys = [
      "scheduleIndividualAssignment",
      "employee",
      "shiftTemplate",
      "assignmentPreviewTitle",
      "rosterSearchLabel",
      "rosterSearchPlaceholder",
      "rosterSearchSubmit",
      "rosterSearchClear",
      "rosterSearchHint",
      "rosterSearchHasMore",
      "rosterSearchNoMatches",
      "rosterSearchResults",
      "bulkSelectionRetainedHint",
      "bulkSelectionPeople",
      "showPreview",
      "bulkAssignmentPreviewTitle",
      "bulkAssignmentPreviewHint",
      "bulkAssignmentEmployees",
      "bulkAssignmentEmployeesHint",
      "reviewBulkAssignmentDraft",
      "discardBulkAssignmentDraft",
      "bulkAssignmentReviewOnlyHint",
      "bulkAssignmentPublishConfirm",
      "publishBulkAssignment",
      "bulkAssignmentPublishBlocked",
      "bulkAssignmentPublishConfirmationRequired",
      "bulkAssignmentPublished",
      "bulkAssignmentSummary",
      "bulkSiteAssignmentPreviewTitle",
      "bulkSiteAssignmentPreviewHint",
      "bulkSiteAssignmentEmployeesHint",
      "reviewBulkSiteAssignmentDraft",
      "bulkSiteAssignmentReviewOnlyHint",
      "bulkSiteAssignmentSummary",
      "bulkSiteAssignmentPublishConfirm",
      "publishBulkSiteAssignment",
      "bulkSiteAssignmentPublishBlocked",
      "bulkSiteAssignmentPublishConfirmationRequired",
      "bulkSiteAssignmentPublished",
      "assignmentTimelineTitle",
      "scheduleDefaultAssignment",
      "defaultAssignmentPublishConfirmation",
      "defaultAssignmentPublishConfirmationRequired",
      "defaultTimelineTitle",
      "scheduleTeamDefaultAssignment",
      "teamDefaultAssignmentHint",
      "selectTeamShiftTemplate",
      "teamDefaultAssignmentValidationFailed",
      "teamDefaultAssignmentPublishConfirmation",
      "teamDefaultAssignmentPublishConfirmationRequired",
      "teamDefaultAssignmentSaved",
      "teamDefaultTimelineTitle",
      "teamDefaultTimelineHint",
      "noTeamDefaultAssignments",
      "directoryTitle",
      "teamScopePicker",
      "siteAssignmentsTitle",
      "sitePicker",
      "scheduleSiteAssignment",
    ]
    for (const locale of ["en", "az", "ru"]) {
      const localized = messages(locale)
      for (const key of keys) {
        expect(localized[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((localized[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
      const outcomes = localized.bulkAssignmentOutcome as Record<string, unknown>
      for (const outcome of ["READY", "NO_CHANGE", "EMPLOYEE_UNAVAILABLE", "TEMPLATE_TEAM_MISMATCH", "CONFLICT"]) {
        expect(outcomes?.[outcome], `${locale}.bulkAssignmentOutcome.${outcome} is missing`).toEqual(expect.any(String))
        expect((outcomes?.[outcome] as string).trim(), `${locale}.bulkAssignmentOutcome.${outcome} is empty`).not.toBe("")
      }
      const siteOutcomes = localized.bulkSiteAssignmentOutcome as Record<string, unknown>
      for (const outcome of ["READY", "NO_CHANGE", "EMPLOYEE_UNAVAILABLE", "CONFLICT"]) {
        expect(siteOutcomes?.[outcome], `${locale}.bulkSiteAssignmentOutcome.${outcome} is missing`).toEqual(expect.any(String))
        expect((siteOutcomes?.[outcome] as string).trim(), `${locale}.bulkSiteAssignmentOutcome.${outcome} is empty`).not.toBe("")
      }
    }
  })
})
