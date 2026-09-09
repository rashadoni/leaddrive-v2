import { describe, expect, it, vi } from "vitest"
import { advanceMtmAgentLatestLocation } from "@/lib/mtm/mobile-location-latest"

const input = {
  organizationId: "org-1",
  agentId: "agent-1",
  sourceLocationId: "location-1",
  payloadSha256: "a".repeat(64),
  latitude: 40.4,
  longitude: 49.8,
  accuracy: 8,
  speed: 2,
  heading: null,
  altitude: null,
  battery: 80,
  isMoving: true,
  recordedAt: new Date("2026-08-28T09:00:00.000Z"),
  receivedAt: new Date("2026-08-28T10:00:00.000Z"),
}

function tx() {
  return {
    mtmAgentLatestLocation: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  }
}

describe("advanceMtmAgentLatestLocation", () => {
  it("does not let a delayed offline point regress a newer live projection", async () => {
    const client = tx()
    client.mtmAgentLatestLocation.updateMany.mockResolvedValue({ count: 0 })
    client.mtmAgentLatestLocation.findUnique.mockResolvedValue({ recordedAt: new Date("2026-08-28T09:05:00.000Z") })

    await advanceMtmAgentLatestLocation(client as never, input)

    expect(client.mtmAgentLatestLocation.create).not.toHaveBeenCalled()
    expect(client.mtmAgentLatestLocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ recordedAt: { lte: input.recordedAt } }),
    }))
  })

  it("creates the projection only when no current row exists", async () => {
    const client = tx()
    client.mtmAgentLatestLocation.updateMany.mockResolvedValue({ count: 0 })
    client.mtmAgentLatestLocation.findUnique.mockResolvedValue(null)
    client.mtmAgentLatestLocation.create.mockResolvedValue({ id: "latest-1" })

    await advanceMtmAgentLatestLocation(client as never, input)

    expect(client.mtmAgentLatestLocation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-1", agentId: "agent-1", recordedAt: input.recordedAt }),
    }))
  })
})
