import type { Prisma } from "@prisma/client"

type Reader = Pick<Prisma.TransactionClient, "account">
const IDENTITY_SCOPES = new Set(["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"])

/** Only positive evidence of sign-in-only consent excludes an SSO account.
 * Unknown scopes and explicit calendar connections still fail closed. */
export function isIdentityOnlyGoogleScope(scope: string | null): boolean {
  const scopes = scope?.trim().split(/\s+/).filter(Boolean) ?? []
  return scopes.length > 0 && scopes.every((item) => IDENTITY_SCOPES.has(item))
}

export async function calendarAccounts(client: Reader, userIds: string[]) {
  const rows = await client.account.findMany({
    where: { userId: { in: userIds }, provider: { in: ["google-calendar", "google"] } },
    select: { id: true, userId: true, provider: true, scope: true },
    orderBy: [{ provider: "desc" }, { id: "asc" }],
  })
  const selected = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (row.provider === "google" && isIdentityOnlyGoogleScope(row.scope)) continue
    if (!selected.has(row.userId)) selected.set(row.userId, row)
  }
  return selected
}

export async function calendarAccount(client: Reader, userId: string) {
  return (await calendarAccounts(client, [userId])).get(userId) ?? null
}
