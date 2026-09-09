/**
 * Assembler для capability inventory (CR-0).
 *
 * Собирает tenant-контекст из БД (proofs, подключённые аккаунты, скомпилированные
 * route plans, provider config источников, tenant settings, серверные env-флаги) и
 * прогоняет его через чистый `computeCapabilityInventory`. Никакие секреты наружу
 * не возвращаются — только булевы признаки конфигурации и метаданные proof.
 *
 * Вызывается внутри RLS-контекста (route через `withRlsAuth`, скрипт через
 * makeScriptPrisma/bypass), поэтому обращения к prisma автоматически ограничены
 * организацией.
 */

import { prisma } from "@/lib/prisma"
import { getSocialMonitoringSettings } from "@/lib/social/monitoring-settings"
import { summarizeMonitoringProviderSetup } from "@/lib/social/monitoring-source"
import {
  computeCapabilityInventory,
  summarizeCapabilityInventory,
  CAPABILITY_INVENTORY_VERSION,
  TIKTOK_SELECTIVE_DISCOVERY_COVERAGE,
  type CapabilityInventoryContext,
  type CapabilityInventoryRow,
  type CapabilityInventorySummary,
} from "@/lib/social/capability-inventory"

export interface CapabilityInventoryResult {
  version: string
  generatedAt: string
  organizationId: string
  organizationName: string | null
  summary: CapabilityInventorySummary
  rows: CapabilityInventoryRow[]
  selectiveDiscovery?: { tiktok: typeof TIKTOK_SELECTIVE_DISCOVERY_COVERAGE }
}

export async function buildCapabilityInventoryContext(
  organizationId: string,
  now = new Date(),
): Promise<CapabilityInventoryContext> {
  const [proofs, routePlans, accounts, sources, settings] = await Promise.all([
    prisma.socialProviderCapabilityProof.findMany({
      where: { organizationId },
      select: {
        id: true,
        platform: true,
        capability: true,
        contentScopes: true,
        status: true,
        readAllowed: true,
        replyAllowed: true,
        exportAllowed: true,
        aiProcessingAllowed: true,
        contractVersion: true,
        providerKey: true,
        adapterKey: true,
        verifiedAt: true,
        sandboxVerifiedAt: true,
        expiresAt: true,
      },
    }),
    prisma.sourceRoutePlan.findMany({
      where: { organizationId, status: { not: "INVALIDATED" } },
      select: {
        platform: true,
        capability: true,
        contentScope: true,
        primaryAdapter: true,
        acquisitionMode: true,
        status: true,
      },
    }),
    prisma.socialAccount.findMany({
      where: { organizationId, isActive: true },
      select: { platform: true, accessToken: true },
    }),
    prisma.monitoringSource.findMany({
      where: { organizationId },
      select: { settings: true },
    }),
    getSocialMonitoringSettings(organizationId),
  ])

  const connectedPlatforms: string[] = []
  for (const account of accounts) {
    if (account.accessToken && !connectedPlatforms.includes(account.platform)) {
      connectedPlatforms.push(account.platform)
    }
  }

  let providerCollectionConfigured = false
  let providerReplyConfigured = false
  for (const source of sources) {
    const setup = summarizeMonitoringProviderSetup(source.settings)
    if (setup.collectionConfigured && setup.collectionApproved) providerCollectionConfigured = true
    if (setup.replyConfigured && setup.replyApproved) providerReplyConfigured = true
  }

  const apifyExternalEnabled =
    settings.searchIndex.enabled && settings.searchIndex.provider === "apify" && settings.searchIndex.hasToken
  const genericSearchEnabled =
    settings.searchIndex.enabled &&
    settings.searchIndex.provider === "generic" &&
    Boolean(settings.searchIndex.endpoint) &&
    settings.searchIndex.allowedHosts.length > 0

  return {
    now,
    proofs,
    routePlans,
    connectedPlatforms,
    apifyExternalEnabled,
    genericSearchEnabled,
    providerCollectionConfigured,
    providerReplyConfigured,
    vkServiceTokenPresent: Boolean(process.env.VK_SERVICE_TOKEN),
    youtubeApiKeyPresent: Boolean(process.env.YOUTUBE_API_KEY),
    telegramBotTokenPresent: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    // Подключённый X-аккаунт = CONFIGURED (capability не доказана): paid tier
    // перепроверяется перед реальным вызовом и отражён в ограничении строки.
    xApiConfigured: connectedPlatforms.includes("twitter"),
    liveSendEnabled: process.env.SOCIAL_LIVE_REPLY_ENABLED === "1",
  }
}

export async function getCapabilityInventory(
  organizationId: string,
  now = new Date(),
): Promise<CapabilityInventoryResult> {
  const [ctx, organization] = await Promise.all([
    buildCapabilityInventoryContext(organizationId, now),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }).catch(() => null),
  ])
  const rows = computeCapabilityInventory(ctx)
  return {
    version: CAPABILITY_INVENTORY_VERSION,
    generatedAt: now.toISOString(),
    organizationId,
    organizationName: organization?.name ?? null,
    summary: summarizeCapabilityInventory(rows),
    rows,
    selectiveDiscovery: { tiktok: TIKTOK_SELECTIVE_DISCOVERY_COVERAGE },
  }
}
