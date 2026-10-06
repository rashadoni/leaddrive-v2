/**
 * Log only a fixed operation label for sensitive Workforce failures.
 * Never pass an error object, message, case reference, or employee input.
 */
export function logWorkforceSensitiveOperationFailure(input: {
  operation:
    | "auth-workforce-grant-management"
    | "review-exception-decision-write"
    | "review-exception-response-write"
    | "review-workday-correction"
    | "review-workday-reopen"
    | "review-workday-reopen-undo"
    | "review-timesheet-approval-export"
    | "preview-timesheet-approval-export"
    | "authorize-approved-timesheet-report"
    | "read-approved-timesheet-report"
    | "read-exception-case-report"
    | "authorize-site-transition-report"
    | "read-site-transition-report"
    | "authorize-evidence-timeline"
    | "authorize-evidence-directory"
    | "read-evidence-timeline"
    | "search-evidence-timeline-targets"
    | "retention-raw-location-dry-run"
    | "verify-attendance-mfa"
    | "verify-attendance-administration"
    | "configuration-access-lookup"
    | "configuration-access-grant-write"
    | "configuration-access-grant-inventory"
    | "configuration-access-grant-target-search"
    | "configuration-access-review"
    | "configuration-exception-response-cycle-audit"
  | "configuration-policy-version-comparison"
  | "configuration-policy-future-window-preview"
    | "configuration-policy-employee-impact-preview"
    | "configuration-policy-restore-draft"
    | "configuration-policy-version-search"
    | "configuration-exception-policy-revision-read"
    | "configuration-exception-policy-revision-write"
    | "read-request-list"
    | "read-exception-queue"
    | "authorize-today-read"
    | "authorize-timesheet-read"
    | "authorize-request-decision"
    | "run-no-show-review"
}): void {
  console.error("[workforce/privacy] sensitive operation failed", { operation: input.operation })
}
