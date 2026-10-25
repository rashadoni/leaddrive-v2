import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface User {
    role?: string
    organizationId?: string
    organizationSlug?: string
    organizationName?: string
    plan?: string
    sessionFingerprint?: string
    /** Private canonical authority; never exposed by the session callback. */
    identityCrm?: import("../lib/identity/crm-session").IdentityCrmClaims
  }

  interface Session {
    /** JWT issued-at (epoch seconds), preserved for response compatibility. */
    iat?: number
    user: {
      id?: string
      email?: string | null
      name?: string | null
      image?: string | null
      role: string
      organizationId: string
      organizationSlug: string
      organizationName: string
      plan: string
      /** Group-modules an admin hid from this user; empty for admins. */
      hiddenModules?: string[]
      /** End of an outside reviewer's grant (ISO); absent for everyone else. */
      reviewerAccessUntil?: string
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string
    organizationId?: string
    organizationSlug?: string
    organizationName?: string
    plan?: string
    /** Opaque HMAC of the current DB credential/session epoch. */
    sessionFingerprint?: string
    /** Private canonical authority; never exposed by the session callback. */
    identityCrm?: import("../lib/identity/crm-session").IdentityCrmClaims
    /** End of an outside reviewer's grant (ISO); absent for everyone else. */
    reviewerAccessUntil?: string
  }
}
