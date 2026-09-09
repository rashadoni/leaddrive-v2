/**
 * Cloudflare DNS API integration for tenant subdomain management.
 * Uses Cloudflare REST API v4 — no npm package needed.
 *
 * Required env vars:
 *   CLOUDFLARE_API_TOKEN — API token with Zone:DNS:Edit permissions
 *   CLOUDFLARE_ZONE_ID — Zone ID for leaddrivecrm.org
 */

const CF_API = "https://api.cloudflare.com/client/v4"

function getConfig() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  const zoneId = process.env.CLOUDFLARE_ZONE_ID
  if (!apiToken || !zoneId) return null
  return { apiToken, zoneId }
}

function headers(apiToken: string) {
  return {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  }
}

interface DnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
}

/**
 * Create a DNS A record for a tenant subdomain.
 * Example: acme.leaddrivecrm.org → 13.140.132.245
 */
export async function createDnsRecord(
  slug: string,
  serverIp?: string
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  const config = getConfig()
  if (!config) {
    return { success: false, error: "Cloudflare not configured (missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID)" }
  }

  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org"
  const ip = serverIp || process.env.SHARED_SERVER_IP || "13.140.132.245"

  try {
    const res = await fetch(`${CF_API}/zones/${config.zoneId}/dns_records`, {
      method: "POST",
      headers: headers(config.apiToken),
      body: JSON.stringify({
        type: "A",
        name: `${slug}.${baseDomain}`,
        content: ip,
        proxied: true,
        ttl: 1, // auto TTL when proxied
      }),
    })

    const data = await res.json()
    if (!data.success) {
      const errMsg = data.errors?.map((e: any) => e.message).join(", ") || "Unknown error"
      console.error(`[DNS] Failed to create record for ${slug}:`, errMsg)
      return { success: false, error: errMsg }
    }

    console.log(`[DNS] Created A record: ${slug}.${baseDomain} → ${ip}`)
    return { success: true, recordId: data.result.id }
  } catch (err: any) {
    console.error("[DNS] Create record error:", err)
    return { success: false, error: err.message }
  }
}

/**
 * Delete DNS record for a tenant subdomain.
 */
export async function deleteDnsRecord(slug: string): Promise<{ success: boolean; error?: string }> {
  const config = getConfig()
  if (!config) {
    return { success: false, error: "Cloudflare not configured" }
  }

  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org"
  const fullName = `${slug}.${baseDomain}`

  try {
    // Find the record first
    const listRes = await fetch(
      `${CF_API}/zones/${config.zoneId}/dns_records?name=${fullName}&type=A`,
      { headers: headers(config.apiToken) }
    )
    const listData = await listRes.json()

    if (!listData.success || !listData.result?.length) {
      return { success: false, error: "DNS record not found" }
    }

    // Delete each matching record
    for (const record of listData.result) {
      await fetch(`${CF_API}/zones/${config.zoneId}/dns_records/${record.id}`, {
        method: "DELETE",
        headers: headers(config.apiToken),
      })
    }

    console.log(`[DNS] Deleted A record: ${fullName}`)
    return { success: true }
  } catch (err: any) {
    console.error("[DNS] Delete record error:", err)
    return { success: false, error: err.message }
  }
}

/**
 * List all tenant DNS records.
 */
export async function listDnsRecords(): Promise<{ success: boolean; records?: DnsRecord[]; error?: string }> {
  const config = getConfig()
  if (!config) {
    return { success: false, error: "Cloudflare not configured" }
  }

  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org"

  try {
    const res = await fetch(
      `${CF_API}/zones/${config.zoneId}/dns_records?type=A&per_page=100`,
      { headers: headers(config.apiToken) }
    )
    const data = await res.json()

    if (!data.success) {
      return { success: false, error: data.errors?.[0]?.message || "Unknown error" }
    }

    // Filter to only subdomain records
    const records = (data.result || []).filter((r: any) =>
      r.name.endsWith(`.${baseDomain}`) && r.name !== baseDomain
    )

    return { success: true, records }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * Check if Cloudflare is configured.
 */
export function isCloudflareConfigured(): boolean {
  return !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID)
}
