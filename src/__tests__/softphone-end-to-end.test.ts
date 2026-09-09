/**
 * A call's audio, through every real process, in both directions.
 *
 * The unit tests each prove one part in isolation, and every one of them can
 * pass while the parts disagree: a frame size, a byte order, who speaks first.
 * This one starts the ACTUAL relay and the ACTUAL station bridge, plays
 * Asterisk on one end and a browser on the other, and asserts the bytes that
 * come out the far side.
 *
 * Nothing here reaches the station or the CRM. The relay's verification call is
 * answered by a stub in this file, and both peers are sockets on loopback. No
 * call is placed anywhere.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type Server } from "node:http"
import net from "node:net"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { WebSocket } from "ws"

const ROOT = process.cwd()
const RELAY = join(ROOT, "scripts/softphone-relay/relay.mjs")
// The station's half lives in a DIFFERENT repository, checked out beside this
// one here but not necessarily anywhere else. The suite skips rather than fails
// when it is absent, so a machine without the PBX checkout is honest about what
// it did not run instead of reporting a break it cannot have.
const BRIDGE = process.env.FANUM_BRIDGE_PATH || join(ROOT, "..", "fanum-softphone-bridge.py")
const BRIDGE_PRESENT = existsSync(BRIDGE)

const RELAY_SECRET = "r".repeat(48)
const PBX_SECRET = "p".repeat(48)
const CALL_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
// Shaped like a real one: the relay refuses anything that is not exactly
// <payload>.<signature>, because the spent-ticket register is a set of strings
// and a tolerated extra component would replay a ticket already used.
const TICKET = "Z29vZC10aWNrZXQ.c2lnbmF0dXJl"

/** 20 ms of 8 kHz signed-linear mono, the unit both ends actually exchange. */
const FRAME = 320

/** Shortened clocks — see the note where the relay is spawned. */
const PBX_PAIR_MS = 1_000
const IDLE_MS = 2_500

/**
 * How long the stub CRM takes to answer "is this ticket genuine".
 *
 * Zero for most tests. One test raises it, because the window it opens is the
 * one in which a browser can die unseen: the real CRM is a network hop away
 * (~76 ms measured) and the relay allows it up to five seconds.
 */
let crmDelayMs = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(predicate: () => boolean, ms = 5_000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(25)
  }
  return predicate()
}

function audioSocketFrame(kind: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(3)
  header[0] = kind
  header.writeUInt16BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

let crm: Server
let relay: ChildProcess
/** Everything the relay logged, so the test can read its diagnosis. */
let relayOut = ""
let bridge: ChildProcess
let crmPort = 0
// Fresh ports per test. Killing a process is asynchronous, so a fixed port can
// still be held by the previous test's dying relay — and a readiness probe that
// connects to it makes the next test talk to a process whose stub CRM is gone.
let portBase = 18400
let relayPort = 0
let pbxPort = 0
let bridgePort = 0

beforeEach(async () => {
  crmDelayMs = 0
  portBase += 10
  relayPort = portBase
  pbxPort = portBase + 1
  bridgePort = portBase + 2

  // The CRM the relay asks "who is this browser". One ticket is good.
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
      // Padding-tolerant on purpose: this is what the real reader does, and the
      // relay must not depend on the CRM being strict about spelling.
      const ok = req.headers["x-relay-secret"] === RELAY_SECRET
        && typeof ticket === "string"
        && ticket.replace(/=+$/, "") === TICKET
      const answer = () => {
        res.writeHead(ok ? 200 : 401, { "content-type": "application/json" })
        res.end(JSON.stringify(ok
          ? { orgId: "o", userId: "u", callLogId: "c", correlationId: CALL_ID }
          : { error: "invalid_ticket" }))
      }
      if (crmDelayMs > 0) setTimeout(answer, crmDelayMs)
      else answer()
    })
  })
  await new Promise<void>((resolve) => crm.listen(0, resolve))
  crmPort = (crm.address() as net.AddressInfo).port

  relay = spawn("node", [RELAY], {
    env: {
      ...process.env,
      // vitest sets NODE_ENV=test, and the relay deliberately does not listen
      // under it so importing the module in a unit test binds no ports. The
      // child here is the real program and must.
      NODE_ENV: "production",
      SOFTPHONE_RELAY_PORT: String(relayPort),
      SOFTPHONE_PBX_PORT: String(pbxPort),
      SOFTPHONE_RELAY_SECRET: RELAY_SECRET,
      SOFTPHONE_PBX_SECRET: PBX_SECRET,
      CRM_ORIGIN: `http://127.0.0.1:${crmPort}`,
      // Production waits are minutes and half-minutes. The behaviour under
      // test is WHICH side is released and WHEN relative to its partner, not
      // the wall-clock number, so the clocks are shortened rather than waited
      // out — a test that sleeps two minutes gets deleted by the next person
      // in a hurry, and these are the timeouts that strand a live customer.
      SOFTPHONE_PBX_PAIR_TIMEOUT_MS: String(PBX_PAIR_MS),
      SOFTPHONE_IDLE_TIMEOUT_MS: String(IDLE_MS),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  relayOut = ""
  relay.stdout?.on("data", (chunk) => {
    relayOut += String(chunk)
  })
  bridge = spawn("python3", [BRIDGE], {
    env: {
      ...process.env,
      FANUM_SOFTPHONE_RELAY_HOST: "127.0.0.1",
      FANUM_SOFTPHONE_RELAY_PORT: String(pbxPort),
      FANUM_SOFTPHONE_PBX_SECRET: PBX_SECRET,
      FANUM_SOFTPHONE_BIND_PORT: String(bridgePort),
      FANUM_SOFTPHONE_TLS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  // Wait for the real thing rather than a guess at how long it takes: both
  // listeners must accept before a "call" arrives, or the test measures its own
  // startup race instead of the feature.
  const accepts = (port: number) => new Promise<boolean>((resolve) => {
    const probe = net.connect(port, "127.0.0.1")
    probe.on("connect", () => { probe.destroy(); resolve(true) })
    probe.on("error", () => resolve(false))
  })
  const up = await waitFor(async () => true, 0) // keep waitFor's shape honest
  void up
  const deadline = Date.now() + 15_000
  for (;;) {
    if (await accepts(relayPort) && await accepts(pbxPort) && await accepts(bridgePort)) break
    if (Date.now() > deadline) throw new Error("relay or bridge never started")
    await sleep(100)
  }
})

afterEach(async () => {
  // Wait for them to actually be gone. A kill() that is only requested leaves a
  // process holding its ports into the next test.
  const gone = (child: ChildProcess | undefined) => new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null || child.killed === false) {
      // fall through to the listener either way; exit fires once
    }
    if (!child) return resolve()
    if (child.exitCode !== null) return resolve()
    child.once("exit", () => resolve())
    setTimeout(() => resolve(), 3_000)
  })
  bridge?.kill()
  relay?.kill()
  await Promise.all([gone(bridge), gone(relay)])
  await new Promise<void>((resolve) => crm.close(() => resolve()))
})

describe.skipIf(!BRIDGE_PRESENT)("a browser call, end to end", () => {
  it("carries the customer to the browser and the salesperson to the customer", async () => {
    const heardByBrowser: Buffer[] = []
    const browser = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET}`)
    browser.on("message", (data) => heardByBrowser.push(Buffer.from(data as Buffer)))
    await new Promise<void>((resolve, reject) => {
      browser.on("open", () => resolve())
      browser.on("error", reject)
    })

    // Asterisk connects to the station bridge and names the call. This is the
    // id ARI put on the channel before the customer's phone rang, which is what
    // lets the relay find the browser already waiting on it.
    const heardByAsterisk: Buffer[] = []
    const asterisk = net.connect(bridgePort, "127.0.0.1")
    asterisk.on("data", (chunk) => heardByAsterisk.push(chunk))
    await new Promise<void>((resolve, reject) => {
      asterisk.on("connect", () => resolve())
      asterisk.on("error", reject)
    })
    asterisk.write(audioSocketFrame(0x01, Buffer.from(CALL_ID.replace(/-/g, ""), "hex")))

    // The customer speaks.
    asterisk.write(audioSocketFrame(0x10, Buffer.alloc(FRAME, 0x41)))
    expect(await waitFor(() => Buffer.concat(heardByBrowser).length >= FRAME)).toBe(true)
    const fromCustomer = Buffer.concat(heardByBrowser)
    // Raw samples, no AudioSocket header: the browser speaks plain PCM.
    expect(fromCustomer.length).toBe(FRAME)
    expect(fromCustomer.every((b) => b === 0x41)).toBe(true)

    // The salesperson answers.
    browser.send(Buffer.alloc(FRAME, 0x42))
    expect(await waitFor(() => Buffer.concat(heardByAsterisk).length >= FRAME + 3)).toBe(true)
    const toCustomer = Buffer.concat(heardByAsterisk)
    // Framed again on the way back, as one whole 20 ms frame — a short frame is
    // an audible click in someone's ear.
    expect(toCustomer[0]).toBe(0x10)
    expect(toCustomer.readUInt16BE(1)).toBe(FRAME)
    expect(toCustomer.subarray(3, 3 + FRAME).every((b) => b === 0x42)).toBe(true)

    // And the relay says, in its log, that both halves carried.
    //
    // A production call on 2026-08-25 paired and then timed out idle, and the
    // log could not distinguish a mute microphone from a station that never
    // got media from a pairing that was wrong — three faults, one line. These
    // two lines are what make the next one diagnosable, so they are asserted
    // here rather than left to be tidied away as noise.
    expect(await waitFor(() => relayOut.includes('"event":"first_audio"'))).toBe(true)
    expect(relayOut).toContain('"event":"first_audio","callId":"' + CALL_ID + '","side":"pbx"')
    expect(relayOut).toContain('"event":"first_audio","callId":"' + CALL_ID + '","side":"browser"')

    browser.close()
    asterisk.destroy()
  }, 30_000)

  it("refuses a browser the CRM does not vouch for, and never reaches the station", async () => {
    const browser = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=Zm9yZ2Vk.YmFkc2ln`)
    const closed = await new Promise<number>((resolve) => {
      browser.on("close", (code) => resolve(code))
      browser.on("error", () => resolve(-1))
    })
    // 4401: the relay asked the CRM and the CRM said no.
    expect([4401, -1]).toContain(closed)
  }, 20_000)

  it("refuses a station half that cannot prove which station it is", async () => {
    const impostor = net.connect(pbxPort, "127.0.0.1")
    await new Promise<void>((resolve) => impostor.on("connect", () => resolve()))
    impostor.write(`AUTH ${"x".repeat(48)} ${CALL_ID}\n`)

    const ended = await new Promise<boolean>((resolve) => {
      impostor.on("close", () => resolve(true))
      setTimeout(() => resolve(false), 3_000)
    })
    expect(ended).toBe(true)
  }, 20_000)

  it("lets the customer go when the salesperson hangs up", async () => {
    // The defect this feature exists to remove, on the hang-up path. A relay
    // that only half-closes leaves the station reading and writing forever: the
    // answered customer sits on a live silent line until they give up, and the
    // CRM's call record never closes, so nobody can call that lead again.
    const heard: Buffer[] = []
    const browser = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET}`)
    browser.on("message", (data) => heard.push(Buffer.from(data as Buffer)))
    await new Promise<void>((resolve, reject) => {
      browser.on("open", () => resolve())
      browser.on("error", reject)
    })

    let asteriskClosed = false
    const asterisk = net.connect(bridgePort, "127.0.0.1")
    asterisk.on("close", () => { asteriskClosed = true })
    asterisk.on("error", () => { asteriskClosed = true })
    await new Promise<void>((resolve, reject) => {
      asterisk.on("connect", () => resolve())
      asterisk.on("error", reject)
    })
    asterisk.write(audioSocketFrame(0x01, Buffer.from(CALL_ID.replace(/-/g, ""), "hex")))
    // Hang up only once this is demonstrably a LIVE call: audio that reached
    // the browser is proof the halves are joined. Closing before they pair
    // would test a different thing entirely — and pass for the wrong reason.
    asterisk.write(audioSocketFrame(0x10, Buffer.alloc(FRAME, 0x41)))
    expect(await waitFor(() => heard.length > 0, 8_000)).toBe(true)

    browser.close()

    // The station's AudioSocket connection must go too — that is what makes
    // Asterisk hang up the channel and release the customer.
    expect(await waitFor(() => asteriskClosed, 8_000)).toBe(true)
  }, 30_000)

  it("gives one call to one browser, however the ticket is spelled", async () => {
    // Single use belongs to the CALL. Keyed on the ticket STRING it gave
    // nothing: base64url decodes leniently, so one appended "=" is a different
    // string that verifies as the same ticket.
    const first = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET}`)
    await new Promise<void>((resolve, reject) => {
      first.on("open", () => resolve())
      first.on("error", reject)
    })
    await sleep(400)

    const restyled = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET}=`)
    const code = await new Promise<number>((resolve) => {
      restyled.on("close", (value) => resolve(value))
      restyled.on("error", () => resolve(-1))
    })
    // 4409: this call already has a browser on it.
    expect([4409, -1]).toContain(code)

    first.close()
  }, 20_000)

  it("never joins an answered customer to a browser that died while being verified", async () => {
    // The defect this replaces: `ws` emits 'close' once, and the relay attached
    // its close listeners only AFTER awaiting the CRM. A tab closed inside that
    // round trip was never noticed, the dead socket was parked, the answered
    // customer was paired to it, and nothing could end the call — the pair
    // timeout had been cleared by pairing and the idle sweep was refreshed by
    // every frame the customer spoke. Measured before the fix: 138 seconds of a
    // customer's voice accepted and discarded, zero bytes back, released only
    // when they hung up themselves.
    crmDelayMs = 400

    const browser = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET}`)
    await new Promise<void>((resolve, reject) => {
      browser.on("open", () => resolve())
      browser.on("error", reject)
    })
    // Dies while the relay is still waiting on the CRM.
    browser.terminate()

    // The customer answers a moment later, exactly as they would.
    let asteriskClosed = false
    const asterisk = net.connect(bridgePort, "127.0.0.1")
    asterisk.on("close", () => { asteriskClosed = true })
    await new Promise<void>((resolve, reject) => {
      asterisk.on("connect", () => resolve())
      asterisk.on("error", reject)
    })
    await sleep(600)
    asterisk.write(audioSocketFrame(0x01, Buffer.from(CALL_ID.replace(/-/g, ""), "hex")))
    const speaking = setInterval(() => {
      if (!asteriskClosed) asterisk.write(audioSocketFrame(0x10, Buffer.alloc(FRAME, 0x41)))
    }, 20)

    // The customer's channel must be released, not held open in silence.
    const released = await waitFor(() => asteriskClosed, PBX_PAIR_MS + 4_000)
    clearInterval(speaking)
    expect(released).toBe(true)

    expect(relayOut).toContain('"event":"browser_gone_before_pairing"')
    // And it must never have been called a pairing.
    expect(relayOut).not.toContain('"event":"paired"')
    asterisk.destroy()
  }, 20_000)

  it("releases an answered customer quickly when no browser is waiting", async () => {
    // The station arrives only when the customer has ALREADY answered, so every
    // second it waits is a second of live silence in a real person's ear. One
    // timeout served both halves before this, and the browser's is two minutes.
    let asteriskClosed = false
    const asterisk = net.connect(bridgePort, "127.0.0.1")
    asterisk.on("close", () => { asteriskClosed = true })
    await new Promise<void>((resolve, reject) => {
      asterisk.on("connect", () => resolve())
      asterisk.on("error", reject)
    })
    asterisk.write(audioSocketFrame(0x01, Buffer.from(CALL_ID.replace(/-/g, ""), "hex")))

    const released = await waitFor(() => asteriskClosed, PBX_PAIR_MS + 4_000)
    expect(released).toBe(true)
    expect(relayOut).toContain('"event":"pair_timeout"')
    expect(relayOut).toContain('"side":"pbx"')
    asterisk.destroy()
  }, 20_000)

  it("ends the call when the salesperson's half goes quiet, even while the customer talks", async () => {
    // A laptop that sleeps leaves the socket open and simply stops sending.
    // The idle sweep used ONE clock refreshed by whichever side spoke last, so
    // the customer's own voice kept resetting the timer meant to notice that
    // nobody was listening to them.
    const browser = new WebSocket(`ws://127.0.0.1:${relayPort}/browser?ticket=${TICKET}`)
    await new Promise<void>((resolve, reject) => {
      browser.on("open", () => resolve())
      browser.on("error", reject)
    })

    let asteriskClosed = false
    const asterisk = net.connect(bridgePort, "127.0.0.1")
    asterisk.on("close", () => { asteriskClosed = true })
    await new Promise<void>((resolve, reject) => {
      asterisk.on("connect", () => resolve())
      asterisk.on("error", reject)
    })
    asterisk.write(audioSocketFrame(0x01, Buffer.from(CALL_ID.replace(/-/g, ""), "hex")))
    expect(await waitFor(() => relayOut.includes('"event":"paired"'))).toBe(true)

    // The browser sends once and then goes quiet, as a suspended tab does.
    browser.send(Buffer.alloc(FRAME, 0x42))
    // The customer keeps talking the whole time.
    const speaking = setInterval(() => {
      if (!asteriskClosed) asterisk.write(audioSocketFrame(0x10, Buffer.alloc(FRAME, 0x41)))
    }, 20)

    const released = await waitFor(() => asteriskClosed, IDLE_MS + 5_000)
    clearInterval(speaking)
    expect(released).toBe(true)
    expect(relayOut).toContain('"event":"idle_timeout"')
    expect(relayOut).toContain('"side":"browser"')
    asterisk.destroy()
    browser.close()
  }, 25_000)
})
