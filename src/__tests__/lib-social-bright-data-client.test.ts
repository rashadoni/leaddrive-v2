import { describe, expect, it, vi } from "vitest"
import {
  BRIGHT_DATA_API_ORIGIN,
  BrightDataApiError,
  BrightDataClient,
  brightDataDatasetFor,
  brightDataRouteFor,
  validateBrightDataDatasetRoutes,
} from "@/lib/social/bright-data-client"

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

const priceSnapshot = {
  id: "bright-data-web-scraper-payg-2026-07-13",
  effectiveAt: "2026-07-13T00:00:00.000Z",
  usdPerThousandRecords: 1.5,
  sourceUrl: "https://brightdata.com/cp/billing/overview",
}

describe("Bright Data async snapshot client", () => {
  it("triggers an async dataset without putting the token in the URL or body", async () => {
    const fetchImpl = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args
      return jsonResponse({ snapshot_id: "s_snapshot1" })
    })
    const client = new BrightDataClient({ apiToken: "secret-token", fetchImpl })

    await expect(client.trigger({
      datasetId: "gd_instagram1",
      inputs: [{ url: "https://instagram.com/p/ONE" }],
    })).resolves.toEqual({ snapshotId: "s_snapshot1" })

    const [input, init] = fetchImpl.mock.calls[0]
    expect(input).toBeInstanceOf(URL)
    if (!(input instanceof URL) || !init) throw new Error("fetch arguments missing")
    const url = input
    expect(url.toString()).toBe(`${BRIGHT_DATA_API_ORIGIN}/datasets/v3/trigger?dataset_id=gd_instagram1&include_errors=true`)
    expect(url.toString()).not.toContain("secret-token")
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret-token")
    expect(init.body).toBe('[{"url":"https://instagram.com/p/ONE"}]')
    expect(init.body).not.toContain("secret-token")
  })

  it("adds explicit discovery mode without changing collect-by-URL requests", async () => {
    const fetchImpl = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args
      return jsonResponse({ snapshot_id: "s_snapshot1" })
    })
    const client = new BrightDataClient({ apiToken: "secret-token", fetchImpl })

    await client.trigger({
      datasetId: "gd_tiktokposts1",
      inputs: [{ search_keyword: "Acme Robotics", country: "" }],
      operation: "DISCOVER",
      discoverBy: "keyword",
    })

    const [input] = fetchImpl.mock.calls[0]
    if (!(input instanceof URL)) throw new Error("fetch URL missing")
    expect(input.searchParams.get("type")).toBe("discover_new")
    expect(input.searchParams.get("discover_by")).toBe("keyword")
    expect(input.searchParams.get("dataset_id")).toBe("gd_tiktokposts1")
  })

  it("dispatches a budget-capped async trigger with the clamped limit in the query", async () => {
    const fetchImpl = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args
      return jsonResponse({ snapshot_id: "s_snapshot1" })
    })
    const client = new BrightDataClient({ apiToken: "token", fetchImpl })
    const inputs = [
      { url: "https://instagram.com/p/ONE" },
      { url: "https://instagram.com/p/TWO" },
      { url: "https://instagram.com/p/THREE" },
    ]

    const response = await client.triggerWithBudgetCap({
      datasetId: "gd_instagramcomments1",
      inputs,
      requestedLimitPerInput: 10,
      hardCapUsd: 0.02,
      priceSnapshot,
    })

    expect(response).toMatchObject({
      kind: "dispatched",
      budget: {
        status: "READY",
        limitPerInput: 4,
        reservedRecords: 12,
        reservedChargeUsd: 0.018,
        clamped: true,
      },
      result: { snapshotId: "s_snapshot1" },
    })
    const [input, init] = fetchImpl.mock.calls[0]
    if (!(input instanceof URL) || !init) throw new Error("fetch arguments missing")
    expect(input.pathname).toBe("/datasets/v3/trigger")
    expect(input.searchParams.get("limit_per_input")).toBe("4")
    expect(init.body).toBe(JSON.stringify(inputs))
  })

  it("blocks an async trigger before fetch when the account rate is missing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ snapshot_id: "s_snapshot1" }))
    const client = new BrightDataClient({ apiToken: "token", fetchImpl })

    await expect(client.triggerWithBudgetCap({
      datasetId: "gd_instagramcomments1",
      inputs: [{ url: "https://instagram.com/p/ONE" }],
      requestedLimitPerInput: 10,
      hardCapUsd: 0.02,
    })).resolves.toEqual({
      kind: "blocked",
      budget: { status: "BLOCKED", reason: "bright_data_price_snapshot_unconfigured" },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("caps synchronous results per input in the provider request body", async () => {
    const fetchImpl = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args
      return jsonResponse([{ comment_id: "comment-1" }])
    })
    const client = new BrightDataClient({ apiToken: "secret-token", fetchImpl })

    await expect(client.scrape({
      datasetId: "gd_instagramcomments1",
      inputs: [{ url: "https://instagram.com/p/ONE" }],
      limitPerInput: 1,
    })).resolves.toEqual({ kind: "records", records: [{ comment_id: "comment-1" }] })

    const [input, init] = fetchImpl.mock.calls[0]
    if (!(input instanceof URL) || !init) throw new Error("fetch arguments missing")
    expect(input.toString()).toBe(`${BRIGHT_DATA_API_ORIGIN}/datasets/v3/scrape?dataset_id=gd_instagramcomments1&notify=false&include_errors=true`)
    expect(init.body).toBe(JSON.stringify({
      input: [{ url: "https://instagram.com/p/ONE" }],
      limit_per_input: 1,
    }))
  })

  it("keeps discovery mode on a budget-capped synchronous request", async () => {
    const fetchImpl = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args
      return jsonResponse([{ post_id: "post-1" }])
    })
    const client = new BrightDataClient({ apiToken: "token", fetchImpl })

    await client.scrapeWithBudgetCap({
      datasetId: "gd_tiktokposts1",
      inputs: [{ search_keyword: "Acme Robotics" }],
      requestedLimitPerInput: 1,
      hardCapUsd: 0.02,
      priceSnapshot,
      operation: "DISCOVER",
      discoverBy: "keyword",
    })

    const [input] = fetchImpl.mock.calls[0]
    if (!(input instanceof URL)) throw new Error("fetch URL missing")
    expect(input.searchParams.get("type")).toBe("discover_new")
    expect(input.searchParams.get("discover_by")).toBe("keyword")
  })

  it("rejects discovery mode without discoverBy before provider fetch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]))
    const client = new BrightDataClient({ apiToken: "token", fetchImpl })

    await expect(client.scrape({
      datasetId: "gd_tiktokposts1",
      inputs: [{ search_keyword: "Acme Robotics" }],
      limitPerInput: 1,
      operation: "DISCOVER",
    })).rejects.toThrow("discovery scrape requires discoverBy")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects an unbounded synchronous request before calling the provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]))
    const client = new BrightDataClient({ apiToken: "token", fetchImpl })

    await expect(client.scrape({
      datasetId: "gd_instagramcomments1",
      inputs: [{ url: "https://instagram.com/p/ONE" }],
      limitPerInput: 0,
    })).rejects.toThrow("limitPerInput must be an integer between 1 and 1000")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("blocks a budgeted scrape before fetch when the account rate is missing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]))
    const client = new BrightDataClient({ apiToken: "token", fetchImpl })

    await expect(client.scrapeWithBudgetCap({
      datasetId: "gd_instagramcomments1",
      inputs: [{ url: "https://instagram.com/p/ONE" }],
      requestedLimitPerInput: 10,
      hardCapUsd: 0.02,
    })).resolves.toEqual({
      kind: "blocked",
      budget: { status: "BLOCKED", reason: "bright_data_price_snapshot_unconfigured" },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("dispatches a budgeted scrape only with the aggregate clamped limit", async () => {
    const fetchImpl = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args
      return jsonResponse([{ comment_id: "comment-1" }])
    })
    const client = new BrightDataClient({ apiToken: "token", fetchImpl })
    const inputs = [
      { url: "https://instagram.com/p/ONE" },
      { url: "https://instagram.com/p/TWO" },
      { url: "https://instagram.com/p/THREE" },
    ]

    const response = await client.scrapeWithBudgetCap({
      datasetId: "gd_instagramcomments1",
      inputs,
      requestedLimitPerInput: 10,
      hardCapUsd: 0.02,
      priceSnapshot,
    })

    expect(response).toMatchObject({
      kind: "dispatched",
      budget: {
        status: "READY",
        limitPerInput: 4,
        reservedRecords: 12,
        reservedChargeUsd: 0.018,
        clamped: true,
      },
      result: { kind: "records", records: [{ comment_id: "comment-1" }] },
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [, init] = fetchImpl.mock.calls[0]
    if (!init) throw new Error("fetch arguments missing")
    expect(init.body).toBe(JSON.stringify({ input: inputs, limit_per_input: 4 }))
  })

  it("accepts a snapshot fallback from a slow synchronous request", async () => {
    const client = new BrightDataClient({
      apiToken: "token",
      fetchImpl: vi.fn(async () => jsonResponse({ snapshot_id: "s_snapshot1" }, 202)),
    })

    await expect(client.scrape({
      datasetId: "gd_instagramcomments1",
      inputs: [{ url: "https://instagram.com/p/ONE" }],
      limitPerInput: 1,
    })).resolves.toEqual({ kind: "snapshot", snapshotId: "s_snapshot1" })
  })

  it("accepts the sd_ snapshot prefix returned by live synchronous fallback", async () => {
    const client = new BrightDataClient({
      apiToken: "token",
      fetchImpl: vi.fn(async () => jsonResponse({ snapshot_id: "sd_snapshot1" }, 202)),
    })

    await expect(client.scrape({
      datasetId: "gd_facebookposts1",
      inputs: [{ url: "https://facebook.com/share/v/ONE" }],
      limitPerInput: 1,
    })).resolves.toEqual({ kind: "snapshot", snapshotId: "sd_snapshot1" })
  })

  it("normalizes a single-record synchronous response to a records array", async () => {
    const client = new BrightDataClient({
      apiToken: "token",
      fetchImpl: vi.fn(async () => jsonResponse({ comment_id: "comment-1" })),
    })

    await expect(client.scrape({
      datasetId: "gd_instagramcomments1",
      inputs: [{ url: "https://instagram.com/p/ONE" }],
      limitPerInput: 1,
    })).resolves.toEqual({ kind: "records", records: [{ comment_id: "comment-1" }] })
  })

  it("polls starting/running snapshots with bounded backoff until ready", async () => {
    const statuses = ["starting", "running", "ready"]
    const fetchImpl = vi.fn(async () => jsonResponse({
      snapshot_id: "s_snapshot1",
      dataset_id: "gd_instagram1",
      status: statuses.shift(),
    }))
    const sleep = vi.fn(async () => {})
    const client = new BrightDataClient({ apiToken: "token", fetchImpl, sleep })

    await expect(client.pollUntilReady("s_snapshot1", {
      maxAttempts: 3,
      initialIntervalMs: 100,
      maxIntervalMs: 150,
    })).resolves.toEqual({
      snapshotId: "s_snapshot1",
      datasetId: "gd_instagram1",
      status: "ready",
    })
    expect(sleep.mock.calls).toEqual([[100], [150]])
  })

  it("accepts the ds_ dataset identifier returned by the progress API", async () => {
    const client = new BrightDataClient({
      apiToken: "token",
      fetchImpl: vi.fn(async () => jsonResponse({
        snapshot_id: "s_snapshot1",
        dataset_id: "ds_123456789",
        status: "ready",
      })),
    })
    await expect(client.progress("s_snapshot1")).resolves.toMatchObject({ datasetId: "ds_123456789" })
  })

  it("accepts an empty ready snapshot as valid data instead of a transport failure", async () => {
    const client = new BrightDataClient({
      apiToken: "token",
      fetchImpl: vi.fn(async () => jsonResponse([])),
    })
    await expect(client.download("s_snapshot1")).resolves.toEqual([])
  })

  it("retries transient progress errors but never re-triggers a paid collection", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "temporary upstream failure" }, 503))
      .mockResolvedValueOnce(jsonResponse({
        snapshot_id: "s_snapshot1",
        dataset_id: "gd_instagram1",
        status: "ready",
      }))
    const sleep = vi.fn(async () => {})
    const client = new BrightDataClient({ apiToken: "token", fetchImpl, sleep })

    await expect(client.pollUntilReady("s_snapshot1", {
      maxAttempts: 2,
      initialIntervalMs: 100,
    })).resolves.toMatchObject({ status: "ready" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.every(([url]) => url.pathname.includes("/progress/"))).toBe(true)
    expect(sleep).toHaveBeenCalledWith(100)
  })

  it("classifies rate limits and keeps provider errors redacted", async () => {
    const client = new BrightDataClient({
      apiToken: "top-secret",
      fetchImpl: vi.fn(async () => jsonResponse({
        error: "Too many running jobs Bearer leaked-upstream-value",
      }, 429, { "retry-after": "12" })),
    })

    const error = await client.progress("s_snapshot1").catch(value => value)
    expect(error).toBeInstanceOf(BrightDataApiError)
    expect(error.message).toContain("Bearer [redacted]")
    expect(error.message).not.toContain("leaked-upstream-value")
    expect(error.message).not.toContain("top-secret")
    expect(error.retryAfterSeconds).toBe(12)
    expect(error.classification).toMatchObject({ class: "RATE_LIMIT", retryable: true, quarantine: false })
  })

  it("preserves a safe plain-text provider error instead of masking it as invalid JSON", async () => {
    const client = new BrightDataClient({
      apiToken: "top-secret",
      fetchImpl: vi.fn(async () => new Response("Customer is not active", { status: 400 })),
    })

    const error = await client.progress("s_snapshot1").catch(value => value)
    expect(error).toBeInstanceOf(BrightDataApiError)
    expect(error.message).toBe("Customer is not active")
    expect(error.httpStatus).toBe(400)
  })

  it("fails closed on trigger/progress schema drift", async () => {
    const missingSnapshot = new BrightDataClient({
      apiToken: "token",
      fetchImpl: vi.fn(async () => jsonResponse({ id: "vendor-changed-field" })),
    })
    await expect(missingSnapshot.trigger({
      datasetId: "gd_instagram1",
      inputs: [{ url: "https://instagram.com/p/ONE" }],
    })).rejects.toThrow("bright_data_trigger_missing_snapshot_id")

    const unknownStatus = new BrightDataClient({
      apiToken: "token",
      fetchImpl: vi.fn(async () => jsonResponse({
        snapshot_id: "s_snapshot1",
        dataset_id: "gd_instagram1",
        status: "digesting-new-name",
      })),
    })
    await expect(unknownStatus.progress("s_snapshot1")).rejects.toThrow("bright_data_progress_unknown_status")
  })

  it("validates the owner-configured platform/capability dataset registry", () => {
    const routes = [
      { platform: "instagram", capability: "ENRICH_CONTENT" as const, datasetId: "gd_instagramposts1" },
      { platform: "instagram", capability: "READ_COMMENTS" as const, datasetId: "gd_instagramcomments1" },
    ]
    expect(() => validateBrightDataDatasetRoutes(routes)).not.toThrow()
    expect(brightDataDatasetFor(routes, "Instagram", "READ_COMMENTS")).toBe("gd_instagramcomments1")
    expect(brightDataRouteFor(routes, "Instagram", "READ_COMMENTS")).toEqual(routes[1])
    expect(brightDataDatasetFor(routes, "instagram", "READ_MEDIA")).toBeNull()
    expect(() => validateBrightDataDatasetRoutes([...routes, routes[0]])).toThrow("Duplicate Bright Data dataset route")
    expect(() => validateBrightDataDatasetRoutes([{ ...routes[0], datasetId: "wrong" }])).toThrow("Invalid Bright Data dataset ID")
    expect(() => validateBrightDataDatasetRoutes([{
      ...routes[0],
      operation: "DISCOVER",
    }])).toThrow("requires discoverBy")
  })

  it("propagates the parent run abort into a stalled provider request", async () => {
    const parent = new AbortController()
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted")
        error.name = "AbortError"
        reject(error)
      }, { once: true })
    }))
    const client = new BrightDataClient({
      apiToken: "token",
      fetchImpl,
      timeoutMs: 60_000,
      signal: parent.signal,
    })

    const pending = client.trigger({
      datasetId: "gd_instagram1",
      inputs: [{ url: "https://instagram.com/p/ONE" }],
    })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
    parent.abort()

    await expect(pending).rejects.toMatchObject({
      message: "bright_data_timeout",
      classification: expect.objectContaining({ class: "TRANSIENT", retryable: true }),
    })
  })

  it("caps Retry-After and stops polling when the parent deadline expires", async () => {
    const parent = new AbortController()
    const fetchImpl = vi.fn(async () => jsonResponse(
      { error: "rate limited" },
      429,
      { "retry-after": "86400" },
    ))
    const sleep = vi.fn(async () => {
      parent.abort()
    })
    const client = new BrightDataClient({
      apiToken: "token",
      fetchImpl,
      sleep,
      signal: parent.signal,
    })

    await expect(client.pollUntilReady("s_snapshot1", {
      maxAttempts: 2,
      initialIntervalMs: 100,
      maxIntervalMs: 150,
    })).rejects.toThrow("bright_data_timeout")
    expect(sleep).toHaveBeenCalledWith(150)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("aborts a stalled provider request at the configured timeout", async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted")
        error.name = "AbortError"
        reject(error)
      })
    }))
    const client = new BrightDataClient({ apiToken: "token", fetchImpl, timeoutMs: 1_000 })

    const error = await client.download("s_snapshot1").catch(value => value)
    expect(error).toBeInstanceOf(BrightDataApiError)
    expect(error.message).toBe("bright_data_timeout")
    expect(error.classification).toMatchObject({ class: "TRANSIENT", retryable: true })
  })
})
