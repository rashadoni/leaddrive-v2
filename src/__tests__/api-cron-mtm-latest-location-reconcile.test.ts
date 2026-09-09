import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (callback: () => Promise<unknown>) => callback(),
}))
vi.mock("@/lib/mtm/mobile-location-reconciliation", () => {
  class MtmLatestLocationReconciliationCursorError extends Error {}
  return {
    MtmLatestLocationReconciliationCursorError,
    issueMtmLatestLocationReconciliationCursor: vi.fn(),
    readMtmLatestLocationReconciliationCursor: vi.fn(),
    reconcileMtmLatestLocations: vi.fn(),
  }
})

import { POST } from "@/app/api/cron/mtm-latest-location-reconcile/route"
import { requireCronAuth } from "@/lib/cron-auth"
import {
  issueMtmLatestLocationReconciliationCursor,
  readMtmLatestLocationReconciliationCursor,
  reconcileMtmLatestLocations,
} from "@/lib/mtm/mobile-location-reconciliation"

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/cron/mtm-latest-location-reconcile", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-cron-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reconcileMtmLatestLocations).mockResolvedValue({
    processedAgents: 2,
    reconciledLocations: 2,
    missingRawLocations: 0,
    morePending: true,
    nextAfterAgentId: "agent-2",
    retryableFailure: false,
  })
  vi.mocked(issueMtmLatestLocationReconciliationCursor).mockReturnValue("v1:opaque-next")
})

describe("POST /api/cron/mtm-latest-location-reconcile", () => {
  it("repairs one requested tenant page and returns only aggregate counts plus a sealed cursor", async () => {
    const response = await POST(makeRequest({ organizationId: "org-1" }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: {
        processedAgents: 2,
        reconciledLocations: 2,
        missingRawLocations: 0,
        morePending: true,
        nextCursor: "v1:opaque-next",
      },
    })
    expect(reconcileMtmLatestLocations).toHaveBeenCalledWith({
      organizationId: "org-1",
      afterAgentId: null,
    })
    expect(issueMtmLatestLocationReconciliationCursor).toHaveBeenCalledWith({
      organizationId: "org-1",
      afterAgentId: "agent-2",
    })
    expect(readMtmLatestLocationReconciliationCursor).not.toHaveBeenCalled()
  })

  it("rejects a cursor from another tenant before any repair query", async () => {
    vi.mocked(readMtmLatestLocationReconciliationCursor).mockReturnValue({
      organizationId: "org-2",
      afterAgentId: "agent-2",
    } as never)

    const response = await POST(makeRequest({ organizationId: "org-1", cursor: "v1:opaque" }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Cursor organization mismatch" })
    expect(reconcileMtmLatestLocations).not.toHaveBeenCalled()
  })

  it("returns a bounded retry signal without dropping the continuation after a projection failure", async () => {
    vi.mocked(reconcileMtmLatestLocations).mockResolvedValue({
      processedAgents: 1,
      reconciledLocations: 1,
      missingRawLocations: 0,
      morePending: true,
      nextAfterAgentId: "agent-1",
      retryableFailure: true,
    })

    const response = await POST(makeRequest({ organizationId: "org-1" }))

    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("5")
    expect(await response.json()).toEqual({
      success: false,
      data: {
        processedAgents: 1,
        reconciledLocations: 1,
        missingRawLocations: 0,
        morePending: true,
        nextCursor: "v1:opaque-next",
      },
      error: "MTM_LATEST_LOCATION_RECONCILIATION_RETRY",
    })
    expect(issueMtmLatestLocationReconciliationCursor).toHaveBeenCalledWith({
      organizationId: "org-1",
      afterAgentId: "agent-1",
    })
  })

  it("stops before parsing a repair body when cron authentication fails", async () => {
    vi.mocked(requireCronAuth).mockReturnValue(new NextResponse(null, { status: 401 }))

    const response = await POST(makeRequest({ organizationId: "org-1" }))

    expect(response.status).toBe(401)
    expect(reconcileMtmLatestLocations).not.toHaveBeenCalled()
  })
})
