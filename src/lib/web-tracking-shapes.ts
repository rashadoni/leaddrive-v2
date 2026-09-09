/**
 * Web-tracking wire-format shapes shared between server code and CLIENT
 * components (public-form-widget). Deliberately dependency-free — no node
 * crypto, no prisma — so it is safe in a browser bundle. Server-side helpers
 * live in web-tracking.ts (which re-exports these for convenience).
 *
 * public/ldtrack.js (plain ES5, no bundler) cannot import this module — its
 * copies of these literals are annotated to point back here.
 */

/** Snippet cookie ids: 8-64 chars of the alphabet the snippet generates. */
export const VISITOR_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

export function isValidVisitorId(id: unknown): id is string {
  return typeof id === "string" && VISITOR_ID_RE.test(id)
}

/**
 * URL param the snippet's cross-domain linker appends to hosted-form links
 * (same name as the first-party cookie).
 */
export const VISITOR_ID_PARAM = "_ldv"

/** The identity-token URL param the snippet looks for after an email/ad/SMS click. */
export const IDENTITY_TOKEN_PARAM = "_ldi"
