/**
 * The organization's Kapital Bank merchant account — one PaymentProvider row
 * of type "kapitalbank" per organization.
 *
 *   credentials = { login, passwordCiphertext }
 *
 * The login is the terminal name the bank issues (e.g. "TerminalSys/…") and
 * is shown back in the settings. The password exists in the database only as
 * ciphertext bound to (organization, payment_providers, credentials.password):
 * a copied row decrypts for no other organization and no other column. It is
 * never returned to the browser — the settings read back `hasPassword`.
 *
 * Switching between the test and the live host updates the same row: the
 * (organizationId, type, isTestMode) unique index would otherwise allow two,
 * and the invoice page would have to guess which one pays.
 */
import { prisma } from "@/lib/prisma"
import { decryptForTenantBound, encryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import type { KapitalCredentials } from "./client"

const AAD_TABLE = "payment_providers"
const AAD_COLUMN = "credentials.password"

export interface KapitalProviderConfig extends KapitalCredentials {
  providerId: string
  isActive: boolean
}

export interface KapitalSettingsView {
  configured: boolean
  isActive: boolean
  isTestMode: boolean
  login: string
  hasPassword: boolean
}

function readCredentials(value: unknown): { login: string; passwordCiphertext: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.login !== "string" || typeof record.passwordCiphertext !== "string") return null
  if (!record.login || !record.passwordCiphertext) return null
  return { login: record.login, passwordCiphertext: record.passwordCiphertext }
}

async function findRow(orgId: string) {
  return prisma.paymentProvider.findFirst({
    where: { organizationId: orgId, type: "kapitalbank" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, isActive: true, isTestMode: true, credentials: true },
  })
}

/** The decrypted account, or null when none is saved. Runs under the org's RLS scope. */
export async function loadKapitalConfig(orgId: string): Promise<KapitalProviderConfig | null> {
  const row = await findRow(orgId)
  const credentials = readCredentials(row?.credentials)
  if (!row || !credentials) return null
  return {
    providerId: row.id,
    isActive: row.isActive,
    isTestMode: row.isTestMode,
    login: credentials.login,
    password: decryptForTenantBound(orgId, AAD_TABLE, AAD_COLUMN, credentials.passwordCiphertext),
  }
}

export async function readKapitalSettings(orgId: string): Promise<KapitalSettingsView> {
  const row = await findRow(orgId)
  const credentials = readCredentials(row?.credentials)
  return {
    configured: Boolean(row && credentials),
    isActive: row?.isActive ?? false,
    isTestMode: row?.isTestMode ?? true,
    login: credentials?.login ?? "",
    hasPassword: Boolean(credentials),
  }
}

/**
 * Save the account. `password` undefined keeps the stored one (the settings
 * form never receives it back); the caller has already checked the pair
 * against the bank.
 */
export async function saveKapitalConfig(
  orgId: string,
  input: { login: string; password?: string; isTestMode: boolean; isActive: boolean; userId: string | null },
): Promise<void> {
  const row = await findRow(orgId)
  const previous = readCredentials(row?.credentials)
  const passwordCiphertext = input.password
    ? encryptForTenantBound(orgId, AAD_TABLE, AAD_COLUMN, input.password)
    : previous?.passwordCiphertext
  if (!passwordCiphertext) throw new Error("Kapital Bank password is required")
  const credentials = { login: input.login, passwordCiphertext }

  if (row) {
    await prisma.paymentProvider.updateMany({
      where: { id: row.id, organizationId: orgId },
      data: { credentials, isTestMode: input.isTestMode, isActive: input.isActive },
    })
    return
  }
  await prisma.paymentProvider.create({
    data: {
      organizationId: orgId,
      type: "kapitalbank",
      name: "Kapital Bank",
      credentials,
      isTestMode: input.isTestMode,
      isActive: input.isActive,
      createdBy: input.userId,
    },
  })
}
