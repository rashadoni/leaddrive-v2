export const SOCIAL_PROVIDER_TIMEOUT_DEFAULT_MS = 30_000
export const SOCIAL_PROVIDER_TIMEOUT_MIN_MS = 1_000
export const SOCIAL_PROVIDER_TIMEOUT_MAX_MS = 60_000
export const SOCIAL_PROVIDER_RUN_TIMEOUT_DEFAULT_MS = 14 * 60_000
export const SOCIAL_PROVIDER_RUN_TIMEOUT_MAX_MS = 14 * 60_000

type SocialProviderTimeoutOptions = {
  timeoutMs?: number
  signal?: AbortSignal
}

type SocialProviderTimeoutErrorOptions = {
  cause?: unknown
}

export class SocialProviderTimeoutError extends Error {
  readonly code = "social_provider_timeout"

  constructor(
    readonly providerKey: string,
    readonly timeoutMs: number,
    options: SocialProviderTimeoutErrorOptions = {},
  ) {
    super(`${providerKey}_timeout`, options)
    this.name = "SocialProviderTimeoutError"
  }
}

export function isSocialProviderTimeoutError(error: unknown): error is SocialProviderTimeoutError {
  return error instanceof SocialProviderTimeoutError
}

function boundedTimeoutMs(timeoutMs: number | undefined, maximumMs = SOCIAL_PROVIDER_TIMEOUT_MAX_MS): number {
  const requested = timeoutMs ?? SOCIAL_PROVIDER_TIMEOUT_DEFAULT_MS
  const finite = Number.isFinite(requested)
    ? Math.trunc(requested)
    : SOCIAL_PROVIDER_TIMEOUT_DEFAULT_MS
  return Math.max(
    SOCIAL_PROVIDER_TIMEOUT_MIN_MS,
    Math.min(maximumMs, finite),
  )
}

async function withAbortTimeout<T>(
  providerKey: string,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let parentAborted = false
  const abortFromParent = () => {
    parentAborted = true
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason)
  }
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true })
  const timeout = setTimeout(() => {
    // Set this before aborting so synchronous abort listeners are classified as
    // our deadline regardless of the DOMException shape returned by fetch.
    timedOut = true
    if (!controller.signal.aborted) controller.abort()
  }, timeoutMs)
  timeout.unref?.()

  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new DOMException("Provider request aborted", "AbortError")
    }
    const result = await operation(controller.signal)
    if (timedOut || parentAborted) {
      throw new SocialProviderTimeoutError(providerKey, timeoutMs)
    }
    return result
  } catch (error) {
    if (
      error instanceof SocialProviderTimeoutError
      && error.providerKey === providerKey
      && error.timeoutMs === timeoutMs
    ) {
      throw error
    }
    if (timedOut || parentAborted) {
      throw new SocialProviderTimeoutError(providerKey, timeoutMs, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener("abort", abortFromParent)
  }
}

/**
 * Bounds one provider operation with a real abort signal.
 *
 * The callback must keep all provider I/O, including response-body parsing,
 * inside this boundary. A real abort cancels a compliant fetch instead of
 * letting it continue after the caller has released its collection fence.
 */
export async function withSocialProviderTimeout<T>(
  providerKey: string,
  operation: (signal: AbortSignal) => Promise<T>,
  options: SocialProviderTimeoutOptions = {},
): Promise<T> {
  const timeoutMs = boundedTimeoutMs(options.timeoutMs)
  return withAbortTimeout(providerKey, operation, timeoutMs, options.signal)
}

/**
 * Bounds the complete synchronous adapter run below the 15-minute source
 * lease. Child provider requests must receive this signal through the
 * `signal` option above; no work is detached with Promise.race.
 */
export async function withSocialProviderRunTimeout<T>(
  providerKey: string,
  operation: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = boundedTimeoutMs(
    options.timeoutMs ?? SOCIAL_PROVIDER_RUN_TIMEOUT_DEFAULT_MS,
    SOCIAL_PROVIDER_RUN_TIMEOUT_MAX_MS,
  )
  return withAbortTimeout(providerKey, operation, timeoutMs)
}
