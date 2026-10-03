import { existsSync, realpathSync } from "node:fs"
import path from "node:path"

export function requireCondition(value, code) {
  if (!value) throw new Error(code)
}

export function validateContext(env, cwd) {
  requireCondition(env.CI === "true" && env.GITHUB_ACTIONS === "true"
    && env.RUNNER_ENVIRONMENT === "github-hosted" && process.platform === "linux", "HOSTED_EPHEMERAL_REQUIRED")
  requireCondition(env.SUPPORT_BACKEND_EVIDENCE === "fresh-postgres-v1", "EXPLICIT_FIXTURE_OPT_IN_REQUIRED")
  requireCondition(env.NODE_ENV !== "production", "PRODUCTION_FORBIDDEN")
  requireCondition(/^[a-f0-9]{40}$/.test(env.SUPPORT_BACKEND_HEAD_SHA || ""), "EXACT_HEAD_REQUIRED")
  requireCondition(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ""), "EXACT_CI_SHA_REQUIRED")
  requireCondition(path.isAbsolute(env.GITHUB_WORKSPACE || "")
    && realpathSync(env.GITHUB_WORKSPACE) === realpathSync(cwd), "CHECKOUT_WORKSPACE_REQUIRED")
  requireCondition(path.isAbsolute(env.RUNNER_TEMP || "") && existsSync(env.RUNNER_TEMP), "RUNNER_TEMP_REQUIRED")
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) {
    requireCondition(!existsSync(path.join(cwd, name)), "ENV_FILE_FORBIDDEN")
  }
  let control
  try { control = new URL(env.SUPPORT_BACKEND_ADMIN_URL) } catch { throw new Error("INVALID_CONTROL_DATABASE") }
  requireCondition(["postgres:", "postgresql:"].includes(control.protocol)
    && control.hostname === "127.0.0.1" && control.username === "postgres"
    && Boolean(control.password) && control.pathname === "/postgres"
    && /^[1-9][0-9]*$/.test(control.port) && Number(control.port) <= 65535
    && !control.search && !control.hash, "DEDICATED_LOOPBACK_POSTGRES_REQUIRED")
  return { control, databaseName: "support_backend_evidence" }
}

// Construct rather than inherit: no SMTP, provider, Redis, webhook, proxy or cloud credentials.
export function childEnvironment(env, additions) {
  return {
    PATH: env.PATH,
    LANG: "C.UTF-8",
    CI: "true",
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    LEADDRIVE_DISABLE_SERVICE_WORKER: "1",
    ...additions,
  }
}
