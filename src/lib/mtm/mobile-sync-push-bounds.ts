export const MTM_MOBILE_SYNC_MAX_BODY_BYTES = 512 * 1024
export const MTM_MOBILE_SYNC_MAX_OPERATION_BYTES = 64 * 1024

/** Raw request bytes are limited before JSON parsing. This second limit is the
 * UTF-8 size of one canonical parsed envelope, including unknown properties.
 * Rejected envelopes are never pinned; healthy siblings retain their order.
 */
export function classifyMtmMobileSyncOperation(value: unknown) {
  const envelope = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const id = envelope.operationId
  // A corrupt identifier must not turn a fixed error into a payload echo.
  const responseId = typeof id === "string" && id.length > 0 && Buffer.byteLength(id, "utf8") <= 191 ? id : "?"
  const reject = (code: "MTM_MOBILE_SYNC_OPERATION_INVALID" | "MTM_MOBILE_SYNC_OPERATION_TOO_LARGE") => ({
    allowed: false as const,
    result: {
      operationId: responseId,
      status: "error" as const,
      error: code === "MTM_MOBILE_SYNC_OPERATION_TOO_LARGE" ? "Sync operation is too large" : "Missing or invalid required fields",
      serverData: { code },
    },
  })
  if (typeof id !== "string" || !id || typeof envelope.op !== "string" || !envelope.op
    || typeof envelope.entity !== "string" || !envelope.entity
    || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    return reject("MTM_MOBILE_SYNC_OPERATION_INVALID")
  }
  try {
    if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > MTM_MOBILE_SYNC_MAX_OPERATION_BYTES) {
      return reject("MTM_MOBILE_SYNC_OPERATION_TOO_LARGE")
    }
  } catch {
    // JSON.parse can accept a deeply nested envelope that stringify cannot
    // traverse. Contain that failure to this operation and reveal no payload.
    return reject("MTM_MOBILE_SYNC_OPERATION_INVALID")
  }
  return { allowed: true as const }
}
