import { z } from "zod"

import { runWithTenant } from "../../rls-context"
import { validateZeytunCallContext, type ZeytunCallLookup } from "./zeytun-call-context"

type Query = <T = unknown>(sql: TemplateStringsArray, ...values: unknown[]) => Promise<T>
/** Minimal Prisma-compatible surface. Use the application's RLS-enabled client;
 * the explicit transaction settings also protect a plain test/client connection.
 */
export type ZeytunCallDatabase = {
  $transaction: <T>(read: (tx: { $queryRaw: Query }) => Promise<T>, options: {
    isolationLevel: "ReadCommitted"; maxWait: number; timeout: number
  }) => Promise<T>
}
const id = z.string().min(1).max(128).refine((value) => value === value.trim())
const scopeSchema = z.strictObject({ organizationId: id, channelConfigId: id })
const lookupSchema = scopeSchema.extend({ provider: z.literal("asterisk"), providerCallId: z.uuid() })
const rowSchema = z.strictObject({
  startedAt: z.date(), call: z.record(z.string(), z.unknown()),
  channel: z.unknown(), subject: z.unknown(), company: z.unknown(),
})

/** One coherent, bounded CRM read. It never creates a customer/call, infers an
 * answered state, selects the newest channel or falls back to phone/name lookup.
 * Wire this into loadCall only after the server's tenant/line are verified.
 */
export function createZeytunCallLoader(input: unknown, database: ZeytunCallDatabase, clock: () => number = Date.now) {
  const configured = scopeSchema.safeParse(input)
  if (!configured.success) throw new Error("invalid_call_loader_configuration")
  const config = configured.data
  return async (inputLookup: ZeytunCallLookup) => {
    const checked = lookupSchema.safeParse(inputLookup)
    if (!checked.success || checked.data.organizationId !== config.organizationId || checked.data.channelConfigId !== config.channelConfigId) return null
    const lookup = checked.data
    let rows: unknown
    try {
      rows = await runWithTenant(config.organizationId, () => database.$transaction(async (tx) => {
        // All settings are transaction-local on the same connection. Clear a
        // reused bypass flag explicitly; never inherit a global admin context.
        await tx.$queryRaw`
          SELECT set_config('app.org_id', ${config.organizationId}, true),
                 set_config('app.rls_bypass', 'off', true),
                 set_config('statement_timeout', '1500ms', true),
                 set_config('lock_timeout', '500ms', true)
        `
        return tx.$queryRaw`
          WITH candidates AS (
            SELECT id, "organizationId", "providerCallId", "channelConfigId", provider, "callMode",
              direction, status, "wasAnswered", "fromNumber", "toNumber", "targetPhoneE164",
              "contactId", "companyId", "leadId", "endedAt", "startedAt"
            FROM "call_logs"
            WHERE "organizationId" = ${config.organizationId}
              AND "provider" = 'asterisk' AND "providerCallId" = ${lookup.providerCallId}
            LIMIT 2
          )
          SELECT c."startedAt" AS "startedAt",
            jsonb_build_object(
              'id', c.id, 'organizationId', c."organizationId", 'providerCallId', c."providerCallId",
              'channelConfigId', c."channelConfigId", 'provider', c.provider, 'callMode', c."callMode",
              'direction', c.direction, 'status', c.status, 'wasAnswered', c."wasAnswered",
              'fromNumber', c."fromNumber", 'toNumber', c."toNumber", 'targetPhoneE164', c."targetPhoneE164",
              'contactId', c."contactId", 'companyId', c."companyId", 'leadId', c."leadId", 'endedAt', c."endedAt"
            ) AS "call",
            jsonb_build_object(
              'id', ch.id, 'organizationId', ch."organizationId", 'channelType', ch."channelType", 'isActive', ch."isActive",
              'settings', jsonb_build_object('provider', ch.settings->'provider', 'voiceAgentEnabled', ch.settings->'voiceAgentEnabled')
            ) AS channel,
            CASE WHEN contact.id IS NOT NULL THEN jsonb_build_object(
              'kind', 'contact', 'id', contact.id, 'organizationId', contact."organizationId",
              'companyId', contact."companyId", 'isActive', contact."isActive"
            ) WHEN lead.id IS NOT NULL THEN jsonb_build_object(
              'kind', 'lead', 'id', lead.id, 'organizationId', lead."organizationId", 'status', lead.status
            ) ELSE NULL END AS subject,
            CASE WHEN company.id IS NOT NULL THEN jsonb_build_object(
              'id', company.id, 'organizationId', company."organizationId", 'status', company.status
            ) ELSE NULL END AS company
          FROM candidates c
          JOIN "organizations" org ON org.id = c."organizationId" AND org."isActive" = true
          JOIN "channel_configs" ch ON ch.id = c."channelConfigId" AND ch."organizationId" = c."organizationId"
          LEFT JOIN "contacts" contact ON contact.id = c."contactId" AND contact."organizationId" = c."organizationId"
          LEFT JOIN "companies" company ON company.id = contact."companyId" AND company."organizationId" = c."organizationId"
          LEFT JOIN "leads" lead ON lead.id = c."leadId" AND lead."organizationId" = c."organizationId"
          WHERE (SELECT count(*) FROM candidates) = 1
            AND c."channelConfigId" = ${config.channelConfigId}
            AND c."callMode" = 'ai' AND c.status = 'in-progress' AND c."wasAnswered" = true AND c."endedAt" IS NULL
            AND ch."channelType" = 'voip' AND ch."isActive" = true
            AND ch.settings->'provider' = '"asterisk"'::jsonb AND ch.settings->'voiceAgentEnabled' = 'true'::jsonb
        `
      }, { isolationLevel: "ReadCommitted", maxWait: 500, timeout: 2500 }))
    } catch {
      // SQL/driver errors may contain bind values or connection credentials.
      throw new Error("call_context_unavailable")
    }
    if (!Array.isArray(rows) || rows.length !== 1) return null
    const row = rowSchema.safeParse(rows[0])
    if (!row.success) return null
    return validateZeytunCallContext({
      call: { ...row.data.call, startedAt: row.data.startedAt.toISOString() },
      channel: row.data.channel, subject: row.data.subject, company: row.data.company,
    }, lookup, clock())
  }
}
