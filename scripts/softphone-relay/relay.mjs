#!/usr/bin/env node
/**
 * The joining program: one browser, one telephone call, met in the middle.
 *
 * A salesperson clicks call. Their browser opens a socket here and PARKS —
 * "I am ready, and I hold a ticket for call X". Only then does the CRM ask the
 * PBX to dial the customer. When the customer answers, the PBX hands that
 * call's audio to a small listener beside it, which dials OUT to this program
 * and says "I am call X". From that moment the two are one call.
 *
 * Three properties are load-bearing, and each exists because of a specific way
 * this could go wrong:
 *
 * 1. THE PBX IS NEVER CALLED. It calls out, exactly as it already calls out to
 *    Google for the AI voice. Nothing on the telephony network becomes
 *    reachable from the internet, which is the property that is easy to give
 *    away and very hard to get back.
 *
 * 2. THIS PROGRAM CANNOT MINT A TICKET. It has no signing secret; it asks the
 *    CRM who a browser is. So a relay that is compromised — and it is the most
 *    exposed process in the system — cannot join itself to a call it was not
 *    given.
 *
 * 3. IT NEVER WRITES CALL OUTCOMES. The PBX stays the only source of truth for
 *    what happened on a call. A relay that reported "answered" would be a
 *    second, more confident opinion competing with the recorded one, and the
 *    post-call analysis eats whatever it is told.
 *
 * WHERE IT RUNS. Deliberately placeable. Measured on 2026-08-23: the public CRM
 * host is ~76 ms round trip from both the office and the PBX (it is abroad),
 * while office and PBX are 8 ms apart. Running one instance beside the PBX for
 * people in the office and one on the public host for people outside is the
 * difference between a natural conversation and a laggy one.
 *
 * Run:  SOFTPHONE_RELAY_SECRET=... CRM_ORIGIN=https://... node relay.mjs
 */

import { createServer } from "node:http"
import { createServer as createTcpServer } from "node:net"
import { timingSafeEqual } from "node:crypto"
import { WebSocketServer } from "ws"

const PORT = Number(process.env.SOFTPHONE_RELAY_PORT || 8095)
const CRM_ORIGIN = process.env.CRM_ORIGIN || ""
const RELAY_SECRET = process.env.SOFTPHONE_RELAY_SECRET || ""
const PBX_SECRET = process.env.SOFTPHONE_PBX_SECRET || ""
const PBX_PORT = Number(process.env.SOFTPHONE_PBX_PORT || 8096)
// Beside the PBX this is a private address; on the public host the port is
// reached only through the tunnel the station opens, never from the internet.
const PBX_BIND = process.env.SOFTPHONE_PBX_BIND || "127.0.0.1"
// The browser half is loopback too, and for the same reason the PBX half is.
//
// It was left to Node's default, which binds every interface — so the first
// deploy that started this process put a plain ws:// endpoint on the public
// internet. Nothing was exploitable through it: a socket without a valid,
// server-signed, thirty-second ticket is refused. But a browser on an https
// page cannot open a ws:// socket anyway, so a public bind never served a
// single legitimate connection; it only offered strangers something to knock
// on. The real path in is wss:// through the CRM's own TLS front door, which
// proxies to this port on loopback.
//
// Overridable for a deployment that terminates TLS somewhere else, and for
// tests that need an ephemeral bind.
const BROWSER_BIND = process.env.SOFTPHONE_RELAY_BIND || "127.0.0.1"

/**
 * A browser waits this long for its partner: it parks before the customer's
 * phone even rings, so its wait is the whole ringing time.
 */
const PAIR_TIMEOUT_MS = Number(process.env.SOFTPHONE_PAIR_TIMEOUT_MS || 120_000)
/**
 * The station waits a fraction of that, because its wait is nothing like the
 * browser's. It arrives when the customer ANSWERS, by which point the browser
 * has been parked for the entire ring — so if nobody is there, nobody is
 * coming. Measured under the old symmetric timeout: a customer who said hello
 * was held on an answered, silent line for 119 seconds before anything
 * released the channel.
 */
const PBX_PAIR_TIMEOUT_MS = Number(process.env.SOFTPHONE_PBX_PAIR_TIMEOUT_MS || 5_000)
/** Silence from a paired socket for this long means the call is gone. */
const IDLE_TIMEOUT_MS = Number(process.env.SOFTPHONE_IDLE_TIMEOUT_MS || 30_000)
/**
 * How much unsent audio may pile up toward one side before frames are dropped.
 *
 * 8000 bytes is half a second at 8 kHz 16-bit. Without a ceiling, a momentary
 * stall becomes PERMANENT one-way delay: nothing on this path ever discards, so
 * a two-second hiccup stays two seconds behind for the rest of the call —
 * Asterisk consumes at exactly fifty frames a second and never catches up.
 * Dropping costs a syllable once; not dropping costs every syllable after it.
 */
const MAX_BACKLOG_BYTES = 8_000

/**
 * Calls waiting for their second half.
 *
 * Keyed by the CRM's call id. A browser arrives with a ticket the CRM turns
 * into that id; the PBX arrives already knowing it, because ARI put it on the
 * channel before dialling. Neither side chose the value for itself, which is
 * what makes it usable as the rendezvous.
 */
const waiting = new Map()

/**
 * Calls already joined by a browser, so a second one cannot take the line.
 *
 * Keyed on the CALL, never on the ticket string. Round one keyed it on the
 * string and that gave nothing: the CRM's reader decodes base64url leniently,
 * so appending a single "=" is a different string that verifies as the same
 * ticket — proven, not theorised. The call id is what the ticket is ABOUT, and
 * two tickets for one call are one claim however they are spelled.
 *
 * In memory on purpose: a claim lives as long as a call. Running two relays for
 * the SAME audience would need this shared — running one per location does not,
 * because a browser only ever presents its ticket to the relay it was sent to.
 *
 * This is a CONCURRENCY claim, not a register of spent tickets. The entry is
 * released when the browser's socket closes, so the same ticket string is
 * accepted again afterwards — the file elsewhere claimed the relay "remembers
 * the tickets it has spent", and it does not. What actually bounds replay is
 * the ticket's own thirty-second expiry, checked by the CRM. Said plainly here
 * because a comment that overstates a defence is worse than no comment: it
 * stops the next reader from adding the one that is missing.
 */
// Map rather than Set so a close event from a replaced stale socket cannot
// delete the newer browser's claim. The random DB token identifies one claim
// incarnation without treating the ticket spelling as identity.
const joinedCalls = new Map()

const CORRELATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CLAIM_TOKEN = CORRELATION_ID
const MAX_INTERNAL_BODY_BYTES = 1_024

function log(event, detail = {}) {
  // Never the ticket, never a phone number, never audio. The call id is the
  // only correlator, and it is already in the CRM's own logs.
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), event, ...detail }) + "\n")
}

function closeQuietly(socket, code, reason) {
  try {
    socket.close(code, reason)
  } catch {
    // A socket that is already gone needs no closing.
  }
}

/** Ask the CRM who this browser is. The relay has no way to answer it itself. */
async function verifyTicket(ticket) {
  if (!CRM_ORIGIN || !RELAY_SECRET) return null
  try {
    const response = await fetch(`${CRM_ORIGIN}/api/internal/softphone/verify-ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-secret": RELAY_SECRET },
      body: JSON.stringify({ ticket }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Join two sockets into one call.
 *
 * Audio is forwarded frame for frame with no buffering of our own: the browser
 * already has a jitter buffer that grows with the answer, and a second buffer
 * here would add delay to a path whose whole design is about not adding any.
 */
function pair(callId, browser, pbx) {
  log("paired", { callId })
  let lastTraffic = Date.now()
  // Bytes each half SENT, so a call that ends in silence says which one was
  // silent. Without this an idle teardown is the same line whether the
  // salesperson's microphone was mute, the station never got media, or the
  // pairing itself was wrong — three different faults, one indistinguishable
  // log. Measured on 2026-08-25: a real call paired and then timed out idle,
  // and the log could not say which side had failed to speak.
  const sent = { browser: 0, pbx: 0 }
  // Silence is measured PER SIDE. A single clock refreshed by whoever spoke
  // last cannot see a half-dead call: when the salesperson's laptop sleeps its
  // socket stays open and simply stops sending, while the customer keeps
  // talking — and every word they say refreshed the very timer meant to notice
  // that nobody is listening. Measured: the customer stayed on an answered,
  // silent line indefinitely. Both halves send continuously while alive (the
  // capture worklet emits every 20 ms whether or not anyone speaks, and
  // Asterisk likewise), so per-side silence is a real signal, not a guess.
  const lastFrom = { browser: Date.now(), pbx: Date.now() }
  const dropped = { browser: 0, pbx: 0 }

  const forward = (from, to, side) => {
    from.on("message", (data, isBinary) => {
      lastTraffic = Date.now()
      lastFrom[side] = lastTraffic
      // The first frame from each side is the interesting one: it proves that
      // half is alive and carrying. Everything after it is the same news.
      if (sent[side] === 0) log("first_audio", { callId, side })
      sent[side] += data?.length ?? 0
      if (to.readyState !== to.OPEN) return
      // Drop rather than queue once the far side is behind. Nothing downstream
      // ever discards — the station re-frames everything it holds and Asterisk
      // consumes at exactly fifty frames a second — so an unbounded queue turns
      // a momentary stall into permanent one-way delay for the rest of the
      // call. One lost syllable is cheaper than every later one arriving late.
      if ((to.bufferedAmount ?? 0) > MAX_BACKLOG_BYTES) {
        if (dropped[side] === 0) log("backlog_dropping", { callId, side })
        dropped[side] += 1
        return
      }
      to.send(data, { binary: isBinary })
    })
  }
  forward(browser, pbx, "browser")
  forward(pbx, browser, "pbx")
  // The station half was paused when it parked, because its wait is measured in
  // milliseconds and those bytes are the customer's first word. Release it now.
  // The browser half was never paused: its wait is the whole ringing time, and
  // holding that would deliver a minute of speech as one burst.
  pbx.resume?.()

  const idle = setInterval(() => {
    const now = Date.now()
    // Either half going quiet ends the call, because a call with one live half
    // is not a call — it is a customer talking to nobody, which is the exact
    // thing this feature exists to prevent.
    const quiet = now - lastFrom.browser > IDLE_TIMEOUT_MS
      ? "browser"
      : now - lastFrom.pbx > IDLE_TIMEOUT_MS
        ? "pbx"
        : null
    if (quiet) {
      log("idle_timeout", { callId, side: quiet })
      teardown("idle")
    }
  }, 5_000)

  let torn = false
  function teardown(reason) {
    if (torn) return
    torn = true
    clearInterval(idle)
    // Byte counts, not audio: how much each half carried, so "unpaired" is a
    // diagnosis rather than an observation.
    log("unpaired", {
      callId,
      reason,
      sentByBrowser: sent.browser,
      sentByPbx: sent.pbx,
      // Non-zero means the far side could not keep up and audio was discarded
      // to keep the call in the present. Silent dropping is how a fixable
      // network problem becomes "the line was bad".
      droppedFromBrowser: dropped.browser,
      droppedFromPbx: dropped.pbx,
    })
    // Both halves end together. A browser left holding a live socket after the
    // customer hung up looks to the salesperson exactly like a working call.
    closeQuietly(browser, 1000, "call ended")
    closeQuietly(pbx, 1000, "call ended")
  }

  browser.on("close", () => teardown("browser_closed"))
  pbx.on("close", () => teardown("pbx_closed"))
  browser.on("error", () => teardown("browser_error"))
  pbx.on("error", () => teardown("pbx_error"))
}

/**
 * Park a half until the other arrives.
 *
 * Whoever is second does the joining. The timeout matters: a browser whose call
 * never connects must be released rather than held open forever, or a crashed
 * tab leaves a socket and a lead behind it.
 */
function park(callId, side, socket, metadata = {}) {
  const existing = waiting.get(callId)
  if (existing && existing.side !== side) {
    clearTimeout(existing.timer)
    waiting.delete(callId)
    const browser = side === "browser" ? socket : existing.socket
    const pbx = side === "pbx" ? socket : existing.socket
    pair(callId, browser, pbx)
    return
  }
  if (existing) {
    // The same side twice is either a reconnect or an impostor. The newcomer
    // loses: the socket already parked may be a live call in progress.
    log("duplicate_side", { callId, side })
    closeQuietly(socket, 4409, "already parked")
    return
  }
  const timer = setTimeout(() => {
    if (waiting.get(callId)?.socket === socket) {
      waiting.delete(callId)
      log("pair_timeout", { callId, side })
      closeQuietly(socket, 4408, "no partner")
    }
    // The station's wait is not the browser's. It arrives when the customer has
    // ALREADY answered, so every second here is a second of live silence in a
    // real person's ear; the browser's wait is the ringing, which is supposed
    // to be long. One constant for both meant an answered customer was held for
    // 119 seconds with nobody on the other end.
  }, side === "pbx" ? PBX_PAIR_TIMEOUT_MS : PAIR_TIMEOUT_MS)
  waiting.set(callId, { side, socket, timer, ...metadata })
  log("parked", { callId, side })
  socket.on("close", () => {
    if (waiting.get(callId)?.socket === socket) {
      clearTimeout(timer)
      waiting.delete(callId)
      log("unparked", { callId, side })
    }
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function relayAuthorized(req) {
  if (!RELAY_SECRET || RELAY_SECRET.length < 32) return false
  const header = req.headers["x-relay-secret"]
  const received = Array.isArray(header) ? "" : header || ""
  const left = Buffer.from(received)
  const right = Buffer.from(RELAY_SECRET)
  return left.length === right.length && timingSafeEqual(left, right)
}

function browserReady(correlationId, claimToken) {
  const parked = waiting.get(correlationId)
  const joined = joinedCalls.get(correlationId)
  return joined?.socket === parked?.socket
    && joined?.claimToken === claimToken
    && parked?.side === "browser"
    && parked?.claimToken === claimToken
    && parked.socket.readyState === parked.socket.OPEN
}

function handleBrowserReady(req, res) {
  if (!relayAuthorized(req)) {
    sendJson(res, 401, { error: "unauthorized" })
    return
  }

  let body = ""
  let tooLarge = false
  req.setEncoding("utf8")
  req.on("data", (chunk) => {
    if (tooLarge) return
    body += chunk
    if (Buffer.byteLength(body, "utf8") > MAX_INTERNAL_BODY_BYTES) {
      tooLarge = true
      body = ""
    }
  })
  req.on("end", () => {
    if (tooLarge) {
      sendJson(res, 400, { error: "invalid_request" })
      return
    }
    let correlationId = ""
    let claimToken = ""
    try {
      const parsed = JSON.parse(body || "{}")
      correlationId = parsed.correlationId
      claimToken = parsed.claimToken
    } catch {
      correlationId = ""
      claimToken = ""
    }
    if (
      typeof correlationId !== "string"
      || !CORRELATION_ID.test(correlationId)
      || typeof claimToken !== "string"
      || !CLAIM_TOKEN.test(claimToken)
    ) {
      sendJson(res, 400, { error: "invalid_request" })
      return
    }
    sendJson(res, 200, { ready: browserReady(correlationId, claimToken) })
  })
  req.on("error", () => {
    if (!res.headersSent) sendJson(res, 400, { error: "invalid_request" })
  })
}

const server = createServer((req, res) => {
  // One unauthenticated route, and it says nothing about the tenant: an
  // operator needs to know the process is alive without being told who uses it.
  if (req.url === "/healthz") {
    sendJson(res, 200, { ok: true, waiting: waiting.size })
    return
  }
  const pathname = new URL(req.url || "/", "http://relay.invalid").pathname
  if (pathname === "/internal/browser-ready" && req.method === "POST") {
    handleBrowserReady(req, res)
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ noServer: true })

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://relay.invalid")
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url, req))
})

async function onConnection(ws, url, req) {
  if (url.pathname === "/browser") {
    const raw = url.searchParams.get("ticket") || ""
    const parts = raw.split(".")
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      log("browser_rejected", {})
      closeQuietly(ws, 4401, "unauthorized")
      return
    }
    // A socket can die DURING the verification round trip below, and that is
    // not a corner case: the CRM is a network hop away (~76 ms measured, and
    // this call waits up to five seconds), while closing the tab, pressing
    // hang up, or dropping wifi all take one packet.
    //
    // `ws` emits 'close' exactly once, so a listener attached after the await
    // never hears it. The dead socket was then parked, the answered customer
    // was paired to it, and NOTHING could end that call: pair()'s close
    // listeners were also attached too late, the pair timeout had been cleared
    // by pairing, and the idle sweep was refreshed by every frame the customer
    // spoke. Measured: 138 seconds of a customer's voice accepted and dropped,
    // zero bytes back, released only when they hung up themselves.
    let closedWhileVerifying = false
    const noteEarlyClose = () => { closedWhileVerifying = true }
    ws.once("close", noteEarlyClose)

    const claims = await verifyTicket(raw)

    ws.off("close", noteEarlyClose)
    if (!claims) {
      log("browser_rejected", {})
      closeQuietly(ws, 4401, "unauthorized")
      return
    }
    const callId = claims.correlationId || claims.callLogId
    const claimToken = typeof claims.claimToken === "string" && CLAIM_TOKEN.test(claims.claimToken)
      ? claims.claimToken
      : null
    // Checked here, before anything is claimed or parked: a socket that is
    // already gone must never become half of a call.
    if (closedWhileVerifying || ws.readyState !== ws.OPEN) {
      log("browser_gone_before_pairing", { callId })
      closeQuietly(ws, 4400, "gone")
      return
    }
    // Check and claim in ONE synchronous step, after the await rather than
    // across it. Round one tested before the round trip and added after it, so
    // two sockets opened in the same instant both passed — reproduced, not
    // imagined. Nothing may suspend between these two lines.
    let joined = joinedCalls.get(callId)
    if (joined) {
      let parked = waiting.get(callId)
      const replacementCandidate = Boolean(
        claimToken
        && joined.claimToken
        && joined.claimToken !== claimToken
        && joined.socket === parked?.socket
        && parked?.side === "browser",
      )
      if (!replacementCandidate) {
        log("call_already_joined", { callId })
        closeQuietly(ws, 4409, "already joined")
        return
      }

      // The first verification response may have been produced before this
      // claim expired and arrive AFTER its replacement has already parked.
      // A different random token says only "different", never "newer". Ask
      // the database again on the takeover path, then re-read the in-memory
      // state after that await. This makes a delayed stale response lose while
      // still allowing the actual current DB claimant to evict a parked stale
      // browser. There is deliberately no await between this second proof and
      // the replacement below.
      const currentClaims = await verifyTicket(raw)
      const stillCurrent = Boolean(
        currentClaims
        && currentClaims.correlationId === callId
        && currentClaims.claimToken === claimToken,
      )
      if (!stillCurrent || ws.readyState !== ws.OPEN) {
        log("stale_browser_rejected", { callId })
        closeQuietly(ws, 4409, "already joined")
        return
      }

      joined = joinedCalls.get(callId)
      parked = waiting.get(callId)
      if (!joined) {
        // The old browser disappeared during revalidation. There is nothing
        // left to evict; the current claimant can park normally below.
      } else if (
        !joined.claimToken
        || joined.claimToken === claimToken
        || joined.socket !== parked?.socket
        || parked?.side !== "browser"
      ) {
        log("call_already_joined", { callId })
        closeQuietly(ws, 4409, "already joined")
        return
      } else {
      // A newer DB claim may replace only a browser that is still PARKED. Once
      // a PBX half has paired, waiting has no entry and the live call is never
      // evicted, even if a delayed lifecycle callback leaves DB state behind.
        clearTimeout(parked.timer)
        waiting.delete(callId)
        joinedCalls.delete(callId)
        log("stale_browser_replaced", { callId })
        closeQuietly(joined.socket, 4410, "claim replaced")
      }
    }
    joinedCalls.set(callId, { socket: ws, claimToken })
    // A parked browser waits while the customer's phone rings — up to two
    // minutes — and pausing it would queue every word the salesperson says in
    // that time into a burst on connect. The station's window is milliseconds,
    // so only IT is paused; here we discard until there is somewhere to send.
    ws.on("close", () => {
      if (joinedCalls.get(callId)?.socket === ws) joinedCalls.delete(callId)
    })
    park(callId, "browser", ws, { claimToken })
    return
  }

  closeQuietly(ws, 4404, "unknown path")
}

/**
 * The PBX side speaks TCP, not WebSocket, and that is deliberate.
 *
 * The station has no websocket library for Python, and installing one on a
 * production PBX to carry audio is a dependency nobody should take. Both ends
 * of this hop are our own code, so it needs no handshake: one authentication
 * line, then raw 8 kHz mono 16-bit PCM — the telephone's own rate, resampled
 * nowhere along the way so no quality is invented and none is lost twice.
 *
 * The bridge beside the PBX is what strips AudioSocket's framing and puts it
 * back, which keeps this program a byte pump and keeps the browser talking the
 * same plain PCM its audio worklets already speak.
 */
const AUTH_LINE = /^AUTH ([A-Za-z0-9._-]{32,200}) ([0-9a-fA-F-]{8,64})\n$/

function pbxSocketAdapter(socket) {
  // The pairing code speaks the WebSocket shape. Rather than teach it two
  // vocabularies, the TCP socket is dressed in the three methods it uses.
  const adapter = {
    OPEN: 1,
    get readyState() {
      return socket.destroyed ? 3 : 1
    },
    // What has been handed to the kernel but not yet written. The pump reads
    // this to decide when the station is behind and audio must be dropped
    // rather than queued; a WebSocket calls the same thing bufferedAmount.
    get bufferedAmount() {
      return socket.writableLength
    },
    send(data) {
      if (!socket.destroyed) socket.write(data)
    },
    close() {
      // A half-close is not an end. `end()` sends FIN but leaves the socket
      // readable, and the station's bridge keeps reading Asterisk and writing
      // into it — measured: 208 consecutive frames accepted over five seconds
      // with no error. The answered customer stays on a live silent line, which
      // is the very defect this feature exists to remove. Destroy it, so the
      // station's next write fails, its AudioSocket closes, and Asterisk hangs
      // the channel up.
      socket.end()
      socket.destroy()
    },
    on(event, handler) {
      if (event === "message") socket.on("data", (chunk) => handler(chunk, true))
      else socket.on(event === "close" ? "close" : event, handler)
      return adapter
    },
    resume() {
      socket.resume()
    },
  }
  return adapter
}

const pbxServer = createTcpServer((socket) => {
  socket.setNoDelay(true)
  let authenticated = false
  let buffer = Buffer.alloc(0)

  const onFirstData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    const newline = buffer.indexOf(0x0a)
    if (newline === -1) {
      // A peer that never sends a line is a port scanner, not the bridge.
      if (buffer.length > 512) socket.destroy()
      return
    }
    const line = buffer.subarray(0, newline + 1).toString("ascii")
    const match = AUTH_LINE.exec(line)
    if (!match || !PBX_SECRET || match[1] !== PBX_SECRET) {
      log("pbx_rejected", {})
      socket.destroy()
      return
    }
    authenticated = true
    socket.off("data", onFirstData)
    const rest = buffer.subarray(newline + 1)
    buffer = Buffer.alloc(0)
    // Audio that arrived in the same packet as the auth line still belongs to
    // the call; put it back so it is delivered in order once the halves meet.
    if (rest.length > 0) socket.unshift(rest)
    // Hold the stream until there is somewhere to send it. A socket left
    // flowing with no listener does not queue — it DISCARDS, and the window
    // between the station arriving and the browser being verified is exactly
    // where the customer says hello. Found by the end-to-end test.
    socket.pause()
    const adapter = pbxSocketAdapter(socket)
    park(match[2], "pbx", adapter)
  }

  socket.on("data", onFirstData)
  socket.on("error", () => socket.destroy())
  setTimeout(() => {
    if (!authenticated) socket.destroy()
  }, 5_000)
})

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, BROWSER_BIND, () =>
    log("listening", { port: PORT, side: "browser", bind: BROWSER_BIND }))
  pbxServer.listen(PBX_PORT, PBX_BIND, () => log("listening", { port: PBX_PORT, side: "pbx" }))
}

export { browserReady, park, waiting, joinedCalls, pbxServer, PAIR_TIMEOUT_MS }
