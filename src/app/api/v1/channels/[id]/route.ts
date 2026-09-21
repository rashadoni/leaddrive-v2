import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { gateChannelsAccess } from "@/lib/channels-access"
import { runWithTenant } from "@/lib/rls-context"
import { whatsappChannelCredentialsError } from "@/lib/channels/whatsapp-config-validation"
import { isTikTokChatwootChannelConfig, syncTikTokDmConnectionForChannelConfig, tiktokChannelConfigSettings } from "@/lib/channels/platform-connections"
import { publicChannelConfig } from "@/lib/channels/public-channel-config"
import { channelIdsClaimedElsewhere } from "@/lib/channels/inbound-claim"
import { emailIntakeSettingsError } from "@/lib/ticketing/email-intake"
import { validateChatwootBaseUrl } from "@/lib/chatwoot"
import { auditChannelChange, changedCredentialFields } from "@/lib/channels/channel-credential-audit"
import { isMetaInboxChannelType, mergeMetaSettingsForUpdate } from "@/lib/channels/meta-server-settings"
import { channelSettingsForUpdate } from "@/lib/channels/server-owned-settings"
import { DEDICATED_CHANNEL_TYPES, dedicatedChannelTypeError } from "@/lib/channels/dedicated-channel-types"

const updateChannelSchema = z.object({
  channelType: z.string().min(1).optional(),
  configName: z.string().min(1).max(200).optional(),
  botToken: z.string().optional(),
  webhookUrl: z.string().optional(),
  apiKey: z.string().optional(),
  phoneNumber: z.string().optional(),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  pageId: z.string().optional(),
  settings: z.any().optional(),
  isActive: z.boolean().optional(),
  // Multi-tenant WhatsApp fields
  accessToken: z.string().optional(),
  phoneNumberId: z.string().optional(),
  businessAccountId: z.string().optional(),
  verifyToken: z.string().optional(),
  displayName: z.string().optional(),
})

function asSettingsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringSetting(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function mergeTikTokSettingsForUpdate(nextSettings: unknown, existingSettings: unknown): Record<string, unknown> {
  const existing = asSettingsRecord(existingSettings)
  const next = asSettingsRecord(nextSettings)
  const merged = { ...existing, ...next }

  if (!stringSetting(next.webhookSecret) && stringSetting(existing.webhookSecret)) {
    merged.webhookSecret = existing.webhookSecret
  }

  return merged
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { orgId } = gate
  const { id } = await params

  return runWithTenant(gate.orgId, async () => {
    try {
      const channel = await prisma.channelConfig.findFirst({
        where: { id, organizationId: orgId },
      })
      if (!channel) return NextResponse.json({ error: "Not found" }, { status: 404 })
      const claimedElsewhere = await channelIdsClaimedElsewhere(orgId, [channel])
      return NextResponse.json({
        success: true,
        data: { ...publicChannelConfig(channel), claimedElsewhere: claimedElsewhere.has(channel.id) },
      })
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { orgId, userId } = gate
  const { id } = await params
  const body = await req.json()
  const parsed = updateChannelSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  return runWithTenant(gate.orgId, async () => {
    try {
      // Mirror new WhatsApp fields into the legacy trio during transition.
      const row = await prisma.channelConfig.findFirst({ where: { id, organizationId: orgId } })
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

      const d = parsed.data
      // A row owned by its own screen is not edited here, nor another row turned into one
      // (lib/channels/dedicated-channel-types).
      const dedicatedError = dedicatedChannelTypeError(row.channelType, d.channelType)
      if (dedicatedError) return NextResponse.json({ error: dedicatedError }, { status: 403 })
      const isWa = row?.channelType === "whatsapp" || d.channelType === "whatsapp"
      const credentialsError = whatsappChannelCredentialsError(d, row)
      if (credentialsError) return NextResponse.json({ error: credentialsError }, { status: 400 })
      const intakeSettingsError = emailIntakeSettingsError(d.channelType ?? row.channelType, d.settings ?? row.settings)
      if (intakeSettingsError) return NextResponse.json({ error: intakeSettingsError }, { status: 400 })

      const isTikTokChatwoot = (row.channelType === "chatwoot" || d.channelType === "chatwoot")
        && isTikTokChatwootChannelConfig({
          channelType: d.channelType ?? row.channelType,
          configName: d.configName ?? row.configName,
          settings: d.settings ?? row.settings,
        })
      // The form sends `settings` rebuilt from its own fields only; on a Meta row that must not erase the
      // keys the server wrote (lib/channels/meta-server-settings).
      const isMeta = isMetaInboxChannelType(row.channelType) || isMetaInboxChannelType(d.channelType)

      // "Leave blank to keep the stored value" is the contract the UI states and the form honours
      // (`buildChannelPayload` turns an empty field into `undefined`). The API did not enforce it:
      // `z.string().optional()` accepts "", and the payload is spread straight into `updateMany`, so
      // a PUT carrying `{"appSecret": ""}` silently overwrote a live credential with an empty string
      // and broke the channel — a webhook signature check and an OAuth exchange both fail closed on
      // an empty secret, so the failure would surface later, as "messages stopped arriving".
      //
      // Clearing a credential on purpose has its own route: DELETE nulls all of them together and
      // writes a `disconnect` audit entry. So a blank here can only ever mean "keep".
      for (const field of ["botToken", "apiKey", "appSecret", "accessToken", "verifyToken"] as const) {
        // `d` is the object the update below spreads, so drop the key there rather than relying on
        // it aliasing `parsed.data`.
        if (typeof d[field] === "string" && d[field]!.trim() === "") delete d[field]
      }

      // Every other type: a save must not erase what other screens and endpoints wrote, nor touch the settings of a
      // row the form does not configure at all (lib/channels/server-owned-settings).
      const otherTypeSettings = !isMeta && d.settings !== undefined
        ? { settings: channelSettingsForUpdate(row.channelType, d.settings, row.settings) }
        : {}

      const data = isWa
        ? {
            ...d,
            apiKey:      d.accessToken       ?? d.apiKey,
            phoneNumber: d.phoneNumberId     ?? d.phoneNumber,
            webhookUrl:  d.businessAccountId ?? d.webhookUrl,
            ...otherTypeSettings,
          }
        : isTikTokChatwoot
          ? {
              ...d,
              settings: tiktokChannelConfigSettings(mergeTikTokSettingsForUpdate(d.settings ?? {}, row.settings)),
            }
        : isMeta && d.settings !== undefined
          ? { ...d, settings: mergeMetaSettingsForUpdate(d.settings, row.settings) }
        : { ...d, ...otherTypeSettings }

      if ((data.channelType ?? row.channelType) === "chatwoot") {
        try {
          await validateChatwootBaseUrl(data.settings ?? row.settings)
        } catch {
          return NextResponse.json(
            { error: "Chatwoot baseUrl must be a resolvable public HTTPS URL" },
            { status: 400 },
          )
        }
      }

      const result = await prisma.channelConfig.updateMany({
        where: {
          id,
          organizationId: orgId,
          channelType: { notIn: DEDICATED_CHANNEL_TYPES },
        },
        data,
      })
      if (result.count === 0) {
        const current = await prisma.channelConfig.findFirst({
          where: { id, organizationId: orgId },
          select: { channelType: true },
        })
        const currentError = dedicatedChannelTypeError(current?.channelType)
        if (currentError) return NextResponse.json({ error: currentError }, { status: 403 })
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      const updated = await prisma.channelConfig.findFirst({ where: { id, organizationId: orgId } })
      if (updated) {
        await auditChannelChange({
          req, orgId, userId, action: "update",
          channelId: updated.id, channelType: updated.channelType, configName: updated.configName,
          credentialFields: changedCredentialFields(body),
        })
        await syncTikTokDmConnectionForChannelConfig(updated).catch((error) => {
          console.error("[channels PUT] TikTok ChannelConnection sync failed", error)
        })
      }
      const claimedElsewhere = updated ? await channelIdsClaimedElsewhere(orgId, [updated]) : new Set<string>()
      return NextResponse.json({
        success: true,
        data: updated ? { ...publicChannelConfig(updated), claimedElsewhere: claimedElsewhere.has(updated.id) } : null,
      })
    } catch (e) {
      console.error(e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { orgId, userId } = gate
  const { id } = await params

  return runWithTenant(gate.orgId, async () => {
    try {
      const row = await prisma.channelConfig.findFirst({
        where: { id, organizationId: orgId },
        select: { channelType: true, pageId: true },
      })
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

      const dedicatedError = dedicatedChannelTypeError(row.channelType)
      if (dedicatedError) return NextResponse.json({ error: dedicatedError }, { status: 403 })

      if (["facebook", "instagram", "whatsapp"].includes(row.channelType)) {
        await prisma.channelConfig.updateMany({
          where: { id, organizationId: orgId },
          data: {
            isActive: false,
            botToken: null,
            apiKey: null,
            appSecret: null,
            accessToken: null,
            verifyToken: null,
          },
        })
        await prisma.channelConnection.updateMany({
          where: { organizationId: orgId, channelConfigId: id },
          data: {
            status: "disabled",
            apiKey: null,
            accessToken: null,
            refreshToken: null,
            secretRef: null,
          },
        })
        if ((row.channelType === "facebook" || row.channelType === "instagram") && row.pageId) {
          await prisma.socialAccount.updateMany({
            where: {
              organizationId: orgId,
              platform: row.channelType,
              handle: row.pageId,
            },
            data: {
              isActive: false,
              accessToken: null,
              tokenExpiresAt: null,
            },
          })
        }
        await auditChannelChange({
          req, orgId, userId, action: "disconnect",
          channelId: id, channelType: row.channelType,
          // Disconnect clears every credential column; naming them is what makes the trail useful
          // when asked "when did this integration stop holding tokens".
          credentialFields: ["apiKey", "appSecret", "accessToken", "verifyToken", "botToken"],
        })
        return NextResponse.json({ success: true, data: { disconnected: id } })
      }

      const result = await prisma.channelConfig.deleteMany({
        where: {
          id,
          organizationId: orgId,
          channelType: { notIn: DEDICATED_CHANNEL_TYPES },
        },
      })
      if (result.count === 0) {
        const current = await prisma.channelConfig.findFirst({
          where: { id, organizationId: orgId },
          select: { channelType: true },
        })
        const currentError = dedicatedChannelTypeError(current?.channelType)
        if (currentError) return NextResponse.json({ error: currentError }, { status: 403 })
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      await auditChannelChange({
        req, orgId, userId, action: "delete",
        channelId: id, channelType: row.channelType,
      })
      return NextResponse.json({ success: true, data: { deleted: id } })
    } catch (e) {
      console.error(e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}
