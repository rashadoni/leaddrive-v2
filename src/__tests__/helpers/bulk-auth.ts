import { vi } from "vitest"
import { NextResponse } from "next/server"
import * as apiAuth from "@/lib/api-auth"

/**
 * Helper for bulk-action route tests that depend on the sequence of
 * `requireAuth` calls (e.g. main `entity:write` check followed by a
 * second `entity:delete` re-check inside the delete branch).
 *
 * Without this helper each test would manually chain
 * `mockResolvedValueOnce` + `mockImplementationOnce` for `isAuthError`,
 * encoding the call order in two places — brittle to any refactor that
 * reorders auth checks. The helper centralizes the order so a future
 * route change only needs to update the sequence at call sites.
 *
 * Each step is either:
 *   - `{ role: string }` — auth succeeds, returns AuthResult with that role
 *   - `{ error: number }` — auth fails, returns a NextResponse with status
 *
 * Used by api-deals-bulk + api-leads-bulk + (later) api-companies-bulk.
 */
export type AuthStep = { role: string } | { error: number }

export function mockAuthSequence(steps: AuthStep[]) {
  const requireAuth = vi.mocked(apiAuth.requireAuth)
  const isAuthError = vi.mocked(apiAuth.isAuthError)

  requireAuth.mockReset()
  isAuthError.mockReset()

  for (const step of steps) {
    if ("error" in step) {
      requireAuth.mockResolvedValueOnce(
        NextResponse.json({ error: `Forbidden — ${step.error}` }, { status: step.error }) as any,
      )
    } else {
      requireAuth.mockResolvedValueOnce({ orgId: "org-1", userId: "u-1", role: step.role } as any)
    }
  }

  // isAuthError mirrors the sequence — true when the step was an error.
  // We use mockImplementation (not Once) so it doesn't run out of stubs
  // when the route happens to call it more times than steps (e.g. on a
  // pre-emptive guard); the default returns false for anything that isn't
  // a NextResponse instance, matching the production implementation.
  isAuthError.mockImplementation((result: unknown): result is NextResponse =>
    result instanceof NextResponse,
  )
}
