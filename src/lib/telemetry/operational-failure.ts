const OPERATIONS = new Set([
  "auth-rls-resolve", "auth-rls-permission", "auth-rls-session",
  "auth-mobile-scope-rejected", "auth-mobile-permission-rejected",
  "auth-sms-dispatch", "auth-login", "auth-session-validation",
  "audit-persist", "application-render",
] as const)

type Operation = typeof OPERATIONS extends Set<infer T> ? T : never

/** Never inspect a thrown value or request. Diagnostics cannot change auth or
 * best-effort audit behavior when the console destination itself is unavailable.
 */
export function logOperationalFailure(operation: Operation, level: "error" | "warn" = "error"): void {
  const safe = OPERATIONS.has(operation) ? operation : "unknown"
  try {
    if (level === "warn") console.warn("[application] operation failed", { operation: safe })
    else console.error("[application] operation failed", { operation: safe })
  } catch {
    // Observation must not replace the original response/throw/transaction result.
  }
}
