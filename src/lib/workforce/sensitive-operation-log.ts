/**
 * Log only a fixed operation label for sensitive Workforce failures.
 * Never pass an error object, message, case reference, or employee input.
 */
export function logWorkforceSensitiveOperationFailure(input: {
  operation: "review-exception-decision-write" | "review-exception-response-write"
}): void {
  console.error("[workforce/privacy] sensitive operation failed", { operation: input.operation })
}
