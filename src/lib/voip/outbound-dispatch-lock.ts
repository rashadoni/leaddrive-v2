import { Prisma } from "@prisma/client"

const PAUSE_SETTING_KEY = "outboundCallDispatchPaused"

type DispatchGateTx = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">

export class OutboundVoiceDispatchPausedError extends Error {
  constructor() {
    super("outbound voice dispatch is paused")
  }
}

export class OutboundVoiceDispatchConfigurationError extends OutboundVoiceDispatchPausedError {
  constructor() {
    super()
    this.message = "outbound voice dispatch configuration is unavailable"
  }
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Linearizes a call preparation transaction with the production transport
 * cutover. The workflow takes the same tenant lock before setting the durable
 * pause and refuses to report a pause while an active/uncertain attempt exists.
 */
export async function assertOutboundVoiceDispatchAllowed(params: {
  tx: DispatchGateTx
  organizationId: string
  channelConfigId?: string
}): Promise<void> {
  // The lock function returns PostgreSQL void, so execute it without asking
  // Prisma to deserialize the result row.
  await params.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`voip-config:${params.organizationId}`}, 0))`

  const idFilter = params.channelConfigId
    ? Prisma.sql`AND id = ${params.channelConfigId}`
    : Prisma.empty
  const rows = await params.tx.$queryRaw<Array<{ settings: Prisma.JsonValue }>>(Prisma.sql`
    SELECT settings
    FROM channel_configs
    WHERE "organizationId" = ${params.organizationId}
      AND "channelType" = 'voip'
      AND "isActive" = true
      AND lower(coalesce(settings->>'provider', '')) = 'asterisk'
      ${idFilter}
    ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    FOR SHARE
  `)
  if (rows.length !== 1) throw new OutboundVoiceDispatchConfigurationError()
  const settings = settingsRecord(rows[0].settings)
  if (
    Object.prototype.hasOwnProperty.call(settings, PAUSE_SETTING_KEY)
    && typeof settings[PAUSE_SETTING_KEY] !== "boolean"
  ) {
    throw new OutboundVoiceDispatchConfigurationError()
  }
  if (settings[PAUSE_SETTING_KEY] === true) throw new OutboundVoiceDispatchPausedError()
}
