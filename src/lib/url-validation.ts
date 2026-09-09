/**
 * SSRF protection: validates URLs to block requests to private/internal networks.
 */

const PRIVATE_IP_RANGES = [
  /^127\./,                    // Loopback
  /^10\./,                     // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./,               // Class C private
  /^169\.254\./,               // Link-local
  /^0\./,                      // Current network
  /^::1$/,                     // IPv6 loopback
  /^fc00:/i,                   // IPv6 unique local
  /^fe80:/i,                   // IPv6 link-local
  /^fd/i,                      // IPv6 private
]

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",           // AWS/GCP metadata
  "metadata.internal",
]

/**
 * Returns true if the URL points to a private/internal network address.
 */
export function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const hostname = url.hostname.toLowerCase()

    // Block known dangerous hostnames
    if (BLOCKED_HOSTNAMES.includes(hostname)) return true

    // Block private IP ranges
    if (PRIVATE_IP_RANGES.some((re) => re.test(hostname))) return true

    // Block non-HTTP(S) protocols
    if (!["http:", "https:"].includes(url.protocol)) return true

    return false
  } catch {
    // Invalid URL — block it
    return true
  }
}

/**
 * Validates SMTP host — blocks private IPs and dangerous hostnames.
 */
export function isPrivateHost(host: string): boolean {
  const hostname = host.toLowerCase().trim()

  if (BLOCKED_HOSTNAMES.includes(hostname)) return true
  if (PRIVATE_IP_RANGES.some((re) => re.test(hostname))) return true

  return false
}
