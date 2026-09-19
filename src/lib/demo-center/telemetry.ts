const DEMO_TOKEN_IN_PATH = /(\/demo-access\/)[a-f0-9]{64}/giu

/**
 * Capability URLs are bearer credentials. Scrub them recursively before an
 * error, breadcrumb, span or transaction leaves the process for telemetry.
 */
export function scrubDemoTokens<T>(value: T): T {
  const seen = new WeakSet<object>()

  const scrub = (item: unknown): unknown => {
    if (typeof item === "string") {
      return item.replace(DEMO_TOKEN_IN_PATH, "$1[redacted]")
    }
    if (!item || typeof item !== "object") return item
    if (seen.has(item)) return item
    seen.add(item)

    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index += 1) item[index] = scrub(item[index])
      return item
    }

    const record = item as Record<string, unknown>
    for (const [key, nested] of Object.entries(record)) record[key] = scrub(nested)
    return item
  }

  return scrub(value) as T
}
