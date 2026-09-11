import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
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

const createChannelSchema = z.object({
  channelType: z.string().min(1),
  configName: z.string().min(1).max(200),
  botToken: z.string().optional(),
  webhookUrl: z.string().optional(),
  apiKey: z.string().optional(),
  phoneNumber: z.string().optional(),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  pageId: z.string().optional(),
  settings: z.any().optional(),
  isActive: z.boolean().optional().default(true),
  // Multi-tenant WhatsApp fields (phase 1+). All optional — only relevant
  // when channelType === "whatsapp".
  accessToken: z.string().optional(),
  phoneNumberId: z.string().optional(),
  businessAccountId: z.string().optional(),
  verifyToken: z.string().optional(),
  displayName: z.string().optional(),
})

type ChannelListRow = {
  id: string
  channelType: string
  configName: string
  phoneNumber: string | null
  pageId: string | null
  appId: string | null
  webhookUrl: string | null
  botToken: string | null
  apiKey: string | null
  appSecret: string | null
  accessToken: string | null
  phoneNumberId: string | null
  businessAccountId: string | null
  verifyToken: string | null
  isActive: boolean
  settings: Prisma.JsonValue | null
  createdAt: Date
  updatedAt: Date
}

export async function GET(req: NextRequest) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { orgId } = gate
  const requestedType = req.nextUrl.searchParams.get("type")?.trim().toLowerCase() || null

  return runWithTenant(orgId, async () => {
    try {
      const channels = await prisma.channelConfig.findMany({
        where: {
          organizationId: orgId,
          ...(requestedType ? { channelType: requestedType } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          channelType: true,
          configName: true,
          phoneNumber: true,
          pageId: true,
          appId: true,
          webhookUrl: true,
          botToken: true,
          apiKey: true,
          appSecret: true,
          accessToken: true,
          phoneNumberId: true,
          businessAccountId: true,
          verifyToken: true, // webhook handshake token (not a signing secret) — needed so the edit form
                             // can show/preserve the tenant's FB/IG + WhatsApp verify token on re-edit
          isActive: true,
          settings: true,
          createdAt: true,
          updatedAt: true,
        },
      }) as ChannelListRow[]

      // A Facebook/Instagram row whose pageId another workspace claimed first delivers nothing here —
      // the card must not call it connected. Only the boolean crosses the tenant boundary.
      const claimedElsewhere = await channelIdsClaimedElsewhere(orgId, channels)
      const safeChannels = channels.map((channel) => ({
        ...publicChannelConfig(channel),
        claimedElsewhere: claimedElsewhere.has(channel.id),
      }))

      return NextResponse.json({ success: true, data: safeChannels })
    } catch (e) {
      console.error("[channels GET]", e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}

export async function POST(req: NextRequest) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { orgId } = gate

  return runWithTenant(orgId, async () => {
    const body = await req.json()
    const parsed = createChannelSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

    try {
      // For whatsapp rows, mirror the new fields back into the legacy trio so
      // the library's legacy-fallback continues to read the same values during
      // the transition. Remove the mirror once all readers switched to new
      // columns exclusively.
      const d = parsed.data
      if (d.channelType === "voip") {
        return NextResponse.json(
          { error: "VoIP configuration must be managed through the dedicated VoIP endpoint" },
          { status: 403 },
        )
      }
      const credentialsError = whatsappChannelCredentialsError(d)
      if (credentialsError) return NextResponse.json({ error: credentialsError }, { status: 400 })
      const intakeSettingsError = emailIntakeSettingsError(d.channelType, d.settings)
      if (intakeSettingsError) return NextResponse.json({ error: intakeSettingsError }, { status: 400 })
      if (d.channelType === "chatwoot") {
        try {
          await validateChatwootBaseUrl(d.settings)
        } catch {
          return NextResponse.json(
            { error: "Chatwoot baseUrl must be a resolvable public HTTPS URL" },
            { status: 400 },
          )
        }
      }

      const isTikTokChatwoot = d.channelType === "chatwoot" && isTikTokChatwootChannelConfig({
        channelType: d.channelType,
        configName: d.configName,
        settings: d.settings,
      })
      const data =
        d.channelType === "whatsapp"
          ? {
              ...d,
              apiKey:      d.accessToken       || d.apiKey,
              phoneNumber: d.phoneNumberId     || d.phoneNumber,
              webhookUrl:  d.businessAccountId || d.webhookUrl,
            }
          : isTikTokChatwoot
            ? {
                ...d,
                settings: tiktokChannelConfigSettings(d.settings),
              }
          : d

      const createChannel = (client: Pick<Prisma.TransactionClient, "channelConfig">) => client.channelConfig.create({
        data: {
          organizationId: orgId,
          ...data,
        },
      })

      let channel
      if (isTikTokChatwoot) {
        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // Serialize TikTok/Chatwoot creation per tenant. A plain find-then-create check
          // still races when the setup form is submitted twice at the same time.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`channel:tiktok:dm:chatwoot:${orgId}`}, 0))`

          const candidates = await tx.channelConfig.findMany({
            where: { organizationId: orgId, channelType: "chatwoot" },
            select: { id: true, channelType: true, configName: true, settings: true },
          })
          const duplicate = candidates.find((candidate) => isTikTokChatwootChannelConfig(candidate))
          if (duplicate) return { duplicate, channel: null }

          return { duplicate: null, channel: await createChannel(tx) }
        })

        if (result.duplicate) {
          return NextResponse.json(
            {
              error: "TikTok via Chatwoot is already connected. Edit the existing channel instead.",
              existingChannelId: result.duplicate.id,
            },
            { status: 409 },
          )
        }
        channel = result.channel
      } else {
        channel = await createChannel(prisma)
      }

      if (!channel) throw new Error("Channel creation completed without a channel")
      await syncTikTokDmConnectionForChannelConfig(channel).catch((error) => {
        console.error("[channels POST] TikTok ChannelConnection sync failed", error)
      })
      const claimedElsewhere = await channelIdsClaimedElsewhere(orgId, [channel])
      return NextResponse.json({
        success: true,
        data: { ...publicChannelConfig(channel), claimedElsewhere: claimedElsewhere.has(channel.id) },
      }, { status: 201 })
    } catch (e) {
      console.error(e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}
