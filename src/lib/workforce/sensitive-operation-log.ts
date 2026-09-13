/**
 * Log only a fixed operation label for sensitive Workforce failures.
 * Never pass an error object, message, case reference, or employee input.
 */
export function logWorkforceSensitiveOperationFailure(input: {
  operation:
    | "review-exception-decision-write"
    | "review-exception-response-write"
    | "review-workday-correction"
    | "review-timesheet-approval-export"
    | "preview-timesheet-approval-export"
    | "authorize-approved-timesheet-report"
    | "read-approved-timesheet-report"
    | "read-exception-case-report"
    | "authorize-site-transition-report"
    | "read-site-transition-report"
    | "retention-raw-location-dry-run"
    | "verify-attendance-mfa"
}): void {
  console.error("[workforce/privacy] sensitive operation failed", { operation: input.operation })
}
