import { Prisma } from "@prisma/client"
import {
  MTM_STATIONARY_NO_ANCHOR,
  classifyMtmStationaryPoint,
  nextMtmStationaryAnchor,
  type MtmStationaryAnchor,
} from "@/lib/mtm/stationary-anchor"

export type MtmLatestLocationInput = {
  organizationId: string
  agentId: string
  sourceLocationId: string | null
  payloadSha256: string | null
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  altitude: number | null
  battery: number | null
  isMoving: boolean
  recordedAt: Date
  receivedAt: Date
}

function latestLocationData(input: MtmLatestLocationInput) {
  return {
    sourceLocationId: input.sourceLocationId,
    payloadSha256: input.payloadSha256,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy,
    speed: input.speed,
    heading: input.heading,
    altitude: input.altitude,
    battery: input.battery,
    isMoving: input.isMoving,
    recordedAt: input.recordedAt,
    receivedAt: input.receivedAt,
  }
}

/**
 * Advance the live-map projection without allowing an offline backlog point
 * to move an agent backwards. The conditional update is race-safe for an
 * existing row; the unique-create race retries that same condition once.
 *
 * The same write keeps the current stop — where it began, when, and when it
 * was last confirmed («стоит N минут», src/lib/mtm/stationary-anchor.ts). A
 * moving point clears it and a still point too vague to trust leaves it
 * alone, both without reading anything. Only a still, trustworthy point has
 * to look at the row first, to tell «the same stop» from «a new one»; when
 * it is the same stop it writes the confirmation alone — where and when the
 * stop began are not written back, so a moving point that lands at the same
 * moment is never overwritten with the old anchor.
 */
export async function advanceMtmAgentLatestLocation(
  tx: Pick<Prisma.TransactionClient, "mtmAgentLatestLocation">,
  input: MtmLatestLocationInput,
): Promise<void> {
  const where = { organizationId: input.organizationId, agentId: input.agentId }
  const kind = classifyMtmStationaryPoint(input)
  let anchor: Partial<MtmStationaryAnchor> = kind === "MOVING" ? MTM_STATIONARY_NO_ANCHOR : {}
  /** Whether the agent has a row — known only when it was read for the anchor. */
  let rowExists: boolean | null = null
  if (kind === "STILL") {
    const previous = (await tx.mtmAgentLatestLocation.findUnique({
      where: { organizationId_agentId: where },
      select: { recordedAt: true, stationarySince: true, stationaryLatitude: true, stationaryLongitude: true, stationaryConfirmedAt: true },
    })) ?? null
    rowExists = previous != null
    anchor = nextMtmStationaryAnchor(previous, input) ?? {}
  }
  const data = { ...latestLocationData(input), ...anchor }
  const updated = await tx.mtmAgentLatestLocation.updateMany({
    where: { ...where, recordedAt: { lte: input.recordedAt } },
    data,
  })
  if (updated?.count === 1) return

  if (rowExists == null) {
    const existing = await tx.mtmAgentLatestLocation.findUnique({
      where: { organizationId_agentId: where },
      select: { recordedAt: true },
    })
    rowExists = existing != null
  }
  // A newer row is intentionally preserved. No out-of-order raw GPS upload
  // may regress a live marker.
  if (rowExists) return

  try {
    await tx.mtmAgentLatestLocation.create({
      data: { ...where, ...data },
    })
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
    await tx.mtmAgentLatestLocation.updateMany({
      where: { ...where, recordedAt: { lte: input.recordedAt } },
      data,
    })
  }
}
