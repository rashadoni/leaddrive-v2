/**
 * In the browser: what a form sends as `attribution` — ad click ids and UTM
 * tags from the page address, Meta's and Google's cookies, and the page.
 * The server (./attribution.ts) validates every field; this only gathers.
 *
 * The website snippet built in Settings → Web-to-Lead carries an inline copy
 * of the same rules (it runs on the customer's site, without our bundle).
 */
export function collectAdAttribution(): Record<string, string> {
  if (typeof window === "undefined") return {}
  const out: Record<string, string> = {}
  const params = new URLSearchParams(window.location.search)
  const fromUrl: [string, string][] = [
    ["fbclid", "fbclid"], ["gclid", "gclid"],
    ["utm_source", "utmSource"], ["utm_medium", "utmMedium"], ["utm_campaign", "utmCampaign"],
    ["utm_content", "utmContent"], ["utm_term", "utmTerm"],
  ]
  for (const [param, key] of fromUrl) {
    const value = params.get(param)
    if (value) out[key] = value
  }
  const cookie = (name: string) => document.cookie.split("; ").find((row) => row.startsWith(`${name}=`))?.slice(name.length + 1)
  const fbp = cookie("_fbp")
  const fbc = cookie("_fbc")
  const ga = cookie("_ga")?.match(/^GA\d\.\d\.(\d+\.\d+)$/)?.[1]
  if (fbp) out.fbp = fbp
  if (fbc) out.fbc = fbc
  if (ga) out.gaClientId = ga
  out.pageUrl = window.location.href.split("#")[0]
  return out
}
