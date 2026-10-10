import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { workforceLogFailures } from "./fixtures/workforce-log-failures"

vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: vi.fn() } } }))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: unknown, _action: unknown, handler: unknown) => handler,
  withRlsSessionAuth: (handler: unknown) => handler,
}))
import { prisma } from "@/lib/prisma"
import {
  withWorkforceRlsAuth, withWorkforceSessionScheduleConfigurationAuth,
  withWorkforceSessionPilotFenceAuth, withWorkforceSessionRetentionReadAuth,
  withWorkforceSessionEmploymentConfigurationAuth, withWorkforceSessionExceptionQueueAuth,
  withWorkforceSessionExceptionDecisionAuth,
} from "@/lib/with-workforce-rls-auth"

const auth = { orgId: "synthetic-org", userId: "synthetic-user", role: "admin", principalType: "session" }
type Handler = (req: NextRequest, authContext: typeof auth) => Promise<Response>
const wrappers = [
  { operation: "auth-workforce-capability", wrap: (handler: () => Promise<Response>) => withWorkforceRlsAuth("read", handler) },
  { operation: "auth-workforce-schedule", wrap: (handler: () => Promise<Response>) => withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_WRITE", handler) },
  { operation: "auth-workforce-pilot-fence", wrap: withWorkforceSessionPilotFenceAuth },
  { operation: "auth-workforce-retention", wrap: withWorkforceSessionRetentionReadAuth },
  { operation: "auth-workforce-employment", wrap: withWorkforceSessionEmploymentConfigurationAuth },
  { operation: "auth-workforce-exception-queue", wrap: withWorkforceSessionExceptionQueueAuth },
  { operation: "auth-workforce-exception-decision", wrap: withWorkforceSessionExceptionDecisionAuth },
]
beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.restoreAllMocks())

describe("Seven real Workforce auth wrappers contain private lookup failures", () => {
  for (const { operation, wrap } of wrappers) {
    it.each(workforceLogFailures)(operation + " discards $kind and denies before handler", async ({ make }) => {
      vi.mocked(prisma.organization.findUnique).mockRejectedValueOnce(make())
      const captured = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const handler = vi.fn(async () => NextResponse.json({ success: true }))
      const wrapped = wrap(handler) as unknown as Handler
      const response = await wrapped(new NextRequest("http://localhost/api/v1/workforce/synthetic"), auth)
      expect(response.status).toBe(503)
      expect(handler).not.toHaveBeenCalled()
      expect(prisma.organization.findUnique).toHaveBeenCalledTimes(1)
      expect(captured.mock.calls).toEqual([["[workforce/privacy] sensitive operation failed", { operation }]])
      expect(await response.text()).not.toContain("WORKFORCE_PRIVATE_CANARY")
    })

    it(operation + " preserves downstream rejection instead of remapping it to auth503", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        plan: "enterprise", addons: [], features: operation === "auth-workforce-exception-decision" ? ["workforce-hrm", "workforce-granular-access-v1"] : ["workforce-hrm"], modules: { "workforce-hrm": true },
      } as never)
      const captured = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const failure = new Error("synthetic downstream rejection")
      const handler = vi.fn(async () => { throw failure })
      const wrapped = wrap(handler) as unknown as Handler
      await expect(wrapped(new NextRequest("http://localhost/api/v1/workforce/synthetic"), auth)).rejects.toBe(failure)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(captured).not.toHaveBeenCalled()
    })
  }
})

// Exercise the preserved HRM engine and its existing permission/concurrency
// contracts in isolation. Production withdrawal is covered with the real
// availability policy in crm-workforce-withdrawal and withdrawal-access suites.
vi.mock("@/lib/crm-product-availability", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/crm-product-availability")>(),
  isCrmCapabilityAvailable: () => true,
}))
