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
  const { orgId } = gate
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
      if (row.channelType === "voip" || d.channelType === "voip") {
        return NextResponse.json(
          { error: "VoIP configuration must be managed through the dedicated VoIP endpoint" },
          { status: 403 },
        )
      }
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

      const data = isWa
        ? {
            ...d,
            apiKey:      d.accessToken       ?? d.apiKey,
            phoneNumber: d.phoneNumberId     ?? d.phoneNumber,
            webhookUrl:  d.businessAccountId ?? d.webhookUrl,
          }
        : isTikTokChatwoot
          ? {
              ...d,
              settings: tiktokChannelConfigSettings(mergeTikTokSettingsForUpdate(d.settings ?? {}, row.settings)),
            }
        : d

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
          channelType: { not: "voip" },
        },
        data,
      })
      if (result.count === 0) {
        const current = await prisma.channelConfig.findFirst({
          where: { id, organizationId: orgId },
          select: { channelType: true },
        })
        if (current?.channelType === "voip") {
          return NextResponse.json(
            { error: "VoIP configuration must be managed through the dedicated VoIP endpoint" },
            { status: 403 },
          )
        }
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      const updated = await prisma.channelConfig.findFirst({ where: { id, organizationId: orgId } })
      if (updated) {
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
  const { orgId } = gate
  const { id } = await params

  return runWithTenant(gate.orgId, async () => {
    try {
      const row = await prisma.channelConfig.findFirst({
        where: { id, organizationId: orgId },
        select: { channelType: true },
      })
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

      if (row.channelType === "voip") {
        return NextResponse.json(
          { error: "VoIP configuration must be managed through the dedicated VoIP endpoint" },
          { status: 403 },
        )
      }

      const result = await prisma.channelConfig.deleteMany({
        where: {
          id,
          organizationId: orgId,
          channelType: { not: "voip" },
        },
      })
      if (result.count === 0) {
        const current = await prisma.channelConfig.findFirst({
          where: { id, organizationId: orgId },
          select: { channelType: true },
        })
        if (current?.channelType === "voip") {
          return NextResponse.json(
            { error: "VoIP configuration must be managed through the dedicated VoIP endpoint" },
            { status: 403 },
          )
        }
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      return NextResponse.json({ success: true, data: { deleted: id } })
    } catch (e) {
      console.error(e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}
