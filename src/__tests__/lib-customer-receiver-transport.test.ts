import { EventEmitter } from "node:events"
import { request } from "node:https"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseSubmission } from "../lib/integrations/customer-receiver/contract"
import { sendReceiverSubmission, validateReceiverTarget, type ReceiverTarget } from "../lib/integrations/customer-receiver/transport"
import type { ReceiverBinding } from "../lib/integrations/customer-receiver/delivery"

vi.mock("node:https", () => ({ request: vi.fn() }))

const binding: ReceiverBinding = { integrationId: "receiver-1", organizationId: "org-1", environment: "TEST", enabled: true, contractApproved: true }
const target: ReceiverTarget = { ...binding, origin: "https://receiver.customer.invalid", privateIpv4: "10.20.30.40" }
const credentials = { accessToken: "SYNTHETIC_TOKEN_FOR_TEST", certificate: "SYNTHETIC_CERT", privateKey: "SYNTHETIC_KEY", ca: "SYNTHETIC_CA" }
const submission = parseSubmission("customers", {
  schemaVersion: "1.0", eventId: "10000000-0000-4000-8000-000000000001", sourceSystem: "LeadDrive",
  externalId: "customer-1", entityVersion: 1, occurredAt: "2026-10-14T08:00:00Z",
  customer: { type: "legal_entity", name: "DEMO", countryCode: "AZ" },
})
const input = () => ({ binding, organizationId: "org-1", target, credentials, correlationId: "corr-1", submission })

describe("fixed VPN receiving destination", () => {
  it.each(["10.20.30.40", "172.16.0.2", "172.31.255.254", "192.168.1.2"])("accepts explicit private address %s", (privateIpv4) => {
    expect(validateReceiverTarget(binding, { ...target, privateIpv4 }).hostname).toBe("receiver.customer.invalid")
  })
  it.each(["127.0.0.1", "169.254.169.254", "8.8.8.8", "172.32.0.1", "0.0.0.0", "::1", "::ffff:10.0.0.1"])("rejects out-of-profile address %s", (privateIpv4) => {
    expect(() => validateReceiverTarget(binding, { ...target, privateIpv4 })).toThrow()
  })
  it.each(["http://receiver.customer.invalid", "https://receiver.customer.invalid:8443", "https://user:secret@receiver.customer.invalid", "https://receiver.customer.invalid/path", "https://receiver.customer.invalid/?token=secret", "https://receiver.customer.invalid/#fragment", "https://10.20.30.40"])("rejects unsafe origin %s", (origin) => {
    expect(() => validateReceiverTarget(binding, { ...target, origin })).toThrow()
  })
  it("rejects a target from another tenant, integration or environment", () => {
    for (const changed of [{ ...target, organizationId: "org-2" }, { ...target, integrationId: "receiver-2" }, { ...target, environment: "PROD" as const }]) {
      expect(() => validateReceiverTarget(binding, changed)).toThrow()
    }
  })
})

describe("bounded TLS attempt", () => {
  let req: EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
  let response: EventEmitter & { statusCode: number; destroy: ReturnType<typeof vi.fn> }
  let deliverResponse: (value: typeof response) => void

  beforeEach(() => {
    vi.useFakeTimers()
    req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
    response = Object.assign(new EventEmitter(), { statusCode: 202, destroy: vi.fn() })
    vi.mocked(request).mockReset()
    vi.mocked(request).mockImplementation((...args: unknown[]) => {
      deliverResponse = args[1] as typeof deliverResponse
      return req as unknown as ReturnType<typeof request>
    })
  })
  afterEach(() => { vi.useRealTimers() })

  function connected() {
    const socket = new EventEmitter()
    req.emit("socket", socket)
    socket.emit("secureConnect")
  }

  it("pins the private IP while preserving TLS hostname, verification and mTLS", async () => {
    const promise = sendReceiverSubmission(input())
    const options = vi.mocked(request).mock.calls[0][0] as import("node:https").RequestOptions
    expect(options).toMatchObject({ hostname: "receiver.customer.invalid", servername: "receiver.customer.invalid", port: 443,
      method: "PUT", agent: false, rejectUnauthorized: true, minVersion: "TLSv1.2", cert: credentials.certificate, key: credentials.privateKey, ca: credentials.ca })
    const lookup = options.lookup as (host: string, options: { all: boolean }, callback: (...args: unknown[]) => void) => void
    const callback = vi.fn()
    lookup("receiver.customer.invalid", { all: false }, callback)
    expect(callback).toHaveBeenCalledWith(null, "10.20.30.40", 4)
    lookup("receiver.customer.invalid", { all: true }, callback)
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: "10.20.30.40", family: 4 }])
    connected()
    deliverResponse(response)
    response.emit("data", Buffer.from('{"status":"accepted"}'))
    response.emit("end")
    expect(await promise).toEqual({ status: 202, body: '{"status":"accepted"}' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it("does not follow a redirect or send credentials to its destination", async () => {
    const promise = sendReceiverSubmission(input())
    connected()
    response.statusCode = 302
    deliverResponse(response)
    response.emit("end")
    expect((await promise).status).toBe(302)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it("rejects an oversized response and closes the request", async () => {
    const promise = sendReceiverSubmission(input())
    const check = expect(promise).rejects.toThrow("reconcile receipt before retry")
    connected()
    deliverResponse(response)
    response.emit("data", Buffer.alloc(16 * 1024 + 1))
    await check
    expect(req.destroy).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it("enforces the connection deadline", async () => {
    const check = expect(sendReceiverSubmission(input())).rejects.toThrow("transport failed")
    await vi.advanceTimersByTimeAsync(5_000)
    await check
    expect(req.destroy).toHaveBeenCalled()
  })
  it("enforces the total deadline even if the peer keeps the response open", async () => {
    const check = expect(sendReceiverSubmission(input())).rejects.toThrow("transport failed")
    connected()
    deliverResponse(response)
    response.emit("data", Buffer.from("{"))
    await vi.advanceTimersByTimeAsync(30_000)
    await check
    expect(req.destroy).toHaveBeenCalled()
  })
  it("does not expose transport exception text", async () => {
    const check = expect(sendReceiverSubmission(input())).rejects.not.toThrow("PRIVATE_KEY")
    req.emit("error", new Error("PRIVATE_KEY"))
    await check
  })
  it("rejects invalid token headers and tenant mismatch before a socket is created", async () => {
    await expect(sendReceiverSubmission({ ...input(), credentials: { ...credentials, accessToken: "token\r\nForged: header" } })).rejects.toThrow()
    await expect(sendReceiverSubmission({ ...input(), organizationId: "org-2" })).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
