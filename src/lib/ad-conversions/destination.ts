/**
 * The organization's ad destinations — Meta (pixel id + access token) and
 * Google Analytics 4 (measurement id + Measurement Protocol API secret):
 * public id, secret (ciphertext bound to organization + column), what to
 * send, and the consent statement.
 * Nothing is sent while `isActive` is false; `isActive` cannot be true
 * without `consentConfirmedAt` (CHECK in the migration and the save below).
 */
import { prisma } from "@/lib/prisma"
import { decryptForTenantBound, encryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"

const AAD_TABLE = "ad_conversion_destinations"
const AAD_COLUMN = "secretCiphertext"

export interface DestinationView {
  configured: boolean
  isActive: boolean
  publicId: string
  hasSecret: boolean
  testEventCode: string
  sendLeads: boolean
  sendWins: boolean
  consentConfirmed: boolean
  lastSentAt: string | null
  failures7d: number
}

export interface DestinationInput {
  publicId: string
  secret?: string
  testEventCode?: string | null
  sendLeads: boolean
  sendWins: boolean
  isActive: boolean
  consent: boolean
}

export type AdPlatform = "meta" | "ga4"

export async function findDestination(orgId: string, platform: AdPlatform) {
  return prisma.adConversionDestination.findFirst({ where: { organizationId: orgId, platform } })
}

export const findMetaDestination = (orgId: string) => findDestination(orgId, "meta")

export function decryptDestinationSecret(orgId: string, ciphertext: string): string {
  return decryptForTenantBound(orgId, AAD_TABLE, AAD_COLUMN, ciphertext)
}

export async function destinationView(orgId: string, platform: AdPlatform): Promise<DestinationView | null> {
  const row = await findDestination(orgId, platform)
  if (!row) return null
  const since = new Date(Date.now() - 7 * 24 * 3600_000)
  const [last, failures] = await Promise.all([
    prisma.adConversionEvent.findFirst({
      where: { organizationId: orgId, destinationId: row.id, status: "sent" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.adConversionEvent.count({ where: { organizationId: orgId, destinationId: row.id, status: "failed", updatedAt: { gte: since } } }),
  ])
  return {
    configured: true,
    isActive: row.isActive,
    publicId: row.publicId,
    hasSecret: Boolean(row.secretCiphertext),
    testEventCode: row.testEventCode ?? "",
    sendLeads: row.sendLeads,
    sendWins: row.sendWins,
    consentConfirmed: Boolean(row.consentConfirmedAt),
    lastSentAt: last?.sentAt?.toISOString() ?? null,
    failures7d: failures,
  }
}

export const metaDestinationView = (orgId: string) => destinationView(orgId, "meta")

/**
 * Save the destination. The caller has checked the key with the platform
 * when it turns sending on. Turning on keeps the first activation moment, so a
 * re-save does not resend history; turning on again after "off" starts from
 * now.
 */
export async function saveDestination(orgId: string, userId: string | null, platform: AdPlatform, input: DestinationInput, now = new Date()): Promise<void> {
  const existing = await findDestination(orgId, platform)
  const secretCiphertext = input.secret
    ? encryptForTenantBound(orgId, AAD_TABLE, AAD_COLUMN, input.secret)
    : existing?.secretCiphertext
  if (!secretCiphertext) throw new Error(`${platform} secret is required`)
  const consentConfirmedAt = input.consent ? existing?.consentConfirmedAt ?? now : null
  const activatedAt = input.isActive
    ? (existing?.isActive && existing.activatedAt ? existing.activatedAt : now)
    : existing?.activatedAt ?? null
  const data = {
    publicId: input.publicId,
    secretCiphertext,
    testEventCode: input.testEventCode || null,
    sendLeads: input.sendLeads,
    sendWins: input.sendWins,
    isActive: input.isActive,
    consentConfirmedAt,
    consentConfirmedBy: input.consent ? existing?.consentConfirmedBy ?? userId : null,
    activatedAt,
  }
  if (existing) {
    await prisma.adConversionDestination.updateMany({ where: { id: existing.id, organizationId: orgId }, data })
    return
  }
  await prisma.adConversionDestination.create({ data: { ...data, organizationId: orgId, platform } })
}

export const saveMetaDestination = (orgId: string, userId: string | null, input: DestinationInput, now = new Date()) =>
  saveDestination(orgId, userId, "meta", input, now)
