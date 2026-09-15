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
    | "review-timesheet-approval-export"
    | "preview-timesheet-approval-export"
    | "authorize-approved-timesheet-report"
    | "read-approved-timesheet-report"
    | "read-exception-case-report"
    | "authorize-site-transition-report"
    | "read-site-transition-report"
    | "authorize-evidence-timeline"
    | "read-evidence-timeline"
    | "retention-raw-location-dry-run"
    | "verify-attendance-mfa"
    | "verify-attendance-administration"
    | "configuration-access-lookup"
    | "configuration-access-grant-write"
    | "configuration-access-grant-inventory"
    | "configuration-access-grant-target-search"
    | "configuration-access-review"
    | "read-request-list"
}): void {
  console.error("[workforce/privacy] sensitive operation failed", { operation: input.operation })
}
