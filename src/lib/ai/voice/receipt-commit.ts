/**
 * The browser side of an explicit receipt confirmation (roadmap U1.8/U1.9).
 *
 * This is the ONLY code in the client that can cause a CRM mutation, and it is
 * reachable from exactly one place: the onClick of a receipt button whose label
 * names the operation. It is deliberately not a tool, not exported to the
 * realtime contract, and takes no free-form input — only the intent id,
 * revision and payload hash of the receipt the user is looking at.
 *
 * Two server calls, in this order, because the second refuses to run without
 * the first:
 *
 *   POST .../actions/:id/confirmation  -> a one-time proof, valid 60 s
 *   POST .../actions/:id/commit        -> consumes that exact proof
 *
 * Splitting them is what makes "a button was pressed" a fact the server can
 * check rather than a claim the client makes. The proof is bound to the
 * revision and payload hash that were on screen, so a draft edited between
 * render and click cannot be committed by the stale view.
 *
 * `revision`/`payloadHash` are passed through untouched from the rendered
 * receipt. Recomputing or defaulting them here would defeat the whole check.
 */

export type VoiceCommitOutcome =
  /** The CRM record exists. `replayed` means this click found an earlier success. */
  | Readonly<{
    kind: "succeeded"
    entityType: "task" | "lead" | "deal"
    entityId: string
    replayed: boolean
  }>
  /** The action is finished and will not succeed. Editing or a new draft is the way out. */
  | Readonly<{ kind: "failed"; code: string; message: string }>
  /** The draft is gone or no longer matches; the user must start again. */
  | Readonly<{ kind: "stale"; code: string }>
  /** Permission or pilot gate said no. */
  | Readonly<{ kind: "forbidden"; code: string }>
  /** Voice writes are switched off. Not the user's rights — the feature's. */
  | Readonly<{ kind: "disabled" }>
  /** Too many commits; the same button will work again shortly. */
  | Readonly<{ kind: "rate_limited"; retryAfterSeconds: number }>
  /** Nothing was decided — infrastructure or network. Retrying is safe. */
  | Readonly<{ kind: "retriable"; code: string }>

const STALE_CODES = new Set([
  "INTENT_NOT_FOUND",
  "INTENT_REVISION_MISMATCH",
  "INTENT_PAYLOAD_MISMATCH",
  "INTENT_EXPIRED",
  "INTENT_NOT_CONFIRMABLE",
  "INTENT_STALE",
  "TARGET_VERSION_MISMATCH",
  "TARGET_NOT_VISIBLE",
  "CONFIRMATION_NOT_FOUND",
  "CONFIRMATION_EXPIRED",
  "CONFIRMATION_ALREADY_USED",
  "EXECUTION_LEASE_ACTIVE",
  "INVALID_CONFIRMATION_REQUEST",
  "INVALID_COMMIT_REQUEST",
])

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorCode(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.code === "string" && body.code) return body.code
  return fallback
}

function reasonCode(body: unknown): string | null {
  return isRecord(body) && typeof body.reason === "string" ? body.reason : null
}

function errorMessage(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.error === "string" && body.error) return body.error
  return fallback
}

async function postJson(
  url: string,
  body: JsonRecord,
  signal?: AbortSignal,
): Promise<Readonly<{ status: number; body: unknown; retryAfterSeconds: number }>> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    // The server rejects anything that is not an interactive same-origin JSON
    // request, and refuses outright if an Authorization header is present.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  const parsed = (await response.json().catch(() => null)) as unknown
  const retryAfter = Number(response.headers?.get?.("Retry-After") ?? "")
  return {
    status: response.status,
    body: parsed,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
  }
}

/**
 * Map one failed response onto an outcome the receipt can explain.
 *
 * The distinction that matters to the user is not the status code but what to
 * do next: try again (`retriable`), start over (`stale`), ask for access
 * (`forbidden`), wait (`rate_limited`), or give up on this draft (`failed`).
 * A 5xx is never reported as a failed action: the commit may still have run,
 * and the server replays the stored result on retry.
 */
function failureOutcome(
  status: number,
  body: unknown,
  retryAfterSeconds: number,
): VoiceCommitOutcome {
  if (status === 429) return { kind: "rate_limited", retryAfterSeconds }
  if (status >= 500) return { kind: "retriable", code: errorCode(body, "SERVER_ERROR") }

  const code = errorCode(body, `HTTP_${status}`)
  if (code === "COMMIT_RETRY_REQUIRED") return { kind: "retriable", code }
  // The switch, not the person. Telling someone they lack the right to do
  // something the whole organization cannot do right now sends them to an
  // administrator who has nothing to grant them.
  if (status === 403 && reasonCode(body) === "voice_writes_disabled") return { kind: "disabled" }
  if (status === 403) return { kind: "forbidden", code }
  if (STALE_CODES.has(code)) return { kind: "stale", code }
  if (status === 404) return { kind: "stale", code }
  return {
    kind: "failed",
    code,
    message: errorMessage(body, "The action could not be completed"),
  }
}

export type CommitVoiceReceiptInput = Readonly<{
  intentId: string
  revision: number
  payloadHash: string
  signal?: AbortSignal
}>

/**
 * Confirm and execute one receipt. Resolves with an outcome; it throws only if
 * the caller aborts.
 */
export async function commitVoiceReceipt(
  input: CommitVoiceReceiptInput,
): Promise<VoiceCommitOutcome> {
  const base = `/api/v1/ai/voice/actions/${encodeURIComponent(input.intentId)}`

  const confirmation = await postJson(`${base}/confirmation`, {
    expectedRevision: input.revision,
    payloadHash: input.payloadHash,
    confirmed: true,
  }, input.signal)

  if (confirmation.status !== 201 && confirmation.status !== 200) {
    return failureOutcome(confirmation.status, confirmation.body, confirmation.retryAfterSeconds)
  }

  const proof = isRecord(confirmation.body) ? confirmation.body.data : null
  if (
    !isRecord(proof)
    || typeof proof.confirmationEventId !== "string"
    || typeof proof.confirmationToken !== "string"
  ) {
    return { kind: "retriable", code: "CONFIRMATION_MALFORMED" }
  }

  const commit = await postJson(`${base}/commit`, {
    confirmationEventId: proof.confirmationEventId,
    confirmationToken: proof.confirmationToken,
    expectedRevision: input.revision,
    payloadHash: input.payloadHash,
  }, input.signal)

  if (commit.status !== 200) {
    return failureOutcome(commit.status, commit.body, commit.retryAfterSeconds)
  }

  const data = isRecord(commit.body) ? commit.body.data : null
  const result = isRecord(data) ? data.result : null
  if (
    !isRecord(result)
    || typeof result.entityId !== "string"
    || !result.entityId
    || (result.entityType !== "task" && result.entityType !== "lead" && result.entityType !== "deal")
  ) {
    // The server said 200, so the record exists; we simply cannot link to it.
    // Reporting this as a failure would tell the user a lie in the one
    // direction that makes them repeat a completed write.
    return { kind: "retriable", code: "RESULT_MALFORMED" }
  }

  return {
    kind: "succeeded",
    entityType: result.entityType,
    entityId: result.entityId,
    replayed: isRecord(data) && data.replayed === true,
  }
}

/**
 * Replace the payload of an unconfirmed draft (roadmap U1.9a).
 *
 * The endpoint REPLACES rather than merges, so the caller sends the whole
 * payload; `buildEditedReceiptPayload` rebuilds it from the receipt the user
 * is looking at. `expectedRevision` is the compare-and-swap token — a draft
 * that changed underneath, in another tab or by a newer proposal, is rejected
 * rather than silently overwritten.
 *
 * Still not a write: the result is another unconfirmed draft, and the button
 * is still what executes it.
 */
export async function editVoiceReceipt(
  input: Readonly<{
    intentId: string
    revision: number
    payload: Record<string, unknown>
    signal?: AbortSignal
  }>,
): Promise<
  | Readonly<{ ok: true; draft: unknown }>
  | Readonly<{ ok: false; outcome: VoiceCommitOutcome }>
> {
  const response = await fetch(
    `/api/v1/ai/voice/actions/${encodeURIComponent(input.intentId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: input.revision, payload: input.payload }),
      signal: input.signal,
    },
  )
  const body = (await response.json().catch(() => null)) as unknown
  if (response.status !== 200) {
    const retryAfter = Number(response.headers?.get?.("Retry-After") ?? "")
    return {
      ok: false,
      outcome: failureOutcome(
        response.status,
        body,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
      ),
    }
  }
  return { ok: true, draft: isRecord(body) ? body.data : null }
}

/** Discard a draft without executing it. Never touches the commit route. */
export async function cancelVoiceReceipt(
  input: Readonly<{ intentId: string; revision: number; signal?: AbortSignal }>,
): Promise<Readonly<{ ok: boolean; code?: string }>> {
  const response = await postJson(
    `/api/v1/ai/voice/actions/${encodeURIComponent(input.intentId)}/cancel`,
    { expectedRevision: input.revision },
    input.signal,
  )
  if (response.status === 200) return { ok: true }
  // A draft that is already gone is the state the user asked for.
  if (response.status === 404) return { ok: true }
  return { ok: false, code: errorCode(response.body, `HTTP_${response.status}`) }
}

/** Where the created or updated record lives, for the success link. */
export function voiceResultHref(entityType: "task" | "lead" | "deal", entityId: string): string {
  const base = entityType === "task" ? "/tasks" : entityType === "lead" ? "/leads" : "/deals"
  return `${base}/${encodeURIComponent(entityId)}`
}
