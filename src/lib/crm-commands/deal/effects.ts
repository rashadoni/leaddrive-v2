import type { Deal } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { trackContactEvent } from "@/lib/contact-events"
import { sendSlackNotification, formatDealNotification } from "@/lib/slack"
import { decimalToNumber } from "@/lib/prisma-decimal"

type DealCreatedEffectEntity = Pick<
  Deal,
  "id" | "name" | "valueAmount" | "currency" | "stage" | "contactId"
>

/**
 * Preserve the canonical post-create deal effects for every command that
 * creates a deal. Provider-facing effects remain best effort until C1.12 adds
 * the durable CRM outbox.
 */
export function dispatchDealCreatedEffects(
  organizationId: string,
  deal: DealCreatedEffectEntity,
): number {
  const dealValue = decimalToNumber(deal.valueAmount)

  logAudit(organizationId, "create", "deal", deal.id, deal.name)
  executeWorkflows(organizationId, "deal", "created", deal).catch(() => {})
  createNotification({
    organizationId,
    type: "success",
    title: "Новая сделка",
    message: `Создана сделка «${deal.name}»${dealValue ? ` на ${dealValue} ${deal.currency}` : ""}`,
    entityType: "deal",
    entityId: deal.id,
  }).catch(() => {})
  fireWebhooks(organizationId, "deal.created", {
    id: deal.id,
    name: deal.name,
    valueAmount: dealValue,
    stage: deal.stage,
  }).catch(() => {})
  if (deal.contactId) {
    trackContactEvent(organizationId, deal.contactId, "deal_created", {
      dealId: deal.id,
      name: deal.name,
    }).catch(() => {})
  }
  prisma.channelConfig.findMany({
    where: { organizationId, channelType: "slack", isActive: true },
  }).then((configs) => {
    const message = formatDealNotification({
      name: deal.name,
      value: dealValue,
      stage: deal.stage,
    })
    for (const config of configs) {
      if (config.webhookUrl) sendSlackNotification(config.webhookUrl, message).catch(() => {})
    }
  }).catch(() => {})

  return dealValue
}
