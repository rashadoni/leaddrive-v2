const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

function normalizeBaseUrl(value, label) {
  const raw = value?.trim().replace(/\/$/, "") || ""
  if (!raw) throw new Error(`${label} is required`)

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${label} must be an absolute http(s) URL`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain credentials`)
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${label} must contain only an origin`)
  }
  return { baseUrl: parsed.origin, hostname: parsed.hostname }
}

export function requireScreenshotTarget({
  env = process.env,
  baseUrl = "",
  defaultBaseUrl = "",
  localOnly = false,
} = {}) {
  const target = normalizeBaseUrl(baseUrl || env.SCREENSHOT_BASE_URL || defaultBaseUrl, "SCREENSHOT_BASE_URL")
  const isLocal = LOCAL_HOSTNAMES.has(target.hostname)

  if (localOnly && !isLocal) {
    throw new Error("This screenshot script only runs against localhost")
  }
  if (!isLocal && target.baseUrl.startsWith("http:")) {
    throw new Error("Remote screenshot targets must use HTTPS")
  }
  if (!isLocal && env.CONFIRM_REMOTE_SCREENSHOT !== target.hostname) {
    throw new Error(`Set CONFIRM_REMOTE_SCREENSHOT=${target.hostname} to use this authenticated remote screenshot target`)
  }

  return { ...target, isLocal }
}

export function requireScreenshotAuth(options = {}) {
  const target = requireScreenshotTarget(options)
  const env = options.env || process.env
  const email = env.SCREENSHOT_EMAIL?.trim() || ""
  const password = env.SCREENSHOT_PASSWORD || ""

  if (!email || !password) {
    throw new Error("SCREENSHOT_EMAIL and SCREENSHOT_PASSWORD are required")
  }

  return { ...target, email, password }
}
