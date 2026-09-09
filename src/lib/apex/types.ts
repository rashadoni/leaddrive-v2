/**
 * Apex-equivalent sandbox types — N3 Phase 5 slice 1.
 *
 * Per-tenant JS execution analogous to Salesforce Apex. Tenant writes
 * a module exporting a `handler` function; the engine compiles it
 * once (cached by source hash), runs it in a frozen sandbox with the
 * curated `crm.*` API surface, and captures the result + console
 * output + duration.
 *
 * Slice 1: node:vm + timeout. Slice 2: isolated-vm + record-event
 * triggers. The `SandboxExecutor` interface is the swap point — same
 * contract, different isolation primitive.
 */

export type TriggerType = "manual" | "record_created" | "record_updated" | "cron"

export type ExecutionOutcome = "ok" | "error" | "timeout" | "rejected"

/* ─── Caller-side context (passed to the handler) ─────────────────────── */

/**
 * The `crm.context` value handlers see. Read-only metadata about the
 * tenant and (if applicable) the invoking user. The handler can't
 * mutate this — surface is frozen at sandbox-init time.
 */
export interface CodeContext {
  organizationId: string
  /** User who triggered the run, if any. Null for cron + record-event triggers. */
  userId: string | null
  /** Trigger origin — informs the handler about why it's running. */
  trigger: TriggerType
  /** Optional event payload — slice 2 record-event triggers pass the record snapshot here. */
  event?: Record<string, unknown>
}

/* ─── crm.* API surface (DI'd into the sandbox) ───────────────────────── */

/**
 * Minimum CRUD surface the slice-1 sandbox exposes. Slice 2 extends
 * with leads, companies, tickets, tasks. Keep this surface narrow —
 * each method is a sandbox→host roundtrip with its own tenant + rate
 * + permission check.
 */
export interface DealRepository {
  find(filter: Record<string, unknown>): Promise<unknown[]>
  create(data: Record<string, unknown>): Promise<unknown>
  update(id: string, data: Record<string, unknown>): Promise<unknown>
}

export interface ContactRepository {
  find(filter: Record<string, unknown>): Promise<unknown[]>
  create(data: Record<string, unknown>): Promise<unknown>
  update(id: string, data: Record<string, unknown>): Promise<unknown>
}

/**
 * Logger handed into the sandbox. Captures the handler's `crm.log`
 * calls in order; the route persists the captured lines onto the
 * `CodeExecution.output` column.
 */
export interface SandboxLogger {
  log(message: string): void
  /** Read out the captured lines (called by the engine after handler returns). */
  readonly lines: readonly string[]
}

/**
 * Full API surface assembled by `buildApiSurface()`. Becomes the
 * sandbox global named `crm`. The shape is intentionally simple —
 * handlers feel like calling a plain JS object, no awkward bridge.
 */
export interface CrmApiSurface {
  deals: DealRepository
  contacts: ContactRepository
  log(message: string): void
  readonly context: CodeContext
}

/* ─── Execution shape ─────────────────────────────────────────────────── */

export interface ExecutionInput {
  /** Source code text. Engine compiles once per (orgId, sourceHash). */
  source: string
  /** Pre-built API surface. The engine never touches Prisma directly. */
  api: CrmApiSurface
  /**
   * Logger backing the API surface's `log` method — passed explicitly
   * so the executor can drain captured lines after the handler returns
   * without reflecting on the frozen `crm` global.
   */
  logger: SandboxLogger
  /** Wall-clock cap in ms. Engine hard-caps at 30s regardless. */
  timeoutMs: number
  /** Capped at module.maxLogLines by the caller before passing in. */
  maxLogLines: number
}

export interface ExecutionResult {
  outcome: ExecutionOutcome
  /** Captured `crm.log` lines (truncated to maxLogLines). */
  output: string[]
  /** Stringified handler return value, or null if outcome != "ok". */
  result: string | null
  /** Error message + first stack frame if outcome != "ok". */
  errorMessage: string | null
  durationMs: number
  startedAt: Date
  finishedAt: Date
}

/* ─── SandboxExecutor — the slice-2 swap point ───────────────────────── */

export interface SandboxExecutor {
  /** Compile + run a module. Returns the captured ExecutionResult.
   * Implementations must never throw — every failure mode maps to an
   * `outcome` and `errorMessage` so the caller has a single happy
   * path. */
  execute(input: ExecutionInput): Promise<ExecutionResult>
}

/** Hard ceiling on per-execution wall clock, irrespective of module config. */
export const ABSOLUTE_TIMEOUT_MS = 30_000
/** Hard ceiling on captured output lines. */
export const ABSOLUTE_MAX_LOG_LINES = 10_000
