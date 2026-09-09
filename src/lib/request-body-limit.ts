export type LimitedBodyFailureReason = "invalid" | "too_large"

export type LimitedBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: LimitedBodyFailureReason }

type BodyRequest = {
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

async function readBytesWithinLimit(
  request: BodyRequest,
  maxBytes: number,
): Promise<LimitedBodyResult<Uint8Array>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer")
  }

  const declaredLength = request.headers.get("content-length")
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return { ok: false, reason: "invalid" }
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length)) return { ok: false, reason: "invalid" }
    if (length > maxBytes) return { ok: false, reason: "too_large" }
  }

  if (!request.body) return { ok: true, value: new Uint8Array() }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel("request body too large").catch(() => undefined)
        return { ok: false, reason: "too_large" }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, reason: "invalid" }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, value: bytes }
}

export async function readJsonRequestWithinLimit(
  request: BodyRequest,
  maxBytes: number,
): Promise<LimitedBodyResult<unknown>> {
  const body = await readBytesWithinLimit(request, maxBytes)
  if (!body.ok) return body
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body.value)
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, reason: "invalid" }
  }
}

export async function readFormDataRequestWithinLimit(
  request: BodyRequest,
  maxBytes: number,
): Promise<LimitedBodyResult<FormData>> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/\bboundary=/i.test(contentType)) {
    return { ok: false, reason: "invalid" }
  }

  const body = await readBytesWithinLimit(request, maxBytes)
  if (!body.ok) return body

  // Copy into an ordinary ArrayBuffer so TypeScript/undici do not retain a
  // potentially larger pooled backing buffer while parsing the multipart body.
  const exact = new Uint8Array(body.value.byteLength)
  exact.set(body.value)
  try {
    const parsedRequest = new Request("http://localhost/internal-form-parse", {
      method: "POST",
      headers: { "content-type": contentType },
      body: exact.buffer,
    })
    return { ok: true, value: await parsedRequest.formData() }
  } catch {
    return { ok: false, reason: "invalid" }
  }
}
