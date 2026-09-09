/**
 * Runtime-upload directories served by the Next.js upload proxy.
 *
 * Keep the production persistence loop in scripts/server-deploy.sh in exact
 * parity with this list. A static regression test enforces that invariant.
 */
export const PROXIED_UPLOAD_SUBDIRS = [
  "mtm-photos",
  "contracts",
  "logos",
  "email-images",
  "web-chat",
  "mtm-invoices",
  "whatsapp",
  "telegram",
  "inbox",
  "contract-images",
  "social-logos",
  "avatars",
  "tasks",
] as const

export type ProxiedUploadSubdir = typeof PROXIED_UPLOAD_SUBDIRS[number]

export const PROXIED_UPLOAD_SUBDIR_SET = new Set<string>(PROXIED_UPLOAD_SUBDIRS)

export const PATH_ENCODED_ORG_SUBDIRS = new Set<string>([
  "mtm-invoices",
  "email-images",
  "web-chat",
  "whatsapp",
  "telegram",
  "inbox",
  "contract-images",
  "social-logos",
  "avatars",
])

const SAFE_ORGANIZATION_SEGMENT = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/
const PUBLIC_EMAIL_IMAGE_NAME = /^img-[0-9a-f]{32}\.(?:png|jpg|webp)$/
const PUBLIC_TENANT_LOGO_NAME = /^logo-[0-9a-f]{32}\.(?:png|jpg|webp)$/

export function isSafeUploadPathParts(parts: readonly string[]): boolean {
  return parts.length >= 2 && parts.every((part) => (
    Boolean(part)
    && part !== "."
    && part !== ".."
    && !part.includes("/")
    && !part.includes("\\")
    && !part.includes("\0")
  ))
}

export function isSafeOrganizationPathSegment(value: string): boolean {
  return SAFE_ORGANIZATION_SEGMENT.test(value)
}

/**
 * Files in these exact shapes may be fetched without a browser session:
 *
 *   email-images/<orgId>/img-<128-bit-random>.<safe raster extension>
 *   logos/logo-<128-bit-random>.<safe raster extension>
 *
 * The new 32-hex namespace deliberately excludes all pre-hardening uploads,
 * whose raw bytes and shorter names have not yet been inventoried/re-encoded.
 */
export function isCanonicalPublicUploadPath(parts: readonly string[]): boolean {
  if (!isSafeUploadPathParts(parts)) return false

  if (parts[0] === "email-images") {
    return parts.length === 3
      && isSafeOrganizationPathSegment(parts[1])
      && PUBLIC_EMAIL_IMAGE_NAME.test(parts[2])
  }

  if (parts[0] === "logos") {
    return parts.length === 2 && PUBLIC_TENANT_LOGO_NAME.test(parts[1])
  }

  return false
}
