import { createHmac, randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { dispatchMarketplaceConnectorEvent } from "@/lib/apps/connector-runtime"
import {
  OutboundWebhookSecurityError,
  requestOutboundWebhook,
} from "@/lib/integrations/webhook-url-guard"

export type WebhookEvent =
  | "contact.created"
  | "contact.updated"
  | "contact.deleted"
  | "deal.created"
  | "deal.updated"
  | "deal.stage_changed"
  | "deal.won"
  | "deal.lost"
  | "lead.created"
  | "lead.updated"
  | "lead.converted"
  | "ticket.created"
  | "ticket.updated"
  | "ticket.resolved"
  | "task.created"
  | "task.completed"
  | "company.created"
  | "company.updated"
  | "campaign.sent"

interface WebhookPayload {
  event: string
  timestamp: string
  organizationId: string
  data: Record<string, unknown>
}

async function isOrganizationActive(orgId: string): Promise<boolean> {
  try {
    const organization = await prisma.organization.findFirst({
      where: { id: orgId, isActive: true },
      select: { id: true },
    })
    return organization !== null
  } catch (error) {
    console.error(`[Webhooks] Organization status check failed for ${orgId}:`, error)
    return false
  }
}

async function hasValidCreatorAtDispatch(
  provenance: string,
  createdByApiKeyId: string | null,
  orgId: string,
): Promise<boolean> {
  if (provenance === "legacy_unclassified") return false
  if (provenance === "generic") return createdByApiKeyId === null
  if (provenance !== "zapier" || createdByApiKeyId === null) return false

  // A Zapier row must re-read its creator immediately before every outbound
  // attempt. This also stops retries that outlive a revoke/disable/expiry which
  // happened after fireWebhooks initially loaded the subscription.
  const now = new Date()
  try {
    const creator = await prisma.apiKey.findFirst({
      where: {
        id: createdByApiKeyId,
        organizationId: orgId,
        isActive: true,
        organization: { isActive: true },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      select: { id: true },
    })
    return creator !== null
  } catch (error) {
    console.error(`[Webhooks] Creator key check failed for ${createdByApiKeyId}:`, error)
    return false
  }
}

export interface FireWebhookOptions {
  /**
   * Wait for every marketplace and custom webhook delivery attempt.
   * Keep the legacy background behavior by default; fence-sensitive callers
   * opt in so their surrounding transaction/lock cannot finish first.
   */
  awaitDelivery?: boolean
}

export async function fireWebhooks(
  orgId: string,
  event: string,
  payload: Record<string, unknown>,
  options: FireWebhookOptions = {},
): Promise<void> {
  // Tenant deactivation is a hard outbound-side-effect boundary. Check before
  // even starting marketplace dispatch and fail closed on status-query errors.
  if (!await isOrganizationActive(orgId)) {
    console.warn(`[Webhooks] Skipping dispatch for inactive organization ${orgId}`)
    return
  }

  const connectorDelivery = dispatchMarketplaceConnectorEvent(orgId, event, payload).catch((err) => {
    console.error(`[Webhooks] Marketplace connector dispatch failed for ${event}:`, err)
  })

  const deliveries: Promise<void>[] = []
  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
      },
      select: {
        id: true,
        url: true,
        events: true,
        secret: true,
        provenance: true,
        createdByApiKeyId: true,
      },
    })

    const matching = webhooks.filter((wh) => wh.events.includes(event))
    if (matching.length > 0) {
      const webhookPayload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        organizationId: orgId,
        data: payload,
      }

      for (const webhook of matching) {
        deliveries.push(
          dispatchSingleWebhook(
            webhook.url,
            webhook.secret,
            webhookPayload,
            webhook.provenance,
            webhook.createdByApiKeyId,
          ).catch(err => {
            console.error(`Webhook delivery failed for ${webhook.id}:`, err)
          }),
        )
      }
    }
  } catch (error) {
    console.error("[Webhooks] Error loading webhooks:", error)
  }

  if (options.awaitDelivery === true) {
    await Promise.all([connectorDelivery, ...deliveries])
    return
  }
  void connectorDelivery
  for (const delivery of deliveries) void delivery
}

const MAX_RETRIES = 3
const BACKOFF_BASE_MS = 1000 // 1s, 4s, 16s

async function dispatchSingleWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
  provenance: string,
  createdByApiKeyId: string | null,
): Promise<void> {
  const body = JSON.stringify(payload)
  const signature = createHmac("sha256", secret).update(body).digest("hex")
  // A receiver can use this stable value to de-duplicate the deliberate
  // retries below. Generate it once per subscription delivery, not per HTTP
  // attempt, so the same logical delivery never receives a new identity.
  const deliveryId = randomUUID()

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (!await isOrganizationActive(payload.organizationId)) {
      console.warn(`[Webhooks] Stopping delivery for inactive organization ${payload.organizationId}`)
      return
    }
    if (!await hasValidCreatorAtDispatch(provenance, createdByApiKeyId, payload.organizationId)) {
      console.warn("[Webhooks] Skipping delivery: webhook provenance or creator API key is invalid")
      return
    }
    try {
      // Resolve every A/AAAA result, reject non-public addresses, and pin the
      // validated address into the socket. Redirects repeat the same checks.
      const response = await requestOutboundWebhook(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Event": payload.event,
          "X-Webhook-Delivery-Id": deliveryId,
          "X-Webhook-Attempt": String(attempt + 1),
        },
        body,
        timeoutMs: 10_000,
        maxRedirects: 3,
        sensitiveHeaders: ["x-webhook-signature"],
      })

      if (response.ok) return // Success

      // Don't retry 4xx client errors (except 429 Too Many Requests)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        // Callback paths and query strings sometimes contain bearer material.
        // Never copy the tenant-controlled URL into application logs.
        console.error(`[Webhooks] Endpoint responded ${response.status} — not retrying`)
        return
      }

      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_BASE_MS * Math.pow(4, attempt) // 1s, 4s, 16s
        console.warn(`[Webhooks] Endpoint responded ${response.status} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`)
        await new Promise(r => setTimeout(r, delay))
      } else {
        console.error(`[Webhooks] Endpoint failed after ${MAX_RETRIES + 1} attempts (last: ${response.status})`)
      }
    } catch (err) {
      if (err instanceof OutboundWebhookSecurityError) {
        console.error("[Webhooks] Blocked unsafe outbound URL", err)
        return
      }
      // A timeout, reset, or other transport exception may happen after the
      // receiver accepted the POST. Retrying with no acknowledgement would
      // risk duplicating an irreversible action, so fail closed. Explicit
      // non-2xx HTTP responses remain retryable above and carry deliveryId so
      // receivers can de-duplicate those deliberate at-least-once attempts.
      console.error(
        `[Webhooks] Delivery outcome is unknown — not retrying (delivery ${deliveryId}):`,
        err,
      )
      return
    }
  }
}
