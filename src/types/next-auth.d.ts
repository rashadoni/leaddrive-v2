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
      /** Inbox numbers and pages an admin hid from this user; empty for admins. */
      hiddenChannelConfigIds?: string[]
      /** Sections of Settings an admin ticked for this user (lib/settings-sections); empty for admins. */
      settingsSections?: string[]
      /** The organization's own rights for its roles (lib/role-access.ts). */
      roleAccess?: Record<string, Record<string, "full" | "edit" | "view" | "none">>
      /** The organization's unmasked modules, only for a person with ticked sections and hidden modules (lib/auth.ts). */
      sectionTenantModules?: Record<string, boolean>
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
    /** "Remember me" was ticked at sign-in: 30 days instead of 8 idle hours. */
    rememberMe?: boolean
    /** Unix seconds of the last session read (auth-session-lifetime.ts). */
    lastActiveAt?: number
  }
}
