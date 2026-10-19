import type { Prisma } from "@prisma/client"
import { messagingMessageKey } from "./identity"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { decryptToken, encryptToken } from "@/lib/secure-token"
import { lockTurns } from "@/lib/lock-turns"
import { messagingConfig, record, requiredMessagingScopes, TIKTOK_MESSAGING_CHANNEL, TIKTOK_MESSAGING_PROVIDER, TIKTOK_MESSAGING_PURPOSE } from "./config"
import { refreshMessagingToken, verifyMessagingGrant, verifyMessagingAccountAccess, sendMessagingText, revokeMessagingToken, subscribeMessagingWebhook, TikTokMessagingError, type MessagingTokens } from "./api"
import { TIKTOK_MESSAGING_WEBHOOK_PATH } from "./config"

const turns = lockTurns("tiktok-messaging-tokens", 1)
const noCapabilities = { read: false, reply: false, webhook: false, importLead: false }
export const messagingIdentity = (organizationId: string) => ({ organizationId, platform: "tiktok", surface: "dm", provider: TIKTOK_MESSAGING_PROVIDER })
const tokenPurpose = (orgId: string) => `${TIKTOK_MESSAGING_PURPOSE}:${orgId}`

export async function beginMessagingAuthorization(organizationId: string, fingerprint: string): Promise<void> {
  await turns.run(organizationId, () => runWithTenant(organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-messaging-connection:${organizationId}`}, 0))`
    await tx.channelConnection.upsert({
    where: { organizationId_platform_surface_provider: messagingIdentity(organizationId) },
    create: { ...messagingIdentity(organizationId), displayName: "TikTok Business Messaging", status: "needs_access", capabilities: noCapabilities, secretRef: fingerprint },
    update: { secretRef: fingerprint },
    })
  })))
}

/** Local disconnect always clears both tokens. Provider only guarantees access-token revocation. */
export async function disconnectMessaging(organizationId: string): Promise<boolean> {
  return turns.run(organizationId, () => runWithTenant(organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-messaging-connection:${organizationId}`}, 0))`
    const connection = await tx.channelConnection.findUnique({ where: { organizationId_platform_surface_provider: messagingIdentity(organizationId) } })
    if (!connection) return false
    let revoked = false
    if (connection.accessToken) {
      try { await revokeMessagingToken(decryptToken(connection.accessToken, tokenPurpose(organizationId))); revoked = true } catch { /* Local disconnect must remain available. */ }
    }
    await tx.channelConnection.updateMany({ where: { id: connection.id, organizationId }, data: {
      status: "disabled", accessToken: null, refreshToken: null, secretRef: null, tokenExpiresAt: null,
      capabilities: noCapabilities, settings: { ...record(connection.settings), webhookSubscribed: false },
    } })
    if (connection.channelConfigId) await tx.channelConfig.updateMany({ where: { id: connection.channelConfigId, organizationId }, data: { isActive: false } })
    return revoked
  }, { timeout: 25_000 })))
}

export async function retryMessagingSubscription(organizationId: string): Promise<void> {
  await turns.run(organizationId, () => runWithTenant(organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-messaging-connection:${organizationId}`}, 0))`
    const connection = await tx.channelConnection.findUnique({ where: { organizationId_platform_surface_provider: messagingIdentity(organizationId) } })
    if (connection?.status !== "connected") throw new TikTokMessagingError("tiktok_not_connected")
    await subscribeMessagingWebhook(new URL(TIKTOK_MESSAGING_WEBHOOK_PATH, messagingConfig().redirectUri).toString())
    await tx.channelConnection.updateMany({ where: { id: connection.id, organizationId }, data: {
      settings: { ...record(connection.settings), webhookSubscribed: true },
      capabilities: { ...record(connection.capabilities), webhook: true }, lastError: null,
    } })
  }, { timeout: 25_000 })))
}

export async function consumeMessagingAuthorization(organizationId: string, fingerprint: string): Promise<boolean> {
  const consumed = await runWithTenant(organizationId, () => prisma.channelConnection.updateMany({
    where: { ...messagingIdentity(organizationId), secretRef: fingerprint }, data: { secretRef: `consumed:${fingerprint}` },
  }))
  return consumed.count === 1
}

export async function saveMessagingConnection(organizationId: string, userId: string, token: MessagingTokens, scopes: string[], webhookSubscribed: boolean, fingerprint: string): Promise<string> {
  const { clientId } = messagingConfig()
  if (!requiredMessagingScopes(scopes)) throw new TikTokMessagingError("tiktok_required_scopes_missing")
  // One account cannot silently feed multiple tenants. Cross-tenant scope is
  // used ONLY for this ownership check, never for conversation/message writes.
  return turns.run(`bind:${clientId}:${token.openId}`, () => runWithRlsBypass(() => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-messaging-account:${clientId}:${token.openId}`}, 0))`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-messaging-connection:${organizationId}`}, 0))`
    const claimed = await tx.channelConnection.findFirst({ where: {
      platform: "tiktok", surface: "dm", provider: TIKTOK_MESSAGING_PROVIDER,
      AND: [{ settings: { path: ["appId"], equals: clientId } }, { settings: { path: ["openId"], equals: token.openId } }],
      organizationId: { not: organizationId },
    }, select: { id: true } })
    if (claimed) throw new TikTokMessagingError("tiktok_account_already_connected")
    const current = await tx.channelConnection.findUnique({ where: { organizationId_platform_surface_provider: messagingIdentity(organizationId) } })
    if (current?.secretRef !== `consumed:${fingerprint}`) throw new TikTokMessagingError("tiktok_authorization_superseded")
    const previous = record(current?.settings)
    // Preserve old conversations' identity. Switching accounts must use a new
    // workspace until multi-account connections have an explicit data model.
    if (previous.openId && (previous.openId !== token.openId || previous.appId !== clientId)) {
      throw new TikTokMessagingError("tiktok_different_account_requires_new_workspace")
    }
    let channelConfigId = current?.channelConfigId
    if (!channelConfigId) {
      const channel = await tx.channelConfig.create({ data: {
        organizationId, channelType: TIKTOK_MESSAGING_CHANNEL, configName: "TikTok Business Messaging",
        createdBy: userId, appId: clientId, businessAccountId: token.openId, isActive: true,
        settings: { platform: "tiktok", surface: "dm", routingProvider: TIKTOK_MESSAGING_PROVIDER },
      } })
      channelConfigId = channel.id
    } else {
      await tx.channelConfig.updateMany({ where: { id: channelConfigId, organizationId, channelType: TIKTOK_MESSAGING_CHANNEL }, data: { isActive: true } })
    }
    const data = {
      channelConfigId, status: "connected", secretRef: null,
      capabilities: { read: true, reply: true, webhook: webhookSubscribed, importLead: false },
      settings: { appId: clientId, openId: token.openId, scopes, grantVerified: true, webhookSubscribed, refreshExpiresAt: new Date(Date.now() + token.refreshExpiresIn * 1000).toISOString() },
      accessToken: encryptToken(token.accessToken, tokenPurpose(organizationId)),
      refreshToken: encryptToken(token.refreshToken, tokenPurpose(organizationId)),
      tokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
      lastHealthCheckAt: new Date(), lastError: webhookSubscribed ? null : "tiktok_webhook_subscription_failed",
    }
    const connection = await tx.channelConnection.upsert({
      where: { organizationId_platform_surface_provider: messagingIdentity(organizationId) },
      create: { ...messagingIdentity(organizationId), displayName: "TikTok Business Messaging", ...data }, update: data,
    })
    return connection.channelConfigId!
  }, { timeout: 10_000 })))
}

/** Refresh serialized across workers. Commit rotations even if subsequent validation is unavailable. */
type AccountAccess = { accessToken: string; openId: string; channelConfigId: string }
async function withMessagingAccount<T>(organizationId: string, connectionId: string, action: (access: AccountAccess, tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const result = await turns.run(`refresh:${connectionId}`, () => runWithTenant(organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-messaging-connection:${organizationId}`}, 0))`
    const connection = await tx.channelConnection.findFirst({ where: { id: connectionId, ...messagingIdentity(organizationId), status: "connected" } })
    let settings = record(connection?.settings)
    if (!connection?.accessToken || !connection.refreshToken || !connection.channelConfigId
      || settings.appId !== messagingConfig().clientId || typeof settings.openId !== "string"
      || record(connection.capabilities).reply !== true) throw new TikTokMessagingError("tiktok_not_connected")
    const openId = settings.openId
    const active = await tx.channelConfig.findFirst({ where: { id: connection.channelConfigId, organizationId, channelType: TIKTOK_MESSAGING_CHANNEL, isActive: true }, select: { id: true } })
    if (!active) throw new TikTokMessagingError("tiktok_not_connected")
    let accessToken = decryptToken(connection.accessToken, tokenPurpose(organizationId))
    if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() <= Date.now() + 60_000) {
      if (typeof settings.refreshExpiresAt !== "string" || !(Date.parse(settings.refreshExpiresAt) > Date.now())) {
        throw new TikTokMessagingError("tiktok_reconnect_required")
      }
      const refreshed = await refreshMessagingToken(decryptToken(connection.refreshToken, tokenPurpose(organizationId)))
      if (refreshed.openId !== openId) throw new TikTokMessagingError("tiktok_account_binding_mismatch")
      settings = { ...settings, grantVerified: false, refreshExpiresAt: new Date(Date.now() + refreshed.refreshExpiresIn * 1000).toISOString() }
      await tx.channelConnection.updateMany({ where: { id: connectionId, organizationId }, data: {
        accessToken: encryptToken(refreshed.accessToken, tokenPurpose(organizationId)), refreshToken: encryptToken(refreshed.refreshToken, tokenPurpose(organizationId)),
        tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000), settings: settings as Prisma.InputJsonObject,
      } })
      accessToken = refreshed.accessToken
    }
    if (settings.grantVerified !== true) {
      try {
        const scopes = await verifyMessagingGrant(accessToken, openId)
        if (!requiredMessagingScopes(scopes)) throw new TikTokMessagingError("tiktok_required_scopes_missing")
        await verifyMessagingAccountAccess(accessToken, openId)
        await tx.channelConnection.updateMany({ where: { id: connectionId, organizationId }, data: {
          settings: { ...settings, scopes, grantVerified: true }, lastHealthCheckAt: new Date(), lastError: null,
        } })
      } catch (error) {
        const reason = error instanceof TikTokMessagingError ? error.reason : "tiktok_grant_verification_failed"
        await tx.channelConnection.updateMany({ where: { id: connectionId, organizationId }, data: { lastError: reason } })
        // Return, rather than throw inside the transaction, so rotated tokens survive.
        return { error: new TikTokMessagingError(reason) }
      }
    }
    try {
      return { value: await action({ accessToken, openId, channelConfigId: connection.channelConfigId }, tx) }
    } catch (error) {
      // A send/verification failure must not roll back already-rotated tokens.
      return { error: error instanceof TikTokMessagingError ? error : new TikTokMessagingError("tiktok_request_failed", true) }
    }
  }, { maxWait: 5_000, timeout: 85_000 })))
  if ("error" in result) throw result.error
  return result.value
}

export async function messagingAccess(organizationId: string, connectionId: string): Promise<AccountAccess> {
  return withMessagingAccount(organizationId, connectionId, async access => access)
}

/** Disconnect takes the same lock: a cached token cannot send after disconnect completes. */
export async function dispatchMessagingText(organizationId: string, connectionId: string, businessId: string, channelConfigId: string, recipient: string, body: string, attemptId: string): Promise<string> {
  return withMessagingAccount(organizationId, connectionId, async (access, tx) => {
    if (access.openId !== businessId || access.channelConfigId !== channelConfigId) throw new TikTokMessagingError("tiktok_account_binding_mismatch")
    // The attempt may have been reconciled while this call waited for its turn.
    // Recheck under the SAME lock as reconciliation/disconnect immediately before dispatch.
    const attempt = await tx.channelMessage.findFirst({ where: { id: attemptId, organizationId, channelConfigId, direction: "outbound", channelType: "tiktok", status: "pending" } })
    const metadata = record(attempt?.metadata)
    if (!attempt?.conversationId || metadata.provider !== TIKTOK_MESSAGING_PROVIDER
      || metadata.connectionId !== connectionId || metadata.businessId !== businessId || metadata.providerConversationId !== recipient
      || attempt.body !== body) throw new TikTokMessagingError("tiktok_attempt_no_longer_pending")
    const providerMessageId = await sendMessagingText(access.accessToken, access.openId, recipient, body)
    const saved = await tx.channelMessage.updateMany({ where: { id: attemptId, organizationId, status: "pending" }, data: {
      status: "sent", externalId: messagingMessageKey(businessId, providerMessageId), metadata: { ...metadata, providerMessageId, deliveryUnknown: false },
    } })
    if (saved.count !== 1) throw new TikTokMessagingError("tiktok_send_result_unknown", true)
    const at = new Date()
    await tx.socialConversation.updateMany({ where: { id: attempt.conversationId, organizationId, lastMessageAt: { lte: at } }, data: { lastMessage: body, lastMessageAt: at } })
    return providerMessageId
  })
}
