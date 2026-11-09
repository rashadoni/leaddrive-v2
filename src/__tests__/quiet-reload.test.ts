/**
 * The board's reload never paints over an edit still on its way
 * (src/lib/client/quiet-reload.ts): a load that left before the edit landed
 * carries the old value and would flip the card back for a moment.
 */
import { describe, expect, it } from "vitest"
import { quietReloader } from "@/lib/client/quiet-reload"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() }

function board() {
  const loads: ReturnType<typeof deferred<string>>[] = []
  const shown: string[] = []
  const reloader = quietReloader(() => { const d = deferred<string>(); loads.push(d); return d.promise }, (v) => shown.push(v))
  return { reloader, loads, shown }
}

describe("quietReloader", () => {
  it("shows a load when nothing is on its way", async () => {
    const { reloader, loads, shown } = board()
    const done = reloader.load()
    loads[0].resolve("server")
    await done
    expect(shown).toEqual(["server"])
  })

  it("holds back a load that lands while an edit is out, and loads again once the edit is back", async () => {
    const { reloader, loads, shown } = board()
    const edit = deferred<void>()
    const editing = reloader.track(() => edit.promise, false)
    const load = reloader.load()
    loads[0].resolve("before the edit")
    await load
    expect(shown).toEqual([])
    edit.resolve()
    await editing
    await settle()
    expect(loads).toHaveLength(2)
    loads[1].resolve("after the edit")
    await settle()
    expect(shown).toEqual(["after the edit"])
  })

  it("loads once after the last of several edits, not after each", async () => {
    const { reloader, loads } = board()
    const first = deferred<void>()
    const second = deferred<void>()
    const a = reloader.track(() => first.promise, true)
    const b = reloader.track(() => second.promise, true)
    first.resolve()
    await a
    await settle()
    expect(loads).toHaveLength(0)
    second.resolve()
    await b
    await settle()
    expect(loads).toHaveLength(1)
  })

  it("does not load after a quiet edit when no load was held back", async () => {
    const { reloader, loads } = board()
    await reloader.track(async () => "moved", false)
    await settle()
    expect(loads).toHaveLength(0)
  })

  it("still counts an edit that throws", async () => {
    const { reloader, loads, shown } = board()
    await expect(reloader.track(async () => { throw new Error("network") }, true)).rejects.toThrow("network")
    await settle()
    expect(loads).toHaveLength(1)
    loads[0].resolve("server")
    await settle()
    expect(shown).toEqual(["server"])
  })
})
