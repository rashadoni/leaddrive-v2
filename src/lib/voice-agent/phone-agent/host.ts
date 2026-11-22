/**
 * The phone agent's reads and writes against the CRM's own database
 * (handler.ts decides; this file only fetches and stores).
 *
 * The station's requests carry no tenant, only its call id. The call's row is
 * therefore found under the RLS bypass — the tenant is what that read finds
 * out, as in src/lib/voip/line-numbers.ts — and it selects nothing but the
 * call's own routing fields. Everything after it runs in that organization's
 * tenant scope.
 */
import type { Prisma } from "@prisma/client"

import { hasModule } from "@/lib/modules"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { orgContext } from "@/lib/booking/book"

import { loadPhoneServices, runBookingTool } from "./booking-tools"
import { createPhoneAgentHandler, type PhoneAgentCall, type PhoneAgentDependencies } from "./handler"
import { PHONE_AGENT_MARKER } from "./marker"

const TX = { isolationLevel: "ReadCommitted", maxWait: 3000, timeout: 4500 } as const

type CallRow = {
  id: string; organizationId: string; channelConfigId: string | null; providerCallId: string | null
  direction: string; callMode: string; status: string; wasAnswered: boolean; endedAt: Date | null
  fromNumber: string; consentAudit: unknown
}

export function createPhoneAgentHost(options: {
  /** The pharmacy line's grant as its host reads it; null when no line is set up. */
  lineGrant: () => Promise<unknown>
}): PhoneAgentDependencies {
  return {
    async loadCall(callId) {
      const rows: CallRow[] = await runWithRlsBypass(() => prisma.callLog.findMany({
        where: { provider: "asterisk", providerCallId: callId }, take: 2,
        select: { id: true, organizationId: true, channelConfigId: true, providerCallId: true, direction: true, callMode: true,
          status: true, wasAnswered: true, endedAt: true, fromNumber: true, consentAudit: true },
      }))
      // The station mints one id per call: two rows mean two organizations claim it, and neither gets a tool.
      if (rows.length !== 1 || !rows[0].channelConfigId || rows[0].providerCallId !== callId) return null
      const row = rows[0], channelConfigId = row.channelConfigId as string
      const [channel, organization]: [{ settings: unknown } | null, { isActive: boolean } | null] = await runWithTenant(row.organizationId, () =>
        Promise.all([
          prisma.channelConfig.findFirst({
            where: { id: channelConfigId, organizationId: row.organizationId, channelType: "voip", isActive: true },
            select: { settings: true },
          }),
          prisma.organization.findUnique({ where: { id: row.organizationId }, select: { isActive: true } }),
        ]))
      const settings = organization?.isActive && channel ? channel.settings : null
      const audit = row.consentAudit && typeof row.consentAudit === "object" && !Array.isArray(row.consentAudit)
        ? row.consentAudit as Record<string, unknown> : {}
      return { id: row.id, organizationId: row.organizationId, channelConfigId, providerCallId: callId,
        direction: row.direction, callMode: row.callMode, status: row.status, wasAnswered: row.wasAnswered,
        endedAt: row.endedAt ? row.endedAt.toISOString() : null, fromNumber: row.fromNumber || null,
        marker: audit[PHONE_AGENT_MARKER], settings } satisfies PhoneAgentCall
    },

    async heldByLine(call) {
      try {
        const grant = await options.lineGrant()
        if (grant === null || grant === undefined) return false
        const value = grant as { organizationId?: unknown; channelConfigId?: unknown }
        // A grant that cannot be read as one still names a line: leave its calls to it.
        if (typeof value !== "object" || typeof value.organizationId !== "string" || typeof value.channelConfigId !== "string") return true
        return value.organizationId === call.organizationId && value.channelConfigId === call.channelConfigId
      } catch (error) {
        // A grant file that is simply not there is no line. Anything else that
        // cannot be read may still be one: its calls are left to it.
        return (error as NodeJS.ErrnoException | null)?.code !== "ENOENT"
      }
    },

    async loadBooking(organizationId) {
      return runWithTenant(organizationId, async () => {
        const org = await prisma.organization.findUnique({
          where: { id: organizationId }, select: { isActive: true, plan: true, addons: true, modules: true } })
        if (!org?.isActive) return null
        const addons = Array.isArray(org.addons) ? org.addons.filter((value: unknown): value is string => typeof value === "string") : []
        const modules = org.modules && typeof org.modules === "object" && !Array.isArray(org.modules)
          ? org.modules as Record<string, boolean> : {}
        // Read here and now, and closed when unreadable: orgHasModule answers "yes" when it cannot tell.
        if (!hasModule({ plan: org.plan, addons, modules }, "booking")) return null
        const services = await loadPhoneServices(organizationId)
        return services.length ? { services, timezone: (await orgContext(organizationId)).timezone } : null
      })
    },

    async mark(call, marker) {
      const value = JSON.stringify(marker)
      const rows: Array<{ id: string }> = await runWithTenant(call.organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT set_config('app.org_id', ${call.organizationId}, true),
          set_config('app.rls_bypass', 'off', true), set_config('statement_timeout', '1500ms', true), set_config('lock_timeout', '500ms', true)`
        // Merged in the database: the lifecycle route writes the same column while the call lives.
        return tx.$queryRaw<Array<{ id: string }>>`
          UPDATE call_logs SET "consentAudit" = coalesce("consentAudit", '{}'::jsonb) ||
            jsonb_build_object(${PHONE_AGENT_MARKER}::text, ${value}::jsonb)
          WHERE id=${call.id} AND "organizationId"=${call.organizationId} AND "channelConfigId"=${call.channelConfigId}
            AND provider='asterisk' AND "providerCallId"=${call.providerCallId} AND direction='inbound'
            AND "callMode"='ai' AND status='in-progress' AND "wasAnswered"=true AND "endedAt" IS NULL
            AND ("consentAudit" IS NULL OR jsonb_typeof("consentAudit")='object')
          RETURNING id
        `
      }, TX))
      return rows.length === 1 && rows[0].id === call.id
    },

    runTool(context, name, args) {
      return runWithTenant(context.organizationId, () => runBookingTool(context, name, args))
    },
  }
}

const KEY = Symbol.for("leaddrive.phoneAgentRoute")
type Route = ReturnType<typeof createPhoneAgentHandler>

/** The agent's route handler, one per process (its per-call budget lives in it). */
export function phoneAgentRoute(lineGrant: () => Promise<unknown>): Route {
  const store = globalThis as typeof globalThis & { [KEY]?: Route }
  return store[KEY] ??= createPhoneAgentHandler(process.env.FANUM_VOICE_RUNTIME_TOKEN ?? "", createPhoneAgentHost({ lineGrant }))
}
