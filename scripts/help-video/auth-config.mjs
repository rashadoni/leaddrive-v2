const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

export function requireHelpVideoAuth(rawBaseUrl, env = process.env) {
  let target
  try {
    target = new URL(rawBaseUrl)
  } catch {
    throw new Error("HELP_VIDEO_BASE_URL must be an absolute http(s) URL")
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error("HELP_VIDEO_BASE_URL must use http or https")
  }
  if (target.username || target.password) {
    throw new Error("HELP_VIDEO_BASE_URL must not contain credentials")
  }
  if (target.pathname !== "/" || target.search || target.hash) {
    throw new Error("HELP_VIDEO_BASE_URL must contain only an origin")
  }

  const isLocal = LOCAL_HOSTNAMES.has(target.hostname)
  if (!isLocal && target.protocol !== "https:") {
    throw new Error("Remote help-video targets must use HTTPS")
  }
  if (!isLocal && env.CONFIRM_REMOTE_HELP_VIDEO !== target.hostname) {
    throw new Error(`Set CONFIRM_REMOTE_HELP_VIDEO=${target.hostname} to authenticate to this remote help-video target`)
  }

  const email = env.HELP_VIDEO_EMAIL?.trim() || ""
  const password = env.HELP_VIDEO_PASSWORD || ""
  const organizationSlug = env.HELP_VIDEO_ORG_SLUG?.trim() || ""
  if (!email || !password || !organizationSlug) {
    throw new Error("HELP_VIDEO_EMAIL, HELP_VIDEO_PASSWORD, and HELP_VIDEO_ORG_SLUG are required")
  }

  return {
    baseUrl: target.origin,
    email,
    password,
    organizationSlug,
    isRemote: !isLocal,
  }
}
