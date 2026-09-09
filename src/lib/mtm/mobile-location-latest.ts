import { Prisma } from "@prisma/client"

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
 */
export async function advanceMtmAgentLatestLocation(
  tx: Pick<Prisma.TransactionClient, "mtmAgentLatestLocation">,
  input: MtmLatestLocationInput,
): Promise<void> {
  const where = { organizationId: input.organizationId, agentId: input.agentId }
  const data = latestLocationData(input)
  const updated = await tx.mtmAgentLatestLocation.updateMany({
    where: { ...where, recordedAt: { lte: input.recordedAt } },
    data,
  })
  if (updated?.count === 1) return

  const existing = await tx.mtmAgentLatestLocation.findUnique({
    where: { organizationId_agentId: where },
    select: { recordedAt: true },
  })
  // A newer row is intentionally preserved. No out-of-order raw GPS upload
  // may regress a live marker.
  if (existing) return

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
