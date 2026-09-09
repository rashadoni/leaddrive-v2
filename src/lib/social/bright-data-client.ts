import {
  classifyCollectorError,
  type CollectorErrorClassification,
} from "@/lib/social/collector-error-classifier"
import {
  planBrightDataBudgetCap,
  type BrightDataBudgetCapPlan,
} from "@/lib/social/bright-data-budget-cap"
import type { BrightDataPriceSnapshot } from "@/lib/social/bright-data-cost-ledger"
import type { ProviderCapability } from "@/lib/social/provider-capability-contract"

export const BRIGHT_DATA_API_ORIGIN = "https://api.brightdata.com"
export const BRIGHT_DATA_CLIENT_CONTRACT_VERSION = "bright-data-snapshot-v1"

export type BrightDataSnapshotStatus = "starting" | "running" | "ready" | "failed"
export type BrightDataInput = Record<string, string | number | boolean | null>

export interface BrightDataDatasetRoute {
  platform: string
  capability: ProviderCapability
  datasetId: string
  operation?: "COLLECT" | "DISCOVER"
  discoverBy?: "url" | "keyword" | "profile_url" | "user_name" | "search_url"
}

export interface BrightDataTriggerRequest {
  datasetId: string
  inputs: BrightDataInput[]
  limitPerInput?: number
  includeErrors?: boolean
  operation?: "COLLECT" | "DISCOVER"
  discoverBy?: BrightDataDatasetRoute["discoverBy"]
}

export interface BrightDataTriggerResult {
  snapshotId: string
}

export interface BrightDataScrapeRequest {
  datasetId: string
  inputs: BrightDataInput[]
  limitPerInput: number
  includeErrors?: boolean
  operation?: "COLLECT" | "DISCOVER"
  discoverBy?: BrightDataDatasetRoute["discoverBy"]
}

export type BrightDataScrapeResult =
  | { kind: "records"; records: Record<string, unknown>[] }
  | { kind: "snapshot"; snapshotId: string }

export interface BrightDataBudgetedScrapeRequest {
  datasetId: string
  inputs: BrightDataInput[]
  requestedLimitPerInput: number
  hardCapUsd: number
  priceSnapshot?: BrightDataPriceSnapshot | null
  includeErrors?: boolean
  operation?: "COLLECT" | "DISCOVER"
  discoverBy?: BrightDataDatasetRoute["discoverBy"]
}

export type BrightDataBudgetedScrapeResult =
  | { kind: "blocked"; budget: Extract<BrightDataBudgetCapPlan, { status: "BLOCKED" }> }
  | {
    kind: "dispatched"
    budget: Extract<BrightDataBudgetCapPlan, { status: "READY" }>
    result: BrightDataScrapeResult
  }

export type BrightDataBudgetedTriggerResult =
  | { kind: "blocked"; budget: Extract<BrightDataBudgetCapPlan, { status: "BLOCKED" }> }
  | {
    kind: "dispatched"
    budget: Extract<BrightDataBudgetCapPlan, { status: "READY" }>
    result: BrightDataTriggerResult
  }

export interface BrightDataProgress {
  snapshotId: string
  datasetId: string
  status: BrightDataSnapshotStatus
}

export interface BrightDataClientOptions {
  apiToken: string
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
}

export interface BrightDataPollOptions {
  maxAttempts?: number
  initialIntervalMs?: number
  maxIntervalMs?: number
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeErrorMessage(payload: unknown, status: number): string {
  const plainText = nonEmptyString(payload) ? payload : null
  const body = record(payload)
  const validationErrors = Array.isArray(body.validation_errors)
    ? body.validation_errors.filter(nonEmptyString).slice(0, 5)
    : []
  const message = plainText
    ?? (nonEmptyString(body.error)
    ? body.error
    : nonEmptyString(body.message)
      ? body.message
      : validationErrors.length > 0
        ? validationErrors.join("; ")
        : `bright_data_http_${status}`)
  // Never echo arbitrary provider payloads, inputs or Authorization headers.
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted-value]")
    .slice(0, 500)
}

function validDatasetId(value: string): boolean {
  return /^gd_[a-z0-9]+$/i.test(value)
}

function validReturnedDatasetId(value: string): boolean {
  return /^(?:gd|ds)_[a-z0-9]+$/i.test(value)
}

function validSnapshotId(value: string): boolean {
  return /^(?:s|sd|snap)_[a-z0-9]+$/i.test(value)
}

export class BrightDataApiError extends Error {
  readonly httpStatus: number | null
  readonly retryAfterSeconds: number | null
  readonly classification: CollectorErrorClassification

  constructor(input: {
    message: string
    httpStatus?: number | null
    retryAfterSeconds?: number | null
  }) {
    const httpStatus = input.httpStatus ?? null
    super(input.message)
    this.name = "BrightDataApiError"
    this.httpStatus = httpStatus
    this.retryAfterSeconds = input.retryAfterSeconds ?? null
    this.classification = classifyCollectorError(input.message, { httpStatus })
  }
}

export function validateBrightDataDatasetRoutes(routes: BrightDataDatasetRoute[]): void {
  const keys = new Set<string>()
  for (const route of routes) {
    if (!route.platform.trim()) throw new Error("Bright Data route platform is required")
    if (!validDatasetId(route.datasetId)) throw new Error(`Invalid Bright Data dataset ID for ${route.platform}/${route.capability}`)
    if (route.operation === "DISCOVER" && !route.discoverBy) {
      throw new Error(`Bright Data discovery route requires discoverBy for ${route.platform}/${route.capability}`)
    }
    if (route.operation !== "DISCOVER" && route.discoverBy) {
      throw new Error(`Bright Data collect route cannot define discoverBy for ${route.platform}/${route.capability}`)
    }
    const key = `${route.platform.toLowerCase()}:${route.capability}`
    if (keys.has(key)) throw new Error(`Duplicate Bright Data dataset route ${key}`)
    keys.add(key)
  }
}

export function brightDataDatasetFor(
  routes: BrightDataDatasetRoute[],
  platform: string,
  capability: ProviderCapability,
): string | null {
  validateBrightDataDatasetRoutes(routes)
  return routes.find(route => (
    route.platform.toLowerCase() === platform.toLowerCase()
    && route.capability === capability
  ))?.datasetId ?? null
}

export function brightDataRouteFor(
  routes: BrightDataDatasetRoute[],
  platform: string,
  capability: ProviderCapability,
): BrightDataDatasetRoute | null {
  validateBrightDataDatasetRoutes(routes)
  return routes.find(route => (
    route.platform.toLowerCase() === platform.toLowerCase()
    && route.capability === capability
  )) ?? null
}

export class BrightDataClient {
  private readonly apiToken: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly parentSignal?: AbortSignal

  constructor(options: BrightDataClientOptions) {
    if (!options.apiToken.trim()) throw new Error("Bright Data API token is required")
    this.apiToken = options.apiToken.trim()
    this.timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 30_000, 120_000))
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
    this.parentSignal = options.signal
  }

  private assertWithinRunDeadline(): void {
    if (this.parentSignal?.aborted) {
      throw new BrightDataApiError({ message: "bright_data_timeout" })
    }
  }

  private async wait(milliseconds: number): Promise<void> {
    this.assertWithinRunDeadline()
    await this.sleep(milliseconds)
    this.assertWithinRunDeadline()
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    this.assertWithinRunDeadline()
    const url = new URL(path, BRIGHT_DATA_API_ORIGIN)
    if (url.origin !== BRIGHT_DATA_API_ORIGIN) throw new Error("Bright Data API origin is fixed")
    const controller = new AbortController()
    const abortFromParent = () => {
      if (!controller.signal.aborted) controller.abort(this.parentSignal?.reason)
    }
    if (this.parentSignal?.aborted) abortFromParent()
    else this.parentSignal?.addEventListener("abort", abortFromParent, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiToken}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      })
      const text = await response.text()
      let payload: unknown = null
      if (text.trim()) {
        try {
          payload = JSON.parse(text)
        } catch {
          if (response.ok) {
            throw new BrightDataApiError({
              message: "bright_data_invalid_json_response",
              httpStatus: response.status,
            })
          }
          payload = text
        }
      }
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("retry-after"))
        throw new BrightDataApiError({
          message: safeErrorMessage(payload, response.status),
          httpStatus: response.status,
          retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
        })
      }
      return payload
    } catch (error) {
      if (error instanceof BrightDataApiError) throw error
      if (this.parentSignal?.aborted) {
        throw new BrightDataApiError({ message: "bright_data_timeout" })
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new BrightDataApiError({ message: "bright_data_timeout" })
      }
      throw new BrightDataApiError({
        message: error instanceof Error ? `bright_data_network:${error.message}` : "bright_data_network",
      })
    } finally {
      clearTimeout(timeout)
      this.parentSignal?.removeEventListener("abort", abortFromParent)
    }
  }

  async trigger(request: BrightDataTriggerRequest): Promise<BrightDataTriggerResult> {
    if (!validDatasetId(request.datasetId)) throw new Error("Invalid Bright Data dataset ID")
    if (request.inputs.length === 0) throw new Error("Bright Data trigger requires at least one input")
    if (request.inputs.length > 5_000) throw new Error("Bright Data trigger input limit exceeded")
    if (
      request.limitPerInput !== undefined
      && (!Number.isInteger(request.limitPerInput) || request.limitPerInput < 1 || request.limitPerInput > 1_000)
    ) {
      throw new Error("Bright Data limitPerInput must be an integer between 1 and 1000")
    }
    const url = new URL("/datasets/v3/trigger", BRIGHT_DATA_API_ORIGIN)
    url.searchParams.set("dataset_id", request.datasetId)
    url.searchParams.set("include_errors", request.includeErrors === false ? "false" : "true")
    if (request.limitPerInput !== undefined) {
      url.searchParams.set("limit_per_input", String(request.limitPerInput))
    }
    if (request.operation === "DISCOVER") {
      if (!request.discoverBy) throw new Error("Bright Data discovery trigger requires discoverBy")
      url.searchParams.set("type", "discover_new")
      url.searchParams.set("discover_by", request.discoverBy)
    } else if (request.discoverBy) {
      throw new Error("Bright Data collect trigger cannot define discoverBy")
    }
    const payload = record(await this.request(`${url.pathname}${url.search}`, {
      method: "POST",
      body: JSON.stringify(request.inputs),
    }))
    const snapshotId = payload.snapshot_id
    if (!nonEmptyString(snapshotId) || !validSnapshotId(snapshotId)) {
      throw new BrightDataApiError({ message: "bright_data_trigger_missing_snapshot_id" })
    }
    return { snapshotId }
  }

  async cancel(snapshotId: string): Promise<void> {
    if (!validSnapshotId(snapshotId)) throw new Error("Invalid Bright Data snapshot ID")
    this.assertWithinRunDeadline()
    const path = `/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}/cancel`
    const url = new URL(path, BRIGHT_DATA_API_ORIGIN)
    const controller = new AbortController()
    const abortFromParent = () => {
      if (!controller.signal.aborted) controller.abort(this.parentSignal?.reason)
    }
    if (this.parentSignal?.aborted) abortFromParent()
    else this.parentSignal?.addEventListener("abort", abortFromParent, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          accept: "text/plain",
          authorization: `Bearer ${this.apiToken}`,
        },
        signal: controller.signal,
      })
      const body = (await response.text()).trim()
      if (!response.ok || body !== "OK") {
        throw new BrightDataApiError({
          message: response.ok ? "bright_data_cancel_response_invalid" : `bright_data_http_${response.status}`,
          httpStatus: response.status,
        })
      }
    } catch (error) {
      if (error instanceof BrightDataApiError) throw error
      if (this.parentSignal?.aborted) {
        throw new BrightDataApiError({ message: "bright_data_timeout" })
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new BrightDataApiError({ message: "bright_data_timeout" })
      }
      throw new BrightDataApiError({ message: "bright_data_cancel_failed" })
    } finally {
      clearTimeout(timeout)
      this.parentSignal?.removeEventListener("abort", abortFromParent)
    }
  }

  /**
   * Production async entry point. The owner-approved USD cap is converted to
   * Bright Data's documented limit_per_input before the one billable trigger.
   * A blocked budget never reaches the provider.
   */
  async triggerWithBudgetCap(
    request: BrightDataBudgetedScrapeRequest,
  ): Promise<BrightDataBudgetedTriggerResult> {
    if (request.inputs.length === 0) throw new Error("Bright Data trigger requires at least one input")
    if (request.inputs.length > 5_000) throw new Error("Bright Data trigger input limit exceeded")
    if (
      !Number.isInteger(request.requestedLimitPerInput)
      || request.requestedLimitPerInput < 1
      || request.requestedLimitPerInput > 1_000
    ) {
      throw new Error("Bright Data requestedLimitPerInput must be an integer between 1 and 1000")
    }

    const budget = planBrightDataBudgetCap({
      hardCapUsd: request.hardCapUsd,
      inputCount: request.inputs.length,
      requestedLimitPerInput: request.requestedLimitPerInput,
      priceSnapshot: request.priceSnapshot,
    })
    if (budget.status === "BLOCKED") return { kind: "blocked", budget }

    const result = await this.trigger({
      datasetId: request.datasetId,
      inputs: request.inputs,
      limitPerInput: budget.limitPerInput,
      includeErrors: request.includeErrors,
      operation: request.operation,
      discoverBy: request.discoverBy,
    })
    return { kind: "dispatched", budget, result }
  }

  /**
   * Runs a bounded synchronous collection. Bright Data may still convert a slow
   * request into an async snapshot, so callers must handle both result kinds.
   */
  async scrape(request: BrightDataScrapeRequest): Promise<BrightDataScrapeResult> {
    if (!validDatasetId(request.datasetId)) throw new Error("Invalid Bright Data dataset ID")
    if (request.inputs.length === 0) throw new Error("Bright Data scrape requires at least one input")
    if (request.inputs.length > 20) throw new Error("Bright Data synchronous input limit exceeded")
    if (!Number.isInteger(request.limitPerInput) || request.limitPerInput < 1 || request.limitPerInput > 1_000) {
      throw new Error("Bright Data limitPerInput must be an integer between 1 and 1000")
    }
    const url = new URL("/datasets/v3/scrape", BRIGHT_DATA_API_ORIGIN)
    url.searchParams.set("dataset_id", request.datasetId)
    url.searchParams.set("notify", "false")
    url.searchParams.set("include_errors", request.includeErrors === false ? "false" : "true")
    if (request.operation === "DISCOVER") {
      if (!request.discoverBy) throw new Error("Bright Data discovery scrape requires discoverBy")
      url.searchParams.set("type", "discover_new")
      url.searchParams.set("discover_by", request.discoverBy)
    } else if (request.discoverBy) {
      throw new Error("Bright Data collect scrape cannot define discoverBy")
    }
    const payload = await this.request(`${url.pathname}${url.search}`, {
      method: "POST",
      body: JSON.stringify({
        input: request.inputs,
        limit_per_input: request.limitPerInput,
      }),
    })
    if (Array.isArray(payload)) {
      if (payload.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
        throw new BrightDataApiError({ message: "bright_data_scrape_invalid_records" })
      }
      return { kind: "records", records: payload as Record<string, unknown>[] }
    }
    const snapshotId = record(payload).snapshot_id
    if (nonEmptyString(snapshotId) && validSnapshotId(snapshotId)) {
      return { kind: "snapshot", snapshotId }
    }
    if (payload && typeof payload === "object") {
      return { kind: "records", records: [payload as Record<string, unknown>] }
    }
    throw new BrightDataApiError({ message: "bright_data_scrape_invalid_response" })
  }

  /**
   * Production-facing synchronous entry point. It derives limit_per_input from
   * a versioned account rate and returns before fetch when the USD cap cannot
   * safely fund the requested batch.
   */
  async scrapeWithBudgetCap(
    request: BrightDataBudgetedScrapeRequest,
  ): Promise<BrightDataBudgetedScrapeResult> {
    if (request.inputs.length === 0) throw new Error("Bright Data scrape requires at least one input")
    if (request.inputs.length > 20) throw new Error("Bright Data synchronous input limit exceeded")
    if (
      !Number.isInteger(request.requestedLimitPerInput)
      || request.requestedLimitPerInput < 1
      || request.requestedLimitPerInput > 1_000
    ) {
      throw new Error("Bright Data requestedLimitPerInput must be an integer between 1 and 1000")
    }

    const budget = planBrightDataBudgetCap({
      hardCapUsd: request.hardCapUsd,
      inputCount: request.inputs.length,
      requestedLimitPerInput: request.requestedLimitPerInput,
      priceSnapshot: request.priceSnapshot,
    })
    if (budget.status === "BLOCKED") return { kind: "blocked", budget }

    const result = await this.scrape({
      datasetId: request.datasetId,
      inputs: request.inputs,
      limitPerInput: budget.limitPerInput,
      includeErrors: request.includeErrors,
      operation: request.operation,
      discoverBy: request.discoverBy,
    })
    return { kind: "dispatched", budget, result }
  }

  async progress(snapshotId: string): Promise<BrightDataProgress> {
    if (!validSnapshotId(snapshotId)) throw new Error("Invalid Bright Data snapshot ID")
    const payload = record(await this.request(`/datasets/v3/progress/${encodeURIComponent(snapshotId)}`))
    const returnedSnapshotId = payload.snapshot_id
    const datasetId = payload.dataset_id
    const status = payload.status
    if (!nonEmptyString(returnedSnapshotId) || returnedSnapshotId !== snapshotId) {
      throw new BrightDataApiError({ message: "bright_data_progress_snapshot_mismatch" })
    }
    if (!nonEmptyString(datasetId) || !validReturnedDatasetId(datasetId)) {
      throw new BrightDataApiError({ message: "bright_data_progress_missing_dataset_id" })
    }
    if (!nonEmptyString(status) || !["starting", "running", "ready", "failed"].includes(status)) {
      throw new BrightDataApiError({ message: "bright_data_progress_unknown_status" })
    }
    return { snapshotId, datasetId, status: status as BrightDataSnapshotStatus }
  }

  async pollUntilReady(snapshotId: string, options: BrightDataPollOptions = {}): Promise<BrightDataProgress> {
    const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 60, 300))
    const initialIntervalMs = Math.max(100, Math.min(options.initialIntervalMs ?? 2_000, 60_000))
    const maxIntervalMs = Math.max(initialIntervalMs, Math.min(options.maxIntervalMs ?? 30_000, 120_000))
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      this.assertWithinRunDeadline()
      let current: BrightDataProgress
      try {
        current = await this.progress(snapshotId)
      } catch (error) {
        this.assertWithinRunDeadline()
        if (!(error instanceof BrightDataApiError) || !error.classification.retryable || attempt >= maxAttempts - 1) {
          throw error
        }
        const retryAfterMs = error.retryAfterSeconds === null ? 0 : error.retryAfterSeconds * 1_000
        await this.wait(Math.min(
          maxIntervalMs,
          Math.max(
            retryAfterMs,
            Math.min(initialIntervalMs * 2 ** attempt, maxIntervalMs),
          ),
        ))
        continue
      }
      if (current.status === "ready") return current
      if (current.status === "failed") {
        throw new BrightDataApiError({ message: "bright_data_snapshot_failed" })
      }
      if (attempt < maxAttempts - 1) {
        await this.wait(Math.min(initialIntervalMs * 2 ** attempt, maxIntervalMs))
      }
    }
    throw new BrightDataApiError({ message: "bright_data_poll_timeout" })
  }

  async download(snapshotId: string): Promise<Record<string, unknown>[]> {
    if (!validSnapshotId(snapshotId)) throw new Error("Invalid Bright Data snapshot ID")
    const payload = await this.request(`/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`)
    if (!Array.isArray(payload) || payload.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
      throw new BrightDataApiError({ message: "bright_data_snapshot_invalid_records" })
    }
    return payload as Record<string, unknown>[]
  }
}
