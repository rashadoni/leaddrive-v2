/**
 * Node `vm`-based sandbox executor — N3 Phase 5 slice 1.
 *
 * Compiles tenant source once per source-hash (process-local LRU
 * cache) and runs it in a fresh context per execution. Curated
 * sandbox: only the `crm` API + a small whitelist of safe globals
 * (Date, JSON, Math, Promise, console-to-log bridge). No `process`,
 * `require`, `import`, `fs`, `Buffer`, `setTimeout` — so a handler
 * can't escape the timeout via async tricks.
 *
 * Slice 1 caveat: `node:vm` is NOT a true V8-isolate boundary.
 * Prototype-pollution attacks are still possible by a determined
 * adversary. Slice 2 swaps this for `isolated-vm` (real V8 isolate)
 * — same `SandboxExecutor` interface, different implementation.
 *
 * The handler contract:
 *
 *   exports.handler = async function ({ crm }) {
 *     const deals = await crm.deals.find({ stage: "won" })
 *     crm.log(`found ${deals.length} won deals`)
 *     return { count: deals.length }
 *   }
 *
 * Return values are JSON-stringified for persistence. Anything not
 * JSON-serialisable → `outcome: "rejected"` + `errorMessage`.
 */
import { createHash } from "node:crypto"
import { createContext, Script } from "node:vm"
import type {
  ExecutionInput,
  ExecutionResult,
  SandboxExecutor,
} from "./types"

/**
 * Module-level compile cache. Key: short hash of source. Value: the
 * compiled `vm.Script` ready to bind to a fresh context. Caches
 * survive across executions but never escape the process — restart
 * = cold cache. Slice 2 promotes this to an LRU keyed by (orgId,
 * sourceHash) so misbehaving tenants can't OOM the host.
 */
const compileCache = new Map<string, Script>()
const MAX_CACHE_ENTRIES = 200

function getOrCompile(source: string): Script {
  const key = deriveCacheKey(source)
  const cached = compileCache.get(key)
  if (cached) return cached
  // Wrap source so `module.exports.handler = ...` (CommonJS-style)
  // works. The IIFE returns the populated `module.exports` which
  // the executor reads via the sandbox object.
  const wrapped =
    `(function (module, exports) {\n${source}\nreturn module.exports;\n})(module, exports)`
  const script = new Script(wrapped, { filename: `apex-${key.slice(0, 8)}.js` })
  if (compileCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = compileCache.keys().next().value
    if (firstKey) compileCache.delete(firstKey)
  }
  compileCache.set(key, script)
  return script
}

/**
 * Tiny "invoker" script — runs `module.exports.handler()` inside the
 * sandbox context. Compiled once at module init and reused across all
 * executions (it has no per-source dependency). Running the handler
 * call through `vm.Script.runInContext` is what lets V8's sync timeout
 * break a runaway loop in the handler body — a direct host-side call
 * would skip that protection.
 */
let invokerScriptCache: Script | null = null
function getOrCompileInvoker(): Script {
  if (invokerScriptCache) return invokerScriptCache
  invokerScriptCache = new Script(`module.exports.handler()`, {
    filename: "apex-invoker.js",
  })
  return invokerScriptCache
}

/**
 * SHA-256 hex cache key. We could use a cheaper djb2-style hash here,
 * but in a multi-tenant world a deliberate 32-bit collision could let
 * Tenant A serve compiled bytecode for Tenant B's identical-shape
 * source. SHA-256 is ~10µs per source and eliminates the collision
 * concern entirely; same hash the persistence layer stores on
 * `CodeModule.sourceHash`.
 */
function deriveCacheKey(source: string): string {
  return createHash("sha256").update(source).digest("hex")
}

export class NodeVmExecutor implements SandboxExecutor {
  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const startedAt = new Date()
    // Limits are pre-clamped by `runCodeModule` (engine.ts) — the
    // executor trusts them and uses input.timeoutMs verbatim. The
    // logger's truncation is also pre-configured by the engine.
    const effectiveTimeout = input.timeoutMs

    if (!input.source.trim()) {
      return finalise({
        outcome: "rejected",
        errorMessage: "Empty source",
        startedAt,
        output: [...input.logger.lines],
        result: null,
      })
    }

    let script: Script
    try {
      script = getOrCompile(input.source)
    } catch (e) {
      return finalise({
        outcome: "error",
        errorMessage: formatError(e, "compile"),
        startedAt,
        output: [...input.logger.lines],
        result: null,
      })
    }

    // Build the sandbox: only `crm` + minimal safe globals. `module`
    // and `exports` are the CommonJS-style export receivers. `console`
    // is bridged into `crm.log` so handler `console.log` still works.
    const moduleObj: { exports: { handler?: unknown } } = { exports: {} }
    const sandbox: Record<string, unknown> = {
      crm: input.api,
      module: moduleObj,
      exports: moduleObj.exports,
      console: { log: input.api.log.bind(input.api) },
      JSON,
      Math,
      Date,
      Promise,
      // Deliberately omitted: setTimeout, setInterval, setImmediate,
      // queueMicrotask, process, require, import, Buffer, fetch,
      // globalThis (V8 still exposes a stripped variant — we mask it
      // by NOT adding it to the sandbox; default vm globalThis is the
      // sandbox object itself).
    }
    const context = createContext(sandbox, {
      // Disable eval()/Function()/wasm at the V8 level — best-effort
      // hardening, not equivalent to isolated-vm but raises the bar.
      codeGeneration: { strings: false, wasm: false },
    })

    // First pass: run the module IIFE to populate `module.exports`.
    try {
      script.runInContext(context, {
        timeout: effectiveTimeout,
        displayErrors: true,
      })
    } catch (e) {
      return finalise({
        outcome: errorOutcome(e),
        errorMessage: formatError(e, "module init"),
        startedAt,
        output: [...input.logger.lines],
        result: null,
      })
    }

    const handler = moduleObj.exports.handler
    if (typeof handler !== "function") {
      return finalise({
        outcome: "rejected",
        errorMessage: "Module did not export a `handler` function",
        startedAt,
        output: [...input.logger.lines],
        result: null,
      })
    }

    // Second pass: invoke the handler via a tiny script that runs
    // INSIDE the same context — critical so V8's runInContext timeout
    // breaker catches sync infinite loops in the handler body.
    // (Calling `handler()` directly from the host would bypass V8's
    // sync-execution time check; the host-side rejectAfter timer
    // never fires because a tight sync loop never yields to the
    // event loop.)
    //
    // The invoker returns either the handler's value (sync) or its
    // Promise (async). The host-side race below handles the async
    // never-resolving case. The typecheck above on `handler` already
    // failed the run if no export exists; the invoker script just
    // re-reads `module.exports.handler` from inside the context.
    const invokerScript = getOrCompileInvoker()
    let handlerResultOrPromise: unknown
    try {
      handlerResultOrPromise = invokerScript.runInContext(context, {
        timeout: effectiveTimeout,
        displayErrors: true,
      })
    } catch (e) {
      return finalise({
        outcome: errorOutcome(e),
        errorMessage: formatError(e, "handler"),
        startedAt,
        output: [...input.logger.lines],
        result: null,
      })
    }

    let handlerResult: unknown
    try {
      handlerResult = await Promise.race([
        Promise.resolve(handlerResultOrPromise),
        rejectAfter(effectiveTimeout, "handler"),
      ])
    } catch (e) {
      return finalise({
        outcome: errorOutcome(e),
        errorMessage: formatError(e, "handler"),
        startedAt,
        output: [...input.logger.lines],
        result: null,
      })
    }

    // JSON-serialise the result. Non-serialisable → rejected.
    let resultString: string | null = null
    if (handlerResult !== undefined) {
      try {
        const serialised = JSON.stringify(handlerResult)
        if (serialised === undefined) {
          return finalise({
            outcome: "rejected",
            errorMessage: "Handler result is not JSON-serialisable",
            startedAt,
            output: [...input.logger.lines],
            result: null,
          })
        }
        resultString = serialised
      } catch (e) {
        return finalise({
          outcome: "rejected",
          errorMessage: formatError(e, "result serialisation"),
          startedAt,
          output: [...input.logger.lines],
          result: null,
        })
      }
    }

    return finalise({
      outcome: "ok",
      errorMessage: null,
      startedAt,
      output: [...input.logger.lines],
      result: resultString,
    })
  }
}

function finalise(args: {
  outcome: ExecutionResult["outcome"]
  errorMessage: string | null
  startedAt: Date
  output: string[]
  result: string | null
}): ExecutionResult {
  const finishedAt = new Date()
  return {
    outcome: args.outcome,
    output: args.output,
    result: args.result,
    errorMessage: args.errorMessage,
    durationMs: finishedAt.getTime() - args.startedAt.getTime(),
    startedAt: args.startedAt,
    finishedAt,
  }
}

function errorOutcome(e: unknown): ExecutionResult["outcome"] {
  if (e && typeof e === "object") {
    const err = e as { message?: string; code?: string }
    // Node's vm module throws errors with this specific code when the
    // `runInContext({ timeout })` deadline expires on sync execution.
    if (err.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return "timeout"
    // Match phrases like "Script execution timed out" or "execution timed out"
    // — NOT a bare /timeout/i which would false-positive on "setTimeout is
    // not defined". Word-boundary on "timed out" is the safe signal.
    if (err.message && /\btimed out\b/i.test(err.message)) return "timeout"
  }
  return "error"
}

function formatError(e: unknown, phase: string): string {
  if (e instanceof Error) {
    const first = (e.stack ?? "").split("\n").slice(1, 3).join(" / ").trim()
    return first ? `[${phase}] ${e.message} — ${first}` : `[${phase}] ${e.message}`
  }
  return `[${phase}] ${String(e)}`
}

function rejectAfter(ms: number, phase: string): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Script execution timed out (${phase}, ${ms}ms)`)), ms)
  })
}

/**
 * Test-only: clear the compile cache. Production callers never need
 * this — restart the process. Tests use it to assert cold-cache + warm-
 * cache code paths.
 */
export function _resetCompileCacheForTesting(): void {
  compileCache.clear()
}
