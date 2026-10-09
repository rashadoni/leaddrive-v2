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

  // «Стоит N минут»: the same write keeps the current stop — where it began,
  // when, and when it was last confirmed (src/lib/mtm/stationary-anchor.ts).
  // What matters here is WHAT is written and what is read for it — the rules
  // themselves have their own test.
  describe("the current stop", () => {
    const still = { ...input, speed: 0, isMoving: false }
    const STOP = ["stationarySince", "stationaryLatitude", "stationaryLongitude", "stationaryConfirmedAt"]
    const written = (client: ReturnType<typeof tx>, call = 0) => client.mtmAgentLatestLocation.updateMany.mock.calls[call][0].data as Record<string, unknown>

    it("a moving point clears it without reading anything first — whatever its accuracy", async () => {
      for (const accuracy of [8, 400]) {
        const client = tx()
        client.mtmAgentLatestLocation.updateMany.mockResolvedValue({ count: 1 })
        await advanceMtmAgentLatestLocation(client as never, { ...input, accuracy })
        expect(client.mtmAgentLatestLocation.findUnique).not.toHaveBeenCalled()
        expect(written(client)).toMatchObject({ stationarySince: null, stationaryLatitude: null, stationaryLongitude: null, stationaryConfirmedAt: null })
      }
    })

    it("a still point too vague to trust does not touch it — and reads nothing either", async () => {
      const client = tx()
      client.mtmAgentLatestLocation.updateMany.mockResolvedValue({ count: 1 })
      await advanceMtmAgentLatestLocation(client as never, { ...still, accuracy: 400 })
      expect(client.mtmAgentLatestLocation.findUnique).not.toHaveBeenCalled()
      for (const column of STOP) expect(written(client)).not.toHaveProperty(column)
      // The position itself still advances, as it always did.
      expect(written(client)).toMatchObject({ latitude: 40.4, accuracy: 400, recordedAt: input.recordedAt })
    })

    it("the first still point starts the stop at that point", async () => {
      const client = tx()
      client.mtmAgentLatestLocation.findUnique.mockResolvedValue({
        recordedAt: new Date("2026-08-28T08:59:00.000Z"), stationarySince: null, stationaryLatitude: null, stationaryLongitude: null, stationaryConfirmedAt: null,
      })
      client.mtmAgentLatestLocation.updateMany.mockResolvedValue({ count: 1 })
      await advanceMtmAgentLatestLocation(client as never, still)
      expect(client.mtmAgentLatestLocation.findUnique).toHaveBeenCalledTimes(1)
      expect(client.mtmAgentLatestLocation.findUnique.mock.invocationCallOrder[0])
        .toBeLessThan(client.mtmAgentLatestLocation.updateMany.mock.invocationCallOrder[0])
      // The row is read for exactly what the decision needs.
      expect(Object.keys(client.mtmAgentLatestLocation.findUnique.mock.calls[0][0].select).sort()).toEqual(["recordedAt", ...STOP].sort())
      expect(written(client)).toMatchObject({
        stationarySince: input.recordedAt, stationaryLatitude: 40.4, stationaryLongitude: 49.8, stationaryConfirmedAt: input.recordedAt,
      })
      // The guard against an older point is the same one, untouched.
      expect(client.mtmAgentLatestLocation.updateMany.mock.calls[0][0].where)
        .toEqual({ organizationId: "org-1", agentId: "agent-1", recordedAt: { lte: input.recordedAt } })
    })

    it("a still point of the same stop writes the confirmation alone — a moving point landing at the same moment is not overwritten with the old stop", async () => {
      const client = tx()
      client.mtmAgentLatestLocation.findUnique.mockResolvedValue({
        recordedAt: new Date("2026-08-28T08:59:00.000Z"),
        stationarySince: new Date("2026-08-28T08:30:00.000Z"), stationaryLatitude: 40.4001, stationaryLongitude: 49.8001,
        stationaryConfirmedAt: new Date("2026-08-28T08:59:00.000Z"),
      })
      client.mtmAgentLatestLocation.updateMany.mockResolvedValue({ count: 1 })
      await advanceMtmAgentLatestLocation(client as never, still)
      for (const column of ["stationarySince", "stationaryLatitude", "stationaryLongitude"]) expect(written(client)).not.toHaveProperty(column)
      expect(written(client)).toMatchObject({ recordedAt: input.recordedAt, stationaryConfirmedAt: input.recordedAt })
    })

    it("a stop last confirmed more than ten minutes ago is started again, however fresh the row's own time is", async () => {
      const client = tx()
      client.mtmAgentLatestLocation.findUnique.mockResolvedValue({
        // Advanced a minute ago — by vague points, or by a build that knows nothing of the stop.
        recordedAt: new Date("2026-08-28T08:59:00.000Z"),
        stationarySince: new Date("2026-08-27T08:30:00.000Z"), stationaryLatitude: 40.4, stationaryLongitude: 49.8,
        stationaryConfirmedAt: new Date("2026-08-27T17:00:00.000Z"),
      })
      client.mtmAgentLatestLocation.updateMany.mockResolvedValue({ count: 1 })
      await advanceMtmAgentLatestLocation(client as never, still)
      expect(written(client)).toMatchObject({ stationarySince: input.recordedAt, stationaryConfirmedAt: input.recordedAt })
    })

    it("a still point for somebody with no row yet creates it with the stop started, after one read — not two", async () => {
      const client = tx()
      client.mtmAgentLatestLocation.findUnique.mockResolvedValue(null)
      client.mtmAgentLatestLocation.updateMany.mockResolvedValue({ count: 0 })
      client.mtmAgentLatestLocation.create.mockResolvedValue({ id: "latest-1" })
      await advanceMtmAgentLatestLocation(client as never, still)
      expect(client.mtmAgentLatestLocation.findUnique).toHaveBeenCalledTimes(1)
      expect(client.mtmAgentLatestLocation.create.mock.calls[0][0].data).toMatchObject({
        organizationId: "org-1", agentId: "agent-1",
        stationarySince: input.recordedAt, stationaryLatitude: 40.4, stationaryLongitude: 49.8, stationaryConfirmedAt: input.recordedAt,
      })
    })

    it("a still point older than the row changes nothing at all", async () => {
      const client = tx()
      client.mtmAgentLatestLocation.findUnique.mockResolvedValue({
        recordedAt: new Date("2026-08-28T09:05:00.000Z"),
        stationarySince: new Date("2026-08-28T09:02:00.000Z"), stationaryLatitude: 41, stationaryLongitude: 50,
        stationaryConfirmedAt: new Date("2026-08-28T09:05:00.000Z"),
      })
      client.mtmAgentLatestLocation.updateMany.mockResolvedValue({ count: 0 })
      await advanceMtmAgentLatestLocation(client as never, still)
      expect(client.mtmAgentLatestLocation.create).not.toHaveBeenCalled()
      expect(client.mtmAgentLatestLocation.updateMany).toHaveBeenCalledTimes(1)
      for (const column of STOP) expect(written(client)).not.toHaveProperty(column)
    })
  })
})
