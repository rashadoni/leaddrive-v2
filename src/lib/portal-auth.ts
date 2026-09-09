import { cookies, headers } from "next/headers"
import { SignJWT, jwtVerify } from "jose"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import {
  createSessionFingerprint,
  hasCurrentSessionFingerprint,
} from "@/lib/session-invalidation"

export interface PortalUser {
  contactId: string
  organizationId: string
  companyId: string | null
  fullName: string
  email: string
}

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET environment variable is required")
}
const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET)

export async function createPortalToken(user: PortalUser, portalPasswordHash: string): Promise<string> {
  const portalSessionFingerprint = createSessionFingerprint({
    principalId: user.contactId,
    passwordHash: portalPasswordHash,
    secret: process.env.NEXTAUTH_SECRET!,
  })
  return new SignJWT({ ...user, portalSessionFingerprint })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(SECRET)
}

export async function getPortalUser(): Promise<PortalUser | null> {
  // Native clients (the loyalty mobile app) send the JWT as a Bearer header —
  // they have no cookie jar. The web sends the httpOnly `portal-token` cookie.
  // Prefer the header, fall back to the cookie; the rest of the verify is shared.
  let token: string | undefined
  const authz = (await headers()).get("authorization")
  if (authz?.startsWith("Bearer ")) {
    token = authz.slice(7).trim() || undefined
  }
  if (!token) {
    const cookieStore = await cookies()
    token = cookieStore.get("portal-token")?.value
  }
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, SECRET)
    const contactId = payload.contactId
    const organizationId = payload.organizationId
    if (
      typeof contactId !== "string" || !contactId ||
      typeof organizationId !== "string" || !organizationId
    ) return null

    // Portal JWTs last seven days, but tenant suspension and portal-access
    // revocation must take effect immediately. Resolve the signed identifiers
    // against fresh tenant-scoped state on every request and return current
    // profile data rather than trusting mutable claims from issuance time.
    const contact = await runWithTenant(organizationId, () =>
      prisma.contact.findFirst({
        where: {
          id: contactId,
          organizationId,
          isActive: true,
          portalAccessEnabled: true,
          organization: { isActive: true },
        },
        select: {
          id: true,
          organizationId: true,
          companyId: true,
          fullName: true,
          email: true,
          portalPasswordHash: true,
        },
      })
    )
    if (!contact?.email || !contact.portalPasswordHash) return null

    const currentFingerprint = createSessionFingerprint({
      principalId: contact.id,
      passwordHash: contact.portalPasswordHash,
      secret: process.env.NEXTAUTH_SECRET!,
    })
    if (!hasCurrentSessionFingerprint(payload.portalSessionFingerprint, currentFingerprint)) {
      return null
    }

    return {
      contactId: contact.id,
      organizationId: contact.organizationId,
      companyId: contact.companyId,
      fullName: contact.fullName,
      email: contact.email,
    }
  } catch {
    return null
  }
}
