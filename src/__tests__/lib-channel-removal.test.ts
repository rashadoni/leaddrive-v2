import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { DISCONNECT_ON_REMOVE_CHANNEL_TYPES, channelRemovalKind } from "@/lib/channels/channel-removal"

// The channel catalog words its remove button and dialog from channelRemovalKind; the DELETE route decides
// what really happens from its own literal list. If they drift, the screen promises the wrong thing again.
describe("channelRemovalKind", () => {
  it("disconnects Meta channels and deletes the rest", () => {
    expect(channelRemovalKind("whatsapp")).toBe("disconnect")
    expect(channelRemovalKind("facebook")).toBe("disconnect")
    expect(channelRemovalKind("instagram")).toBe("disconnect")
    expect(channelRemovalKind("telegram")).toBe("delete")
    expect(channelRemovalKind("sms")).toBe("delete")
    expect(channelRemovalKind(null)).toBe("delete")
  })

  it("deletes a Meta channel that is already switched off, so it can leave the connected list", () => {
    // Owner, 2026-10-27: Zeytun's old «Fanum Sec» WhatsApp, switched off after a new number was connected,
    // offered only «Ayır» — which switched it off again — and never left the list.
    expect(channelRemovalKind("whatsapp", false)).toBe("delete")
    expect(channelRemovalKind("facebook", false)).toBe("delete")
    expect(channelRemovalKind("whatsapp", true)).toBe("disconnect")
  })

  it("matches the list the DELETE route actually disconnects, and the route disconnects only a live row", () => {
    const src = readFileSync("src/app/api/v1/channels/[id]/route.ts", "utf8")
    const match = src.match(/const metaChannel = \[([^\]]+)\]\.includes\(row\.channelType\)/)
    expect(match, "the DELETE route's disconnect list").not.toBeNull()
    const routeList = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
    expect(routeList).toEqual([...DISCONNECT_ON_REMOVE_CHANNEL_TYPES].sort())
    expect(src).toContain("if (metaChannel && row.isActive) {")
  })
})
