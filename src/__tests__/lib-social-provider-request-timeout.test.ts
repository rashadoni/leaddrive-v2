import { afterEach, describe, expect, it, vi } from "vitest"
import {
  SOCIAL_PROVIDER_TIMEOUT_DEFAULT_MS,
  SOCIAL_PROVIDER_TIMEOUT_MAX_MS,
  SOCIAL_PROVIDER_TIMEOUT_MIN_MS,
  SOCIAL_PROVIDER_RUN_TIMEOUT_DEFAULT_MS,
  SOCIAL_PROVIDER_RUN_TIMEOUT_MAX_MS,
  SocialProviderTimeoutError,
  isSocialProviderTimeoutError,
  withSocialProviderTimeout,
  withSocialProviderRunTimeout,
} from "@/lib/social/provider-request-timeout"

function abortablePending(signal: AbortSignal, cause: Error): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(cause), { once: true })
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe("withSocialProviderTimeout", () => {
  it("exports the bounded timeout contract and identifies its stable error type", () => {
    expect(SOCIAL_PROVIDER_TIMEOUT_DEFAULT_MS).toBe(30_000)
    expect(SOCIAL_PROVIDER_TIMEOUT_MIN_MS).toBe(1_000)
    expect(SOCIAL_PROVIDER_TIMEOUT_MAX_MS).toBe(60_000)
    expect(SOCIAL_PROVIDER_RUN_TIMEOUT_DEFAULT_MS).toBe(14 * 60_000)
    expect(SOCIAL_PROVIDER_RUN_TIMEOUT_MAX_MS).toBe(14 * 60_000)

    const cause = new Error("aborted by transport")
    const error = new SocialProviderTimeoutError("youtube", 30_000, { cause })
    expect(error).toMatchObject({
      name: "SocialProviderTimeoutError",
      code: "social_provider_timeout",
      providerKey: "youtube",
      timeoutMs: 30_000,
      message: "youtube_timeout",
      cause,
    })
    expect(isSocialProviderTimeoutError(error)).toBe(true)
    expect(isSocialProviderTimeoutError(new Error("youtube_timeout"))).toBe(false)
  })

  it("aborts a stalled operation at the default timeout", async () => {
    vi.useFakeTimers()
    const abortCause = Object.assign(new Error("transport aborted"), { name: "AbortError" })
    const state: { signal?: AbortSignal } = {}
    const pending = withSocialProviderTimeout("telegram", async currentSignal => {
      state.signal = currentSignal
      return abortablePending(currentSignal, abortCause)
    })
    const assertion = expect(pending).rejects.toMatchObject({
      code: "social_provider_timeout",
      providerKey: "telegram",
      timeoutMs: SOCIAL_PROVIDER_TIMEOUT_DEFAULT_MS,
      message: "telegram_timeout",
      cause: abortCause,
    })

    await vi.advanceTimersByTimeAsync(SOCIAL_PROVIDER_TIMEOUT_DEFAULT_MS - 1)
    expect(state.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(state.signal?.aborted).toBe(true)
  })

  it("clamps an explicit timeout to the supported minimum and maximum", async () => {
    vi.useFakeTimers()

    const minimumState: { signal?: AbortSignal } = {}
    const minimumPending = withSocialProviderTimeout("vk", async signal => {
      minimumState.signal = signal
      return abortablePending(signal, new Error("minimum abort"))
    }, { timeoutMs: 1 })
    const minimumAssertion = expect(minimumPending).rejects.toMatchObject({
      timeoutMs: SOCIAL_PROVIDER_TIMEOUT_MIN_MS,
    })
    await vi.advanceTimersByTimeAsync(SOCIAL_PROVIDER_TIMEOUT_MIN_MS - 1)
    expect(minimumState.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await minimumAssertion

    const maximumState: { signal?: AbortSignal } = {}
    const maximumPending = withSocialProviderTimeout("meta", async signal => {
      maximumState.signal = signal
      return abortablePending(signal, new Error("maximum abort"))
    }, { timeoutMs: SOCIAL_PROVIDER_TIMEOUT_MAX_MS * 2 })
    const maximumAssertion = expect(maximumPending).rejects.toMatchObject({
      timeoutMs: SOCIAL_PROVIDER_TIMEOUT_MAX_MS,
    })
    await vi.advanceTimersByTimeAsync(SOCIAL_PROVIDER_TIMEOUT_MAX_MS - 1)
    expect(maximumState.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await maximumAssertion
  })

  it("keeps the deadline active while a fetched response body is stalled", async () => {
    vi.useFakeTimers()
    const bodyAbort = Object.assign(new Error("body aborted"), { name: "AbortError" })
    let bodyStarted = false
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      json: () => {
        bodyStarted = true
        return abortablePending(init?.signal as AbortSignal, bodyAbort)
      },
    } as Response))

    const pending = withSocialProviderTimeout("provider", async signal => {
      const response = await fetchImpl("https://provider.example.test/items", { signal })
      return response.json()
    }, { timeoutMs: 1_000 })
    const assertion = expect(pending).rejects.toMatchObject({
      code: "social_provider_timeout",
      message: "provider_timeout",
      cause: bodyAbort,
    })

    await Promise.resolve()
    expect(bodyStarted).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://provider.example.test/items",
      { signal: expect.any(AbortSignal) },
    )
  })

  it("clears the deadline after success", async () => {
    vi.useFakeTimers()
    const state: { signal?: AbortSignal } = {}

    await expect(withSocialProviderTimeout("search_index", async currentSignal => {
      state.signal = currentSignal
      return "ok"
    }, { timeoutMs: 1_000 })).resolves.toBe("ok")

    await vi.advanceTimersByTimeAsync(SOCIAL_PROVIDER_TIMEOUT_MAX_MS)
    expect(state.signal?.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("preserves a non-timeout error by identity", async () => {
    vi.useFakeTimers()
    const original = Object.assign(new Error("provider rejected request"), { code: "PROVIDER_400" })

    const caught = await withSocialProviderTimeout("provider", async () => {
      throw original
    }).catch(error => error)

    expect(caught).toBe(original)
    expect(isSocialProviderTimeoutError(caught)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not accept a success resolved synchronously by the timeout abort", async () => {
    vi.useFakeTimers()
    const pending = withSocialProviderTimeout("provider", signal => new Promise(resolve => {
      signal.addEventListener("abort", () => resolve("late-success"), { once: true })
    }), { timeoutMs: 1_000 })
    const assertion = expect(pending).rejects.toMatchObject({
      code: "social_provider_timeout",
      providerKey: "provider",
      timeoutMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })

  it("propagates the adapter-run deadline into a longer child request", async () => {
    vi.useFakeTimers()
    const pending = withSocialProviderRunTimeout(
      "x_api",
      runSignal => withSocialProviderTimeout(
        "x_page",
        signal => abortablePending(
          signal,
          Object.assign(new Error("page aborted"), { name: "AbortError" }),
        ),
        { timeoutMs: 60_000, signal: runSignal },
      ),
      { timeoutMs: 1_000 },
    )
    const assertion = expect(pending).rejects.toMatchObject({
      code: "social_provider_timeout",
      providerKey: "x_api",
      timeoutMs: 1_000,
      message: "x_api_timeout",
    })

    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
})
