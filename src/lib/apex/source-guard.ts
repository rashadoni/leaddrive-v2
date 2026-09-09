/**
 * Defence-in-depth guard for tenant-authored Apex code modules.
 *
 * `node:vm` is useful for API-shaping and timeouts, but it is not a
 * complete security boundary for untrusted JavaScript. Until the Apex
 * executor moves to a true isolate, reject source that contains known
 * sandbox-escape primitives or host-runtime access patterns before we
 * compile or run it.
 */

export interface CodeModuleSourceGuardResult {
  ok: boolean
  reason?: string
}

interface ForbiddenPattern {
  label: string
  pattern: RegExp
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  {
    label: "dynamic code generation",
    pattern: /\b(?:eval|Function)\s*\(/,
  },
  {
    label: "constructor escape primitive",
    pattern: /(?:^|[^\w$])(?:constructor\s*\.\s*constructor|[.\[]\s*["']?constructor["']?\s*\]?)/,
  },
  {
    label: "prototype escape primitive",
    pattern: /(?:__proto__|[.\[]\s*["']?prototype["']?\s*\]?)/,
  },
  {
    label: "host runtime access",
    pattern: /\b(?:globalThis|global|process|require|module\.constructor)\b/,
  },
  {
    label: "dynamic import",
    pattern: /\bimport\s*\(/,
  },
  {
    label: "wasm execution",
    pattern: /\bWebAssembly\b/,
  },
  {
    label: "timer or event-loop escape",
    pattern: /\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\b/,
  },
  {
    label: "network or filesystem primitive",
    pattern: /\b(?:fetch|XMLHttpRequest|Buffer|child_process)\b/,
  },
  {
    label: "filesystem module access",
    pattern: /(?:^|[^\w$])fs(?:[^\w$]|$)/,
  },
]

export function validateCodeModuleSource(source: string): CodeModuleSourceGuardResult {
  if (source.trim().length === 0) {
    return { ok: false, reason: "Empty source" }
  }

  const match = FORBIDDEN_PATTERNS.find(({ pattern }) => pattern.test(source))
  if (!match) return { ok: true }

  return {
    ok: false,
    reason: `Code module source rejected: ${match.label} is not allowed in sandboxed automation code`,
  }
}
