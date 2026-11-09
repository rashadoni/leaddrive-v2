import { describe, expect, it } from "vitest"
import { shouldGreetToday } from "@/components/ai/voice-console"

/**
 * Владелец 2026-11-09: «каждый раз после нажатия и отжатия, а потом снова
 * нажатие, начинает здороваться — это триггерит». Приветствие — раз в день.
 */
function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe("voice greeting", () => {
  it("greets on the first start of the day only", () => {
    const storage = memoryStorage()
    const morning = new Date(2026, 10, 9, 9, 0)
    expect(shouldGreetToday(morning, storage)).toBe(true)
    expect(shouldGreetToday(new Date(2026, 10, 9, 9, 5), storage)).toBe(false)
    expect(shouldGreetToday(new Date(2026, 10, 9, 18, 30), storage)).toBe(false)
  })

  it("greets again the next day", () => {
    const storage = memoryStorage()
    expect(shouldGreetToday(new Date(2026, 10, 9, 23, 59), storage)).toBe(true)
    expect(shouldGreetToday(new Date(2026, 10, 10, 0, 1), storage)).toBe(true)
  })

  it("greets as before when the browser keeps no storage", () => {
    expect(shouldGreetToday(new Date(2026, 10, 9, 9, 0), null)).toBe(true)
    const broken = { getItem: () => { throw new Error("denied") }, setItem: () => {} }
    expect(shouldGreetToday(new Date(2026, 10, 9, 9, 0), broken)).toBe(true)
  })
})
