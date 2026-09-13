/** Use for Workforce responses that contain security-lifecycle or one-time proof material. */
export const workforceSensitiveResponseHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
} as const

/** Apply the same containment to success, denial and delegated responses. */
export function applyWorkforceSensitiveResponseHeaders<T extends Response>(response: T): T {
  for (const [name, value] of Object.entries(workforceSensitiveResponseHeaders)) {
    response.headers.set(name, value)
  }
  return response
}
