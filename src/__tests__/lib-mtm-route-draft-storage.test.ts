import { describe, expect, it } from "vitest"
import {
  latestRouteDraft,
  routeDraftStorageKey,
  routeDraftStorageKeys,
} from "@/lib/mtm/route-draft-storage"

function fakeStorage(keys: string[]): Pick<Storage, "length" | "key"> {
  return { length: keys.length, key: (index: number) => keys[index] ?? null }
}

describe("route planner draft storage (field UX audit C8)", () => {
  const scope = { orgId: "org-1", viewerKey: "user-1", date: "2026-09-08", agentId: "agent-7" }

  it("identifies a new draft by the day and the agent, nothing else", () => {
    // Opening the same Tuesday from a customer card used to produce a
    // different key, so the same plan existed twice.
    const fromCalendar = routeDraftStorageKey(scope)
    const fromCustomerCard = routeDraftStorageKey({ ...scope })
    expect(fromCalendar).toBe(fromCustomerCard)
    expect(fromCalendar).toContain("new:2026-09-08:agent-7")
  })

  it("keys an existing route by its id", () => {
    expect(routeDraftStorageKey({ ...scope, routeId: "route-9" })).toContain("route:route-9")
  })

  it("persists nothing without a tenant and a viewer", () => {
    expect(routeDraftStorageKey({ ...scope, orgId: null })).toBe("")
    expect(routeDraftStorageKey({ ...scope, viewerKey: undefined })).toBe("")
  })

  it("also finds drafts written under the older, longer key", () => {
    const exact = routeDraftStorageKey(scope)
    const legacy = `${exact}:customer-3:no-contact`
    const keys = routeDraftStorageKeys(fakeStorage([legacy, "unrelated", exact]), scope)
    expect(keys).toContain(exact)
    expect(keys).toContain(legacy)
    expect(keys).not.toContain("unrelated")
  })

  it("gives the newest draft, which is the whole point", () => {
    // The reported case: 09:43 was offered while 15:23 existed.
    const morning = { savedAt: "2026-09-08T09:43:00.000Z", id: "morning" }
    const afternoon = { savedAt: "2026-09-08T15:23:00.000Z", id: "afternoon" }
    expect(latestRouteDraft([morning, afternoon])?.id).toBe("afternoon")
    expect(latestRouteDraft([afternoon, morning])?.id).toBe("afternoon")
  })

  it("skips what it cannot read instead of letting it win", () => {
    const good = { savedAt: "2026-09-08T09:43:00.000Z", id: "good" }
    expect(latestRouteDraft([null, undefined, { savedAt: "not a date", id: "broken" }, good])?.id).toBe("good")
    expect(latestRouteDraft([])).toBeNull()
    expect(latestRouteDraft([{ savedAt: "nonsense", id: "x" }])).toBeNull()
  })
})
