/**
 * The PBX may answer an inbound call only after the relay has a verified,
 * living browser parked for that exact call. This starts the real relay but no
 * station bridge and never touches a telephone network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type Server, type ServerResponse } from "node:http"
import net from "node:net"
import { join } from "node:path"
// @ts-expect-error ws is a runtime dependency without bundled declarations in this lockfile.
import { WebSocket } from "ws"

const RELAY = join(process.cwd(), "scripts/softphone-relay/relay.mjs")
const RELAY_SECRET = "r".repeat(48)
const PBX_SECRET = "p".repeat(48)
const CALL_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
const TICKET_A = "Z29vZC10aWNrZXQ.c2lnbmF0dXJl"
const TICKET_B = "bmV3LXRpY2tldA.bmV3LXNpZ25hdHVyZQ"
const CLAIM_A = "11111111-1111-4111-8111-111111111111"
const CLAIM_B = "22222222-2222-4222-8222-222222222222"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms
  let value = await read()
  while (!accept(value) && Date.now() < deadline) {
    await sleep(25)
    value = await read()
  }
  return value
}

let crm: Server
let relay: ChildProcess
let relayPort = 0
let pbxPort = 0
let respondToVerification: (
  ticket: string,
  authorized: boolean,
  response: ServerResponse,
) => void

function finishVerification(
  response: ServerResponse,
  accepted: boolean,
  ticket: string,
): void {
  const claimToken = ticket === TICKET_A
    ? CLAIM_A
    : ticket === TICKET_B
      ? CLAIM_B
      : null
  response.writeHead(accepted ? 200 : 401, { "content-type": "application/json" })
  response.end(JSON.stringify(accepted && claimToken
    ? {
        orgId: "org",
        userId: ticket === TICKET_A ? "user-a" : "user-b",
        callLogId: "call",
        correlationId: CALL_ID,
        claimToken,
      }
    : { error: "invalid_ticket" }))
}

async function closeChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  child.kill()
  await Promise.race([exited, sleep(3_000)])
}

async function ready(claimToken = CLAIM_A, secret = RELAY_SECRET): Promise<{
  status: number
  body: { ready?: boolean; error?: string } | null
}> {
  const response = await fetch(`http://127.0.0.1:${relayPort}/internal/browser-ready`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relay-secret": secret,
    },
    body: JSON.stringify({ correlationId: CALL_ID, claimToken }),
  })
  return {
    status: response.status,
    body: await response.json().catch(() => null) as { ready?: boolean; error?: string } | null,
  }
}

beforeEach(async () => {
  respondToVerification = (ticket, authorized, response) => {
    finishVerification(response, authorized && (ticket === TICKET_A || ticket === TICKET_B), ticket)
  }
  crm = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      let ticket = ""
      try {
        ticket = JSON.parse(body || "{}").ticket
      } catch {
        ticket = ""
      }
      respondToVerification(ticket, req.headers["x-relay-secret"] === RELAY_SECRET, res)
    })
  })
  await new Promise<void>((resolve) => crm.listen(0, "127.0.0.1", resolve))
  const crmPort = (crm.address() as net.AddressInfo).port

  const reserve = () => new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
  relayPort = await reserve()
  pbxPort = await reserve()

  relay = spawn(process.execPath, [RELAY], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      CRM_ORIGIN: `http://127.0.0.1:${crmPort}`,
      SOFTPHONE_RELAY_BIND: "127.0.0.1",
      SOFTPHONE_PBX_BIND: "127.0.0.1",
      SOFTPHONE_RELAY_PORT: String(relayPort),
      SOFTPHONE_PBX_PORT: String(pbxPort),
      SOFTPHONE_RELAY_SECRET: RELAY_SECRET,
      SOFTPHONE_PBX_SECRET: PBX_SECRET,
      SOFTPHONE_PAIR_TIMEOUT_MS: "5000",
    },
    stdio: ["ignore", "ignore", "pipe"],
  })

  const health = async () => {
    try {
      return (await fetch(`http://127.0.0.1:${relayPort}/healthz`)).ok
    } catch {
      return false
    }
  }
  expect(await waitFor(health, Boolean, 10_000)).toBe(true)
})

afterEach(async () => {
  await closeChild(relay)
  await new Promise<void>((resolve) => crm.close(() => resolve()))
})

describe("softphone relay browser readiness", () => {
  it("reports ready only while a verified browser is parked and alive", async () => {
    await expect(ready()).resolves.toEqual({ status: 200, body: { ready: false } })

    const browser = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET_A}`)
    await new Promise<void>((resolve, reject) => {
      browser.once("open", resolve)
      browser.once("error", reject)
    })
    expect(await waitFor(ready, (value) => value.body?.ready === true)).toEqual({
      status: 200,
      body: { ready: true },
    })

    const closed = new Promise<void>((resolve) => browser.once("close", () => resolve()))
    browser.close()
    await closed
    expect(await waitFor(ready, (value) => value.body?.ready === false)).toEqual({
      status: 200,
      body: { ready: false },
    })
  })

  it("hands readiness to a newer claim instead of answering into the stale browser", async () => {
    const stale = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET_A}`)
    await new Promise<void>((resolve, reject) => {
      stale.once("open", resolve)
      stale.once("error", reject)
    })
    expect(await waitFor(() => ready(CLAIM_A), (value) => value.body?.ready === true))
      .toEqual({ status: 200, body: { ready: true } })
    await expect(ready(CLAIM_B)).resolves.toEqual({ status: 200, body: { ready: false } })

    const staleClosed = new Promise<number>((resolve) => stale.once("close", resolve))
    const current = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET_B}`)
    await new Promise<void>((resolve, reject) => {
      current.once("open", resolve)
      current.once("error", reject)
    })

    expect(await waitFor(() => ready(CLAIM_B), (value) => value.body?.ready === true))
      .toEqual({ status: 200, body: { ready: true } })
    await expect(ready(CLAIM_A)).resolves.toEqual({ status: 200, body: { ready: false } })
    await expect(staleClosed).resolves.toBe(4410)
    current.close()
  })

  it("keeps the current browser when an older verification response arrives late", async () => {
    const staleVerification: { release?: () => void } = {}
    let staleRequests = 0
    let currentClaim = CLAIM_A
    respondToVerification = (ticket, authorized, response) => {
      if (ticket === TICKET_A && staleRequests++ === 0) {
        staleVerification.release = () => finishVerification(response, authorized, ticket)
        return
      }
      const token = ticket === TICKET_A ? CLAIM_A : ticket === TICKET_B ? CLAIM_B : null
      finishVerification(response, authorized && token === currentClaim, ticket)
    }

    const stale = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET_A}`)
    await new Promise<void>((resolve, reject) => {
      stale.once("open", resolve)
      stale.once("error", reject)
    })
    expect(await waitFor(async () => staleVerification.release !== undefined, Boolean)).toBe(true)

    currentClaim = CLAIM_B
    const current = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET_B}`)
    await new Promise<void>((resolve, reject) => {
      current.once("open", resolve)
      current.once("error", reject)
    })
    expect(await waitFor(() => ready(CLAIM_B), (value) => value.body?.ready === true))
      .toEqual({ status: 200, body: { ready: true } })

    const firstClosed = Promise.race([
      new Promise<string>((resolve) => stale.once("close", (code: number) => resolve(`stale:${code}`))),
      new Promise<string>((resolve) => current.once("close", (code: number) => resolve(`current:${code}`))),
      sleep(2_000).then(() => "none"),
    ])
    const releaseStale = staleVerification.release
    if (!releaseStale) throw new Error("stale verification was not captured")
    releaseStale()

    await expect(firstClosed).resolves.toBe("stale:4409")
    await expect(ready(CLAIM_B)).resolves.toEqual({ status: 200, body: { ready: true } })
    expect(current.readyState).toBe(WebSocket.OPEN)
    current.close()
  })

  it("never evicts a browser that has already paired with the PBX", async () => {
    const live = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET_A}`)
    await new Promise<void>((resolve, reject) => {
      live.once("open", resolve)
      live.once("error", reject)
    })
    expect(await waitFor(() => ready(CLAIM_A), (value) => value.body?.ready === true))
      .toEqual({ status: 200, body: { ready: true } })
    // Token specificity is load-bearing even before pairing.
    await expect(ready(CLAIM_B)).resolves.toEqual({ status: 200, body: { ready: false } })

    const pbx = net.connect(pbxPort, "127.0.0.1")
    await new Promise<void>((resolve, reject) => {
      pbx.once("connect", resolve)
      pbx.once("error", reject)
    })
    pbx.write(`AUTH ${PBX_SECRET} ${CALL_ID}\n`)
    expect(await waitFor(() => ready(CLAIM_A), (value) => value.body?.ready === false))
      .toEqual({ status: 200, body: { ready: false } })

    const newcomer = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET_B}`)
    const newcomerClosed = new Promise<number>((resolve) => newcomer.once("close", resolve))
    await expect(newcomerClosed).resolves.toBe(4409)
    expect(live.readyState).toBe(WebSocket.OPEN)

    live.close()
    pbx.destroy()
  })

  it("rejects a readiness reader that cannot prove it is the CRM", async () => {
    await expect(ready(CLAIM_A, "wrong-secret")).resolves.toEqual({
      status: 401,
      body: { error: "unauthorized" },
    })
  })
})
