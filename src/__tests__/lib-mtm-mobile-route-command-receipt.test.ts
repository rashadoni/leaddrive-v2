import { describe, expect, it } from "vitest"
import {
  MTM_MOBILE_ROUTE_COMMAND_RECEIPT_RETENTION_DAYS,
  canonicalMtmMobileRouteCommandJson,
  expiresMtmMobileRouteCommandReceiptAt,
  hashMtmMobileRouteCommand,
  isExactMtmMobileRouteCommandReceiptMatch,
} from "@/lib/mtm/mobile-route-command-receipt"

describe("MTM mobile route-command receipts", () => {
  it("hashes a stable envelope while preserving ordered route points", () => {
    const first = hashMtmMobileRouteCommand({
      command: "UPDATE_DRAFT",
      targetRouteId: "route-1",
      payload: {
        expectedVersion: 4,
        points: [
          { customerId: "customer-a", plannedTime: "2026-09-02T08:00:00.000Z" },
          { customerId: "customer-b" },
        ],
      },
    })
    const reorderedObjectKeys = hashMtmMobileRouteCommand({
      command: "UPDATE_DRAFT",
      targetRouteId: "route-1",
      payload: {
        points: [
          { plannedTime: "2026-09-02T08:00:00.000Z", customerId: "customer-a" },
          { customerId: "customer-b" },
        ],
        expectedVersion: 4,
      },
    })
    const reorderedPoints = hashMtmMobileRouteCommand({
      command: "UPDATE_DRAFT",
      targetRouteId: "route-1",
      payload: {
        expectedVersion: 4,
        points: [{ customerId: "customer-b" }, { customerId: "customer-a" }],
      },
    })

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(reorderedObjectKeys).toBe(first)
    expect(reorderedPoints).not.toBe(first)
    expect(canonicalMtmMobileRouteCommandJson({ b: 2, a: { d: 4, c: 3 } }))
      .toBe('{"a":{"c":3,"d":4},"b":2}')
  })

  it("keeps operation scope out of the payload hash but enforces it for replay", () => {
    const payload = { date: "2026-09-02", points: [] }
    const requestHash = hashMtmMobileRouteCommand({
      command: "CREATE_DRAFT",
      targetRouteId: null,
      payload,
    })
    const now = new Date("2026-09-02T00:00:00.000Z")
    const receipt = {
      organizationId: "org-1",
      agentId: "agent-1",
      deviceId: "rf-device-1",
      operationId: "route-command-001",
      command: "CREATE_DRAFT" as const,
      targetRouteId: null,
      payload,
      requestHash,
      expiresAt: expiresMtmMobileRouteCommandReceiptAt(now),
    }
    const requested = { ...receipt, requestHash }

    expect(isExactMtmMobileRouteCommandReceiptMatch(receipt, requested, now)).toBe(true)
    expect(isExactMtmMobileRouteCommandReceiptMatch(receipt, {
      ...requested,
      deviceId: "rf-device-2",
    }, now)).toBe(false)
    expect(isExactMtmMobileRouteCommandReceiptMatch(receipt, {
      ...requested,
      requestHash: "b".repeat(64),
    }, now)).toBe(false)
    expect(isExactMtmMobileRouteCommandReceiptMatch(receipt, requested, receipt.expiresAt)).toBe(false)
  })

  it("uses a 90-day receipt window, longer than the approved seven-day offline horizon", () => {
    const completedAt = new Date("2026-09-02T10:00:00.000Z")
    const expected = new Date("2026-12-01T10:00:00.000Z")
    expect(MTM_MOBILE_ROUTE_COMMAND_RECEIPT_RETENTION_DAYS).toBe(90)
    expect(expiresMtmMobileRouteCommandReceiptAt(completedAt)).toEqual(expected)
  })
})
