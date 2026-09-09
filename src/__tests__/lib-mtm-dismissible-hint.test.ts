import { describe, expect, it } from "vitest"
import { dismissMtmHint, isMtmHintDismissed, mtmHintStorageKey } from "@/lib/mtm/dismissible-hint"

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    data,
  }
}

const throwingStorage = {
  getItem: () => { throw new Error("blocked") },
  setItem: () => { throw new Error("blocked") },
}

describe("dismissible hints (field UX audit C5)", () => {
  it("remembers the choice per viewer and per panel", () => {
    const a = mtmHintStorageKey("visits-guide", "user-1")
    const b = mtmHintStorageKey("visits-guide", "user-2")
    const c = mtmHintStorageKey("operations-guide", "user-1")
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it("is not dismissed until it is", () => {
    const storage = memoryStorage()
    const key = mtmHintStorageKey("visits-guide", "user-1")
    expect(isMtmHintDismissed(storage, key)).toBe(false)
    expect(dismissMtmHint(storage, key)).toBe(true)
    expect(isMtmHintDismissed(storage, key)).toBe(true)
  })

  it("keeps showing the panel when storage refuses to work", () => {
    // Private mode, blocked site data, a locked-down profile. Losing the
    // preference is acceptable; a page that throws while rendering furniture
    // is not.
    const key = mtmHintStorageKey("visits-guide", "user-1")
    expect(() => isMtmHintDismissed(throwingStorage, key)).not.toThrow()
    expect(isMtmHintDismissed(throwingStorage, key)).toBe(false)
    expect(dismissMtmHint(throwingStorage, key)).toBe(false)
    expect(isMtmHintDismissed(null, key)).toBe(false)
    expect(dismissMtmHint(undefined, key)).toBe(false)
  })

  it("treats an anonymous viewer as its own scope rather than everyone's", () => {
    expect(mtmHintStorageKey("visits-guide", null)).toContain(":anonymous:")
    expect(mtmHintStorageKey("visits-guide", null)).not.toBe(mtmHintStorageKey("visits-guide", "user-1"))
  })
})
