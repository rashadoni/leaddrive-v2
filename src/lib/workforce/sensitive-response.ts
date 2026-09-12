/** Use for Workforce responses that contain security-lifecycle or one-time proof material. */
export const workforceSensitiveResponseHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
} as const
