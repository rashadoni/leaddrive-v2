import { Prisma, type PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { decryptSecret } from "@/lib/credentials/vault"
import type { ResolvedCredential } from "@/lib/credentials/types"
import { callExternalService } from "@/lib/external-services/client"
import { assertSafeOutboundUrl } from "@/lib/integrations/webhook-url-guard"
import { parseManifest } from "./manifest-parser"
import type { AppManifest, ManifestWebhookSubscription } from "./types"

type ConnectorDb = PrismaClient | Prisma.TransactionClient

interface DispatchOptions {
  db?: ConnectorDb
  fetcher?: typeof fetch
}

type ConnectorInstallation = Awaited<ReturnType<typeof loadConnectorInstallations>>[number]

export async function dispatchMarketplaceConnectorEvent(
  organizationId: string,
  eventName: string,
  payload: Record<string, unknown>,
  options: DispatchOptions = {},
): Promise<void> {
  const db = options.db ?? prisma
  const eventNames = eventAliases(eventName)

  let installations: ConnectorInstallation[]
  try {
    installations = await loadConnectorInstallations(db, organizationId)
  } catch (error) {
    console.error("[marketplace-connectors] could not load installations:", error)
    return
  }

  const deliveries: Promise<void>[] = []
  for (const installation of installations) {
    const config = asRecord(installation.config) ?? {}
    if (!isSetupComplete(config)) continue

    const manifestResult = parseManifest(installation.app.manifest)
    if (!manifestResult.ok) {
      console.error(
        `[marketplace-connectors] invalid manifest for ${installation.app.slug}:`,
        manifestResult.errors,
      )
      continue
    }

    const webhooks = matchingWebhooks(manifestResult.manifest, eventNames)
    for (const webhook of webhooks) {
      deliveries.push(deliverConnectorWebhook({
        db,
        organizationId,
        appSlug: installation.app.slug,
        eventName,
        payload,
        config,
        webhook,
        fetcher: options.fetcher,
      }).catch((error) => {
        console.error(
          `[marketplace-connectors] delivery failed app=${installation.app.slug} event=${eventName}:`,
          error,
        )
      }))
    }
  }
  await Promise.all(deliveries)
}

function loadConnectorInstallations(db: ConnectorDb, organizationId: string) {
  return db.appInstallation.findMany({
    where: {
      organizationId,
      status: "active",
      uninstalledAt: null,
      app: {
        isFirstParty: true,
        isPublic: true,
      },
    },
    select: {
      id: true,
      config: true,
      app: {
        select: {
          slug: true,
          manifest: true,
        },
      },
    },
  })
}

function eventAliases(eventName: string): Set<string> {
  return new Set([
    eventName,
    eventName.replace(/\./g, "_"),
    eventName.replace(/_/g, "."),
  ])
}

function matchingWebhooks(manifest: AppManifest, eventNames: Set<string>): ManifestWebhookSubscription[] {
  return (manifest.capabilities.webhookSubscriptions ?? []).filter((webhook) => (
    webhook.eventNames.some((name) => eventNames.has(name))
  ))
}

async function deliverConnectorWebhook(input: {
  db: ConnectorDb
  organizationId: string
  appSlug: string
  eventName: string
  payload: Record<string, unknown>
  config: Record<string, unknown>
  webhook: ManifestWebhookSubscription
  fetcher?: typeof fetch
}) {
  switch (input.appSlug) {
    case "slack-deal-notifier":
      await deliverSlackDealNotifier(input)
      return
    default:
      await deliverStaticFirstPartyWebhook(input)
  }
}

async function deliverSlackDealNotifier(input: {
  db: ConnectorDb
  organizationId: string
  eventName: string
  payload: Record<string, unknown>
  config: Record<string, unknown>
  webhook: ManifestWebhookSubscription
  fetcher?: typeof fetch
}) {
  const credentialName = input.webhook.credentialRef ?? "slack_bot"
  const credential = await resolveNamedCredential(input.db, input.organizationId, credentialName)
  if (!credential) return

  const channel = stringSetting(input.config.channel, "#sales-wins")
  await callExternalService({
    credential,
    method: "POST",
    path: "/chat.postMessage",
    jsonBody: {
      channel,
      ...formatSlackDealMessage(input.payload),
    },
    timeoutMs: 10_000,
    fetcher: input.fetcher,
  })
}

async function deliverStaticFirstPartyWebhook(input: {
  organizationId: string
  eventName: string
  payload: Record<string, unknown>
  webhook: ManifestWebhookSubscription
  fetcher?: typeof fetch
}) {
  const targetUrl = input.webhook.targetUrl
  let parsed: URL
  try {
    assertSafeOutboundUrl(targetUrl)
    parsed = new URL(targetUrl)
  } catch (error) {
    console.error("[marketplace-connectors] blocked unsafe static webhook:", error)
    return
  }
  if (parsed.hostname.toLowerCase() !== "integrations.leaddrivecrm.org") {
    console.error(`[marketplace-connectors] blocked non-first-party webhook host: ${parsed.hostname}`)
    return
  }

  const fetcher = input.fetcher ?? fetch
  await fetcher(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: input.eventName,
      organizationId: input.organizationId,
      data: input.payload,
      timestamp: new Date().toISOString(),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  })
}

async function resolveNamedCredential(
  db: ConnectorDb,
  organizationId: string,
  name: string,
): Promise<ResolvedCredential | null> {
  const row = await db.namedCredential.findFirst({
    where: { organizationId, name, isActive: true },
    select: {
      id: true,
      organizationId: true,
      name: true,
      baseUrl: true,
      authType: true,
      authConfig: true,
      secretCiphertext: true,
      secretIv: true,
      secretTag: true,
      secretAlg: true,
    },
  })
  if (!row) return null

  let secret: string | null = null
  if (row.authType !== "none") {
    if (!row.secretCiphertext || !row.secretIv || !row.secretTag || !row.secretAlg) {
      console.error(`[marketplace-connectors] named credential ${name} is missing encrypted secret fields`)
      return null
    }
    secret = decryptSecret({
      organizationId,
      name: row.name,
      encrypted: {
        ciphertext: row.secretCiphertext,
        iv: row.secretIv,
        tag: row.secretTag,
        alg: row.secretAlg as "aes-256-gcm-v1",
      },
    })
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    baseUrl: row.baseUrl,
    authType: row.authType as ResolvedCredential["authType"],
    authConfig: (row.authConfig ?? {}) as Record<string, unknown>,
    secret,
  }
}

function isSetupComplete(config: Record<string, unknown>): boolean {
  const provisioning = asRecord(config.__marketplaceProvisioning)
  return provisioning?.setupComplete === true
}

function formatSlackDealMessage(payload: Record<string, unknown>) {
  const name = stringSetting(payload.name ?? payload.dealName ?? payload.id, "Deal won")
  const value = payload.valueAmount ?? payload.value ?? payload.amount
  const stage = stringSetting(payload.stage ?? payload.status, "")
  const owner = stringSetting(payload.owner ?? payload.ownerName ?? payload.assignedTo, "")
  const lines = [
    `*Won deal:* ${name}`,
    value !== undefined && value !== null && value !== "" ? `*Value:* ${String(value)}` : null,
    stage ? `*Stage:* ${stage}` : null,
    owner ? `*Owner:* ${owner}` : null,
  ].filter((line): line is string => Boolean(line))

  return {
    text: `Won deal: ${name}`,
    blocks: [{
      type: "section",
      text: {
        type: "mrkdwn",
        text: lines.join("\n"),
      },
    }],
  }
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
