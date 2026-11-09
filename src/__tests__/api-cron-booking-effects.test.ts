/**
 * The minute tick of the meetings module runs both of its jobs.
 *
 * Why this exists: the booking agent's deferred turn — its answer on a number
 * the team also answers from a phone — was written, tested and deployed, and
 * then nothing called it. There was no schedule for `/api/cron/whatsapp-deferred-turn`
 * in the installer and none on the host, so on a held number the webhook held
 * the reply, the deferred turn was meant to take it a minute later, and nobody
 * did. Live code, green tests, silence on the number.
 *
 * It rides this tick rather than a schedule of its own because the host
 * already starts fifteen jobs in some minutes, which is the cap
 * `cron-trigger-spread` guards. So what has to be true is simply this: calling
 * this endpoint calls them both, and neither can silence the other.
 */
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const effects = vi.hoisted(() => vi.fn())
const deferred = vi.hoisted(() => vi.fn())

vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: () => null }))
vi.mock("@/lib/booking/effect-worker", () => ({ runBookingEffectWorker: effects }))
vi.mock("@/lib/booking/whatsapp-deferred-turn", () => ({ runWhatsAppDeferredTurnJob: deferred }))

const call = async () => {
  const { POST } = await import("@/app/api/cron/booking-effects/route")
  const response = await POST(new NextRequest("http://localhost/api/cron/booking-effects", { method: "POST" }))
  return { status: response.status, body: await response.json() }
}

describe("the meetings minute tick", () => {
  beforeEach(() => {
    vi.resetModules()
    effects.mockReset().mockResolvedValue({ processed: 2, failedOrganizations: 0 })
    deferred.mockReset().mockResolvedValue({ status: "completed", value: { candidates: 1, answered: 1 } })
  })

  it("runs the effect worker and the deferred booking turn", async () => {
    const { status, body } = await call()

    expect(status).toBe(200)
    expect(effects).toHaveBeenCalledTimes(1)
    expect(deferred).toHaveBeenCalledTimes(1)
    expect(body.data.processed).toBe(2)
    expect(body.data.deferredTurn).toEqual({ status: "completed", value: { candidates: 1, answered: 1 } })
  })

  it("still reports the effects when the deferred turn throws", async () => {
    // The deploy's post-checks read the effects out of this response. An agent
    // that cannot take its turn is a missed answer; losing the effects report
    // would be a red deploy on a healthy production.
    deferred.mockRejectedValue(new Error("model unavailable"))

    const { status, body } = await call()

    expect(status).toBe(200)
    expect(body.data.processed).toBe(2)
    expect(body.data.deferredTurn).toEqual({ status: "failed" })
  })

  it("does not let a failing effect worker hide the deferred turn's own result", async () => {
    effects.mockRejectedValue(new Error("database down"))

    await expect(call()).rejects.toThrow("database down")
    // The turn is not attempted in that case, and must not be: a database that
    // cannot drain effects cannot claim a message either.
    expect(deferred).not.toHaveBeenCalled()
  })
})
