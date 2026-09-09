/**
 * Apex engine high-level orchestrator — N3 Phase 5 slice 1.
 *
 * Single entrypoint for the route: takes the module config + DI'd
 * repositories + execution context, builds the API surface, runs the
 * sandbox, returns the captured ExecutionResult. The route persists
 * the result to `CodeExecution`.
 *
 * Pure orchestration — no Prisma, no Next, no env reads. Tests inject
 * a mock executor (or use the real NodeVmExecutor since it has no
 * I/O dependency) + mock repositories.
 */
import { buildApiSurface, createSandboxLogger } from "./api-surface"
import { NodeVmExecutor } from "./node-vm-executor"
import { validateCodeModuleSource } from "./source-guard"
import {
  ABSOLUTE_MAX_LOG_LINES,
  ABSOLUTE_TIMEOUT_MS,
  type CodeContext,
  type ContactRepository,
  type DealRepository,
  type ExecutionResult,
  type SandboxExecutor,
} from "./types"

export interface RunCodeModuleInput {
  source: string
  context: CodeContext
  deals: DealRepository
  contacts: ContactRepository
  timeoutMs: number
  maxLogLines: number
  /** Override the executor — slice 2 swaps for IsolatedVmExecutor. */
  executor?: SandboxExecutor
}

const defaultExecutor: SandboxExecutor = new NodeVmExecutor()

function rejectedExecution(reason: string): ExecutionResult {
  const now = new Date()
  return {
    outcome: "rejected",
    output: [],
    result: null,
    errorMessage: reason,
    durationMs: 0,
    startedAt: now,
    finishedAt: now,
  }
}

/**
 * Slice 1 caveat: if `context.event` contains a Map or Set,
 * `buildApiSurface` throws synchronously and the throw propagates
 * out of `runCodeModule` as an unhandled rejection — the route gets
 * a 500. Slice 2 trigger system MUST validate event-payload shapes
 * upstream (before reaching the engine) so an event-producing
 * subsystem can't crash the executor with a Map.
 */
export async function runCodeModule(input: RunCodeModuleInput): Promise<ExecutionResult> {
  const sourceGuard = validateCodeModuleSource(input.source)
  if (!sourceGuard.ok) {
    return rejectedExecution(sourceGuard.reason ?? "Code module source rejected")
  }

  // Clamp caller-supplied limits to the absolute caps in ONE place so
  // the logger and the executor see the same effective values. Prior
  // version computed the clamp in the executor and threw it away (dead
  // code) while the logger received the raw caller value — drift
  // between defence-in-depth and actual enforcement.
  const effectiveTimeout = Math.min(
    Math.max(1, Math.floor(input.timeoutMs)),
    ABSOLUTE_TIMEOUT_MS
  )
  const effectiveMaxLog = Math.min(
    Math.max(1, Math.floor(input.maxLogLines)),
    ABSOLUTE_MAX_LOG_LINES
  )
  const logger = createSandboxLogger(effectiveMaxLog)
  const api = buildApiSurface({
    deals: input.deals,
    contacts: input.contacts,
    logger,
    context: input.context,
  })
  const executor = input.executor ?? defaultExecutor
  return executor.execute({
    source: input.source,
    api,
    logger,
    timeoutMs: effectiveTimeout,
    maxLogLines: effectiveMaxLog,
  })
}
