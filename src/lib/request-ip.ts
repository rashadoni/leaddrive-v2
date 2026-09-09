/**
 * Resolve the network client that reached our trusted Nginx hop.
 *
 * Nginx overwrites `x-real-ip` with `$remote_addr`, so that header is the only
 * application-level value which a direct caller cannot rotate. When that peer
 * is a Cloudflare address, Cloudflare's `cf-connecting-ip` is the original
 * client. We accept it only in that case; accepting it unconditionally would
 * let a caller that can reach the origin spoof a fresh bucket per request.
 *
 * `x-forwarded-for` is deliberately ignored. The public internet controls at
 * least part of that chain, and the application cannot prove which hop added
 * which entry.
 */

type RequestWithHeaders = { headers: Pick<Headers, "get"> }

// Canonical source: https://www.cloudflare.com/ips/ (verified 2026-08-11).
// A range update is security-sensitive: keep both lists synchronized with it.
const CLOUDFLARE_IPV4_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const

const CLOUDFLARE_IPV6_CIDRS = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const

function parseIpv4(value: string): number | null {
  const parts = value.split(".")
  if (parts.length !== 4) return null

  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    result = result * 256 + octet
  }
  return result >>> 0
}

function parseIpv6(value: string): bigint | null {
  const input = value.toLowerCase()
  if (!/^[0-9a-f:.]+$/.test(input)) return null
  if ((input.match(/::/g) ?? []).length > 1) return null

  const [leftRaw, rightRaw] = input.split("::")
  const left = leftRaw ? leftRaw.split(":") : []
  const right = rightRaw ? rightRaw.split(":") : []

  const expandIpv4Tail = (parts: string[]): string[] | null => {
    if (parts.length === 0 || !parts[parts.length - 1].includes(".")) return parts
    const ipv4 = parseIpv4(parts[parts.length - 1])
    if (ipv4 === null) return null
    return [
      ...parts.slice(0, -1),
      ((ipv4 >>> 16) & 0xffff).toString(16),
      (ipv4 & 0xffff).toString(16),
    ]
  }

  const expandedLeft = expandIpv4Tail(left)
  const expandedRight = expandIpv4Tail(right)
  if (!expandedLeft || !expandedRight) return null

  const hasCompression = input.includes("::")
  const explicitCount = expandedLeft.length + expandedRight.length
  if ((!hasCompression && explicitCount !== 8) || (hasCompression && explicitCount >= 8)) return null

  const groups = hasCompression
    ? [...expandedLeft, ...Array(8 - explicitCount).fill("0"), ...expandedRight]
    : expandedLeft
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null

  let result = BigInt(0)
  for (const group of groups) result = (result << BigInt(16)) + BigInt(`0x${group}`)
  return result
}

function normalizedIp(value: string | null): string | null {
  if (!value) return null
  const candidate = value.trim().replace(/^\[|\]$/g, "")
  if (parseIpv4(candidate) !== null || parseIpv6(candidate) !== null) return candidate.toLowerCase()
  return null
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [networkRaw, prefixRaw] = cidr.split("/")
  const address = parseIpv4(ip)
  const network = parseIpv4(networkRaw)
  const prefix = Number(prefixRaw)
  if (address === null || network === null || prefix < 0 || prefix > 32) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (address & mask) === (network & mask)
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const [networkRaw, prefixRaw] = cidr.split("/")
  const address = parseIpv6(ip)
  const network = parseIpv6(networkRaw)
  const prefix = Number(prefixRaw)
  if (address === null || network === null || prefix < 0 || prefix > 128) return false
  const shift = BigInt(128 - prefix)
  return (address >> shift) === (network >> shift)
}

export function isCloudflareIp(ip: string): boolean {
  if (parseIpv4(ip) !== null) return CLOUDFLARE_IPV4_CIDRS.some((cidr) => ipv4InCidr(ip, cidr))
  if (parseIpv6(ip) !== null) return CLOUDFLARE_IPV6_CIDRS.some((cidr) => ipv6InCidr(ip, cidr))
  return false
}

export function clientIp(req: RequestWithHeaders): string {
  const nginxPeer = normalizedIp(req.headers.get("x-real-ip"))
  if (!nginxPeer) return "unknown"

  if (isCloudflareIp(nginxPeer)) {
    return normalizedIp(req.headers.get("cf-connecting-ip")) ?? nginxPeer
  }

  return nginxPeer
}
