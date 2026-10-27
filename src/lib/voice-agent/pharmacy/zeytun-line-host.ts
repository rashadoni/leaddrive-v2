import type { PrismaClient } from "@prisma/client"

import { getOrgModuleContext } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { shellPresentUserIds } from "@/lib/shell-events/presence"
import { browserSoftphoneAllowed } from "@/lib/voip/browser-softphone"
import { organizationHoldsLine } from "@/lib/voip/line-numbers"

import { createInboundPilotHost } from "./zeytun-inbound-host"
import { inboundPilotConfigSchema, isLineGrant } from "./zeytun-inbound-pilot"

type Host = ReturnType<typeof createInboundPilotHost>
const KEY = Symbol.for("leaddrive.zeytunLineHost")

/** The line's host, one per process: the session route, the refresh cron and
 * the startup hook are separate bundles and must share its parsed catalog. */
export function zeytunLineHost(): Host {
  const store = globalThis as typeof globalThis & { [KEY]?: Host }
  return store[KEY] ??= createInboundPilotHost({
    configFile: process.env.ZEYTUN_INBOUND_PILOT_FILE ?? "",
    snapshotDirectory: process.env.ZEYTUN_CACHE_DIR ?? "",
    runtimeOrganizationId: process.env.VOICE_AGENT_ORGANIZATION_ID ?? "",
    database: prisma,
    orders: prisma as unknown as PrismaClient,
    holdsLine: organizationHoldsLine,
    transferAvailable: async (organizationId) => managerCanAnswer(organizationId),
  })
}

/**
 * Whether a transfer would reach a person (owner, 2026-10-27: «перевод на
 * менеджера только в рабочее время или когда менеджер в сети»): someone who
 * may answer in the browser has the CRM open now. With nobody there the agent
 * hears "unavailable" and takes the order itself, instead of the pharmacy
 * listening to 30 s of ringing at night.
 */
export async function managerCanAnswer(organizationId: string,
  present: (orgId: string) => string[] = shellPresentUserIds): Promise<boolean> {
  const users = present(organizationId)
  if (!users.length) return false
  const { modules } = await getOrgModuleContext(organizationId)
  return users.some(userId => browserSoftphoneAllowed(modules, userId))
}

/**
 * Parse the line's catalog and pharmacy list before a call needs them.
 * 2026-10-26 live call: the first call after a deploy found the process cold,
 * parsing the 14 MB catalog and the pharmacy list took longer than the
 * station's 5 s for the session request, and the agent never spoke. Run at
 * start-up and after every refresh tick, so a call only ever reads memory.
 */
export async function warmZeytunLine(host: Host = zeytunLineHost()) {
  const parsed = inboundPilotConfigSchema.safeParse(await host.loadConfig().catch(() => null))
  if (!parsed.success || !isLineGrant(parsed.data)) return { outcome: "not_configured" as const }
  const started = Date.now()
  await host.loadCatalog(parsed.data)
  // Any well-formed number loads the list; the answer itself is not used.
  await host.findPharmacies?.(parsed.data, "+994000000000").catch(() => [])
  return { outcome: "warm" as const, ms: Date.now() - started }
}
