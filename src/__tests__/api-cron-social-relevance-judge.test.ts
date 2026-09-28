import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const deps = vi.hoisted(() => ({
  requireCronAuth: vi.fn(),
  pass: vi.fn(),
}))

vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: deps.requireCronAuth }))
vi.mock("@/lib/social/ai-relevance-judge-pass", () => ({
  judgeAmbiguousAliasRejections: deps.pass,
}))

import { POST } from "@/app/api/cron/social-relevance-judge/route"

/**
 * The judge's pass had no caller at all until 2026-09-28 — the code existed,
 * was tested, and never ran, so nothing was ever restored to a client's feed.
 * This is the caller, and what matters about it is that it is authenticated,
 * bounded, and cannot turn a provider failure into a 500 loop.
 */
function request(): never {
  return new Request("http://localhost/api/cron/social-relevance-judge", { method: "POST" }) as never
}

describe("POST /api/cron/social-relevance-judge", () => {
  it("runs nothing without cron authentication", async () => {
    deps.requireCronAuth.mockReturnValue(new Response("no", { status: 401 }))
    const res = await POST(request())
    expect(res.status).toBe(401)
    expect(deps.pass).not.toHaveBeenCalled()
  })

  it("bounds one tick so it cannot run into the next one", async () => {
    deps.requireCronAuth.mockReturnValue(null)
    deps.pass.mockResolvedValue({ scanned: 3, judged: 3, restored: 1 })

    const before = Date.now()
    const res = await POST(request())
    expect(res.status).toBe(200)
    const [{ deadlineAt }] = deps.pass.mock.calls[0] as [{ deadlineAt: Date }]
    expect(deadlineAt.getTime()).toBeGreaterThan(before)
    expect(deadlineAt.getTime()).toBeLessThanOrEqual(before + 60_000 + 50)
    expect(await res.json()).toMatchObject({ success: true, data: { restored: 1 } })
  })

  it("answers 500 once instead of throwing when the pass fails", async () => {
    deps.requireCronAuth.mockReturnValue(null)
    deps.pass.mockRejectedValue(new Error("db down"))
    const res = await POST(request())
    expect(res.status).toBe(500)
  })
})

describe("the schedule that calls it", () => {
  const installer = readFileSync("scripts/install-resilience-crons.sh", "utf8")

  // Every minute would ask a paid provider about 25 records a minute; the
  // queue is finite and every answered record is stamped, so the only thing a
  // slower schedule delays is how soon a wrongly rejected mention comes back.
  it("runs every fifteen minutes, not every minute", () => {
    expect(installer).toMatch(/\*\/15 \* \* \* \* \$TRIGGER \/api\/cron\/social-relevance-judge/)
  })

  // Without the retirement line the installer would stack a second copy of the
  // schedule on every run.
  it("retires its own previous line before writing it again", () => {
    expect(installer).toMatch(/cron-trigger\\\.sh \\\/api\\\/cron\\\/social-relevance-judge\/ \{ next \}/)
  })
})
