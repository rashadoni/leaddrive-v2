import { describe, expect, it } from "vitest"
import {
  createWorkforceReadIdentity,
  shouldRenderWorkforceData,
  TimesheetApprovalRefreshLifecycle,
} from "@/lib/workforce/timesheet-refresh-lifecycle"

const query = { agentId: "agent-1", start: "2026-09-01", end: "2026-09-30" }

function identity(retry: number, overrides: Partial<typeof query> = {}): string {
  return createWorkforceReadIdentity({
    view: "timesheet",
    organizationId: "org-1",
    retry,
    timesheetQuery: { ...query, ...overrides },
  })
}

describe("timesheet approval refresh lifecycle", () => {
  it("blocks competing work synchronously from submission through the tagged refresh", () => {
    const lifecycle = new TimesheetApprovalRefreshLifecycle()
    const approvalRefreshIdentity = identity(1)

    expect(lifecycle.beginSubmission()).toBe(true)
    expect(lifecycle.isBusy()).toBe(true)
    expect(lifecycle.beginSubmission()).toBe(false)

    lifecycle.tag(approvalRefreshIdentity)
    lifecycle.finishSubmission()
    expect(lifecycle.isBusy()).toBe(true)

    expect(lifecycle.begin(approvalRefreshIdentity)).toBe(true)
    lifecycle.settle(approvalRefreshIdentity, false)
    expect(lifecycle.isBusy()).toBe(false)
  })

  it("keeps the current approval panel only for the exact tagged request", () => {
    const lifecycle = new TimesheetApprovalRefreshLifecycle()
    const loadedIdentity = identity(0)
    const approvalRefreshIdentity = identity(1)

    lifecycle.tag(approvalRefreshIdentity)

    expect(lifecycle.begin(approvalRefreshIdentity)).toBe(true)
    expect(shouldRenderWorkforceData({
      loadedIdentity,
      activeIdentity: approvalRefreshIdentity,
      loading: true,
      taggedApprovalRefresh: lifecycle.isActive(approvalRefreshIdentity),
    })).toBe(true)
  })

  it("survives a Strict Mode abort/restart but consumes the tag after live settlement", () => {
    const lifecycle = new TimesheetApprovalRefreshLifecycle()
    const approvalRefreshIdentity = identity(1)

    lifecycle.tag(approvalRefreshIdentity)
    expect(lifecycle.begin(approvalRefreshIdentity)).toBe(true)
    lifecycle.settle(approvalRefreshIdentity, true)

    expect(lifecycle.begin(approvalRefreshIdentity)).toBe(true)
    lifecycle.settle(approvalRefreshIdentity, false)
    expect(lifecycle.isActive(approvalRefreshIdentity)).toBe(false)
  })

  it("retains data after a tagged failure, then hides it for the next ordinary filter load", () => {
    const lifecycle = new TimesheetApprovalRefreshLifecycle()
    const approvalRefreshIdentity = identity(1)
    const filteredIdentity = identity(1, { start: "2026-09-08" })

    lifecycle.tag(approvalRefreshIdentity)
    expect(lifecycle.begin(approvalRefreshIdentity)).toBe(true)

    const retainedDataIdentity = approvalRefreshIdentity
    lifecycle.settle(approvalRefreshIdentity, false)
    expect(shouldRenderWorkforceData({
      loadedIdentity: retainedDataIdentity,
      activeIdentity: approvalRefreshIdentity,
      loading: false,
      taggedApprovalRefresh: lifecycle.isActive(approvalRefreshIdentity),
    })).toBe(true)

    expect(lifecycle.begin(filteredIdentity)).toBe(false)
    expect(shouldRenderWorkforceData({
      loadedIdentity: retainedDataIdentity,
      activeIdentity: filteredIdentity,
      loading: true,
      taggedApprovalRefresh: lifecycle.isActive(filteredIdentity),
    })).toBe(false)
  })

  it("renders replacement data and closes the preserve window after a tagged success", () => {
    const lifecycle = new TimesheetApprovalRefreshLifecycle()
    const approvalRefreshIdentity = identity(1)

    lifecycle.tag(approvalRefreshIdentity)
    expect(lifecycle.begin(approvalRefreshIdentity)).toBe(true)

    const replacementDataIdentity = approvalRefreshIdentity
    lifecycle.settle(approvalRefreshIdentity, false)
    expect(lifecycle.isActive(approvalRefreshIdentity)).toBe(false)
    expect(shouldRenderWorkforceData({
      loadedIdentity: replacementDataIdentity,
      activeIdentity: approvalRefreshIdentity,
      loading: false,
      taggedApprovalRefresh: lifecycle.isActive(approvalRefreshIdentity),
    })).toBe(true)
  })

  it("discards an approval tag when a different query replaces an aborted refresh", () => {
    const lifecycle = new TimesheetApprovalRefreshLifecycle()
    const approvalRefreshIdentity = identity(1)
    const filteredIdentity = identity(1, { end: "2026-09-29" })

    lifecycle.tag(approvalRefreshIdentity)
    expect(lifecycle.begin(approvalRefreshIdentity)).toBe(true)
    lifecycle.settle(approvalRefreshIdentity, true)

    expect(lifecycle.begin(filteredIdentity)).toBe(false)
    expect(lifecycle.isActive(approvalRefreshIdentity)).toBe(false)
  })
})
