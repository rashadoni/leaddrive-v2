export interface WatermarkInput {
  timestamp: Date
  agent: { name: string; code: string }
  customer: { name: string } | null
  location: { latitude: number; longitude: number } | null
}

/**
 * Build the 4-line watermark text per docs/mtm-photo-watermark-spec.md §2.
 * Output is deterministic and locale-free — same input produces the same
 * string on any host. Time formatting uses the supplied Date's LOCAL fields
 * (getDate/getHours/...) because the watermark is what the agent sees on
 * their device, where local-time-of-capture is the only meaningful clock.
 */
export function composeWatermarkText(input: WatermarkInput): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const ts = input.timestamp
  const dateLine = `${pad(ts.getDate())}.${pad(ts.getMonth() + 1)}.${ts.getFullYear()} ${pad(ts.getHours())}:${pad(ts.getMinutes())}`

  const agentLine = `${input.agent.name} (#${input.agent.code})`

  const customerLine = input.customer?.name ?? "No customer"

  let gpsLine: string
  if (input.location) {
    const lat = input.location.latitude
    const lng = input.location.longitude
    const latRef = lat >= 0 ? "N" : "S"
    const lngRef = lng >= 0 ? "E" : "W"
    gpsLine = `${Math.abs(lat).toFixed(4)}°${latRef} ${Math.abs(lng).toFixed(4)}°${lngRef}`
  } else {
    gpsLine = "GPS unavailable"
  }

  return [dateLine, agentLine, customerLine, gpsLine].join("\n")
}
