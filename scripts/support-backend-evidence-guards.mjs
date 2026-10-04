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

export function sanitizedAuthLogEvidence(log) {
  const knownReasons = ["schema_invalid", "principal_rate_limited", "organization_not_found", "no_candidates", "password_mismatch", "organization_inactive"]
  const knownErrors = ["CredentialsSignin", "Configuration", "CallbackRouteError", "AccessDenied", "MissingCSRF", "UntrustedHost", "JWTSessionError", "SessionTokenError"]
  return {
    credentialReasons: knownReasons.filter(reason => log.includes("reason=" + reason)),
    authErrorTypes: knownErrors.filter(kind => log.includes(kind)),
    prismaCodes: [...new Set(log.match(/\bP[12][0-9]{3}\b/g) || [])].sort(),
    permissionDenied: /permission denied/i.test(log),
    rowSecurityRejected: /violates row-level security/i.test(log),
    databaseUnreachable: /Can.t reach database server/i.test(log),
    missingDatabaseObject: /(?:table|relation|column)[^\n]{0,160}does not exist/i.test(log),
    authLoginException: log.includes("[Auth] Login error:"),
  }
}

export function sanitizedRedirectEvidence(actual, expected) {
  const target = new URL(actual), configured = new URL(expected)
  const hostKind = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ? target.hostname : "NON_LOOPBACK"
  return {
    protocol: ["http:", "https:"].includes(target.protocol) ? target.protocol : "OTHER",
    hostKind,
    port: Number(target.port || (target.protocol === "https:" ? 443 : target.protocol === "http:" ? 80 : 0)),
    sameProtocol: target.protocol === configured.protocol,
    sameHostname: target.hostname === configured.hostname,
    samePort: target.port === configured.port,
    pathKind: ["/tickets", "/login", "/api/auth/error"].includes(target.pathname) ? target.pathname : "OTHER",
  }
}

export function loopbackApplicationOrigin(port) {
  requireCondition(Number.isInteger(port) && port >= 1024 && port <= 65535, "INVALID_EPHEMERAL_APP_PORT")
  // NextRequest normalizes numeric loopback hosts to localhost. Use that same
  // canonical hostname throughout cookies, Auth.js and exact-origin evidence.
  return "http://localhost:" + port
}

// Pace synthetic public writes below the unchanged 10/minute IP budget.
// This delays requests only; it never retries mutations or changes server limits.
export function publicPostPacer({ now, sleep, evidence }) {
  let previous = null
  return async (method, route) => {
    if (method !== "POST" || !route.startsWith("/api/v1/public/")) return
    if (previous !== null) {
      const wait = Math.max(0, 6_100 - (now() - previous))
      if (wait) { await sleep(wait); evidence.waitedMs += wait }
    }
    previous = now()
    evidence.requests += 1
  }
}

export function sanitizedRouteLogEvidence(log) {
  const classes = ["PrismaClientValidationError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientInitializationError", "TypeError", "ReferenceError"]
  return {
    macroPostError: log.includes("[ticket-macros POST]"),
    errorClasses: classes.filter(kind => log.includes(kind)),
    unknownArguments: ["category", "details"].filter(field => log.includes("Unknown argument \`" + field + "\`") || log.includes("Unknown argument '" + field + "'")),
    invalidMacroCreate: /Invalid[^\n]{0,180}ticketMacro\.create/.test(log),
    invalidAuditCreate: /Invalid[^\n]{0,180}auditLog\.create/.test(log),
  }
}
