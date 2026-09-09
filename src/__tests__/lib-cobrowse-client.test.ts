/**
 * T8 Cobrowse — WebRTC peer wrapper tests.
 *
 * No real RTCPeerConnection — we inject a stub via
 * `peerConnectionFactory`. Tests verify:
 *   - offerer emits SDP offer on connect()
 *   - answerer doesn't emit offer; replies with answer on incoming
 *   - ICE candidates queue before remoteDescription, drain after
 *   - lifecycle events fire on state transitions
 *   - close() is idempotent
 *   - wrong-side offers are ignored (offerer doesn't process "offer"
 *     and vice versa)
 *   - ended payload extraction
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createCobrowsePeer,
  type CobrowseLifecycle,
  type CobrowsePeerOptions,
} from "@/lib/cobrowse/client"
import type { SignalEnvelope } from "@/lib/cobrowse/channels"

// ── Stub RTCPeerConnection ─────────────────────────────────────────
interface StubPC {
  ontrack: ((e: { streams: MediaStream[] }) => void) | null
  onicecandidate: ((e: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | null
  onconnectionstatechange: (() => void) | null
  connectionState: RTCPeerConnectionState
  createOffer: () => Promise<RTCSessionDescriptionInit>
  createAnswer: () => Promise<RTCSessionDescriptionInit>
  setLocalDescription: (d: RTCSessionDescriptionInit) => Promise<void>
  setRemoteDescription: (d: RTCSessionDescriptionInit) => Promise<void>
  addIceCandidate: (c: RTCIceCandidateInit) => Promise<void>
  addTrack: (t: MediaStreamTrack, s: MediaStream) => void
  close: () => void
  /** Test-only helpers. */
  _setConnectionState: (s: RTCPeerConnectionState) => void
  _fireRemoteStream: (s: MediaStream) => void
  _fireLocalIce: (cand: RTCIceCandidateInit) => void
  _addedCandidates: RTCIceCandidateInit[]
  _addedTracks: MediaStreamTrack[]
  _localDesc: RTCSessionDescriptionInit | null
  _remoteDesc: RTCSessionDescriptionInit | null
}

function makeStub(): StubPC & RTCPeerConnection {
  const stub: StubPC = {
    ontrack: null,
    onicecandidate: null,
    onconnectionstatechange: null,
    connectionState: "new",
    createOffer: async () => ({ type: "offer", sdp: "v=offer" }),
    createAnswer: async () => ({ type: "answer", sdp: "v=answer" }),
    setLocalDescription: async function (d) { stub._localDesc = d },
    setRemoteDescription: async function (d) { stub._remoteDesc = d },
    addIceCandidate: async function (c) { stub._addedCandidates.push(c) },
    addTrack: function (t) { stub._addedTracks.push(t) },
    close: () => {},
    _addedCandidates: [],
    _addedTracks: [],
    _localDesc: null,
    _remoteDesc: null,
    _setConnectionState(s) {
      stub.connectionState = s
      stub.onconnectionstatechange?.()
    },
    _fireRemoteStream(s) {
      stub.ontrack?.({ streams: [s] })
    },
    _fireLocalIce(cand) {
      stub.onicecandidate?.({ candidate: { toJSON: () => cand } })
    },
  }
  return stub as unknown as StubPC & RTCPeerConnection
}

function makePeer(role: "offerer" | "answerer", opts: Partial<CobrowsePeerOptions> = {}) {
  const stub = makeStub() as ReturnType<typeof makeStub>
  const sendSignal = vi.fn(async () => {})
  const onLifecycle = vi.fn()
  const peer = createCobrowsePeer({
    role,
    sendSignal,
    onLifecycle,
    peerConnectionFactory: () => stub,
    ...opts,
  })
  return { peer, stub, sendSignal, onLifecycle }
}

// Minimal SignalEnvelope builder.
function env(kind: SignalEnvelope["kind"], payload: unknown, from: "agent" | "customer" = "agent"): SignalEnvelope {
  return { kind, payload, ts: Date.now(), from }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ── offerer ──────────────────────────────────────────────────── */

describe("createCobrowsePeer — offerer", () => {
  it("emits SDP offer on connect()", async () => {
    const { peer, stub, sendSignal } = makePeer("offerer")
    await peer.connect()
    expect(stub._localDesc).toEqual({ type: "offer", sdp: "v=offer" })
    expect(sendSignal).toHaveBeenCalledWith({ kind: "offer", payload: { type: "offer", sdp: "v=offer" } })
  })

  it("emits `connecting` then `connected` on state transition", async () => {
    const { peer, stub, onLifecycle } = makePeer("offerer")
    await peer.connect()
    expect((onLifecycle.mock.calls[0][0] as CobrowseLifecycle).kind).toBe("connecting")
    stub._setConnectionState("connected")
    expect(onLifecycle).toHaveBeenCalledWith(expect.objectContaining({ kind: "connected" }))
  })

  it("emits `error` on connection failed", async () => {
    const { peer, stub, onLifecycle } = makePeer("offerer")
    await peer.connect()
    stub._setConnectionState("failed")
    const errEvents = onLifecycle.mock.calls
      .map((c) => c[0] as CobrowseLifecycle)
      .filter((e) => e.kind === "error")
    expect(errEvents).toHaveLength(1)
  })

  it("processes incoming answer + sets remote description", async () => {
    const { peer, stub } = makePeer("offerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("answer", { type: "answer", sdp: "v=answer-real" }, "customer"))
    expect(stub._remoteDesc).toEqual({ type: "answer", sdp: "v=answer-real" })
  })

  it("ignores incoming `offer` (wrong side)", async () => {
    const { peer, stub } = makePeer("offerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("offer", { type: "offer", sdp: "irrelevant" }, "customer"))
    // _remoteDesc unchanged from null since the wrong-side filter ate it.
    expect(stub._remoteDesc).toBeNull()
  })
})

/* ── answerer ─────────────────────────────────────────────────── */

describe("createCobrowsePeer — answerer", () => {
  it("does NOT emit offer on connect()", async () => {
    const { peer, sendSignal } = makePeer("answerer")
    await peer.connect()
    expect(sendSignal).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "offer" }))
  })

  it("processes incoming offer + emits SDP answer", async () => {
    const { peer, stub, sendSignal } = makePeer("answerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("offer", { type: "offer", sdp: "v=remote" }, "agent"))
    expect(stub._remoteDesc).toEqual({ type: "offer", sdp: "v=remote" })
    expect(stub._localDesc).toEqual({ type: "answer", sdp: "v=answer" })
    expect(sendSignal).toHaveBeenCalledWith({ kind: "answer", payload: { type: "answer", sdp: "v=answer" } })
  })

  it("ignores incoming `answer` (wrong side)", async () => {
    const { peer, stub } = makePeer("answerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("answer", { type: "answer", sdp: "x" }))
    expect(stub._remoteDesc).toBeNull()
  })
})

/* ── ICE handling ────────────────────────────────────────────── */

describe("createCobrowsePeer — ICE", () => {
  it("queues ICE before remoteDescription + drains after", async () => {
    const { peer, stub } = makePeer("offerer")
    await peer.connect()
    // Send 2 ICE before remote answer arrives.
    await peer.handleIncomingSignal(env("ice", { candidate: "c1", sdpMid: "0" }))
    await peer.handleIncomingSignal(env("ice", { candidate: "c2", sdpMid: "0" }))
    expect(stub._addedCandidates).toHaveLength(0)
    // Now the answer lands.
    await peer.handleIncomingSignal(env("answer", { type: "answer", sdp: "v=a" }))
    expect(stub._addedCandidates).toHaveLength(2)
  })

  it("immediately adds ICE after remoteDescription is set", async () => {
    const { peer, stub } = makePeer("offerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("answer", { type: "answer", sdp: "x" }))
    await peer.handleIncomingSignal(env("ice", { candidate: "c1", sdpMid: "0" }))
    expect(stub._addedCandidates).toHaveLength(1)
  })

  it("fires local ICE candidates over sendSignal", async () => {
    const { peer, stub, sendSignal } = makePeer("offerer")
    await peer.connect()
    stub._fireLocalIce({ candidate: "host:c1", sdpMid: "0" })
    expect(sendSignal).toHaveBeenCalledWith({
      kind: "ice",
      payload: { candidate: "host:c1", sdpMid: "0" },
    })
  })
})

/* ── local stream + remote stream ─────────────────────────────── */

describe("createCobrowsePeer — media stream", () => {
  it("adds tracks from localStream on connect()", async () => {
    const fakeTrack = { id: "track-1" } as MediaStreamTrack
    const stream = { getTracks: () => [fakeTrack] } as unknown as MediaStream
    const { peer, stub } = makePeer("answerer", { localStream: stream })
    await peer.connect()
    expect(stub._addedTracks).toEqual([fakeTrack])
  })

  it("emits remote-stream lifecycle event on ontrack", async () => {
    const { peer, stub, onLifecycle } = makePeer("offerer")
    await peer.connect()
    const fakeStream = {} as MediaStream
    stub._fireRemoteStream(fakeStream)
    const remoteEvts = onLifecycle.mock.calls
      .map((c) => c[0] as CobrowseLifecycle)
      .filter((e) => e.kind === "remote-stream")
    expect(remoteEvts).toHaveLength(1)
    if (remoteEvts[0].kind === "remote-stream") {
      expect(remoteEvts[0].stream).toBe(fakeStream)
    }
  })
})

/* ── lifecycle: pause / resume / ended ─────────────────────────── */

describe("createCobrowsePeer — lifecycle signals", () => {
  it("emits peer-paused on incoming pause", async () => {
    const { peer, onLifecycle } = makePeer("offerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("pause", null))
    expect(onLifecycle).toHaveBeenCalledWith(expect.objectContaining({ kind: "peer-paused" }))
  })

  it("emits peer-resumed on incoming resume", async () => {
    const { peer, onLifecycle } = makePeer("offerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("resume", null))
    expect(onLifecycle).toHaveBeenCalledWith(expect.objectContaining({ kind: "peer-resumed" }))
  })

  it("emits ended with reason extracted from `{reason}` envelope payload", async () => {
    const { peer, onLifecycle } = makePeer("offerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("ended", { reason: "agent_ended" }))
    const endedEvts = onLifecycle.mock.calls
      .map((c) => c[0] as CobrowseLifecycle)
      .filter((e) => e.kind === "ended")
    expect(endedEvts).toHaveLength(1)
    if (endedEvts[0].kind === "ended") {
      expect(endedEvts[0].reason).toBe("agent_ended")
    }
  })

  it("emits ended with reason extracted from bare-string payload", async () => {
    const { peer, onLifecycle } = makePeer("offerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("ended", "customer_left"))
    const endedEvts = onLifecycle.mock.calls
      .map((c) => c[0] as CobrowseLifecycle)
      .filter((e) => e.kind === "ended")
    expect(endedEvts).toHaveLength(1)
    if (endedEvts[0].kind === "ended") {
      expect(endedEvts[0].reason).toBe("customer_left")
    }
  })

  it("emits ended with undefined reason on malformed payload", async () => {
    const { peer, onLifecycle } = makePeer("offerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("ended", 42))
    const endedEvts = onLifecycle.mock.calls
      .map((c) => c[0] as CobrowseLifecycle)
      .filter((e) => e.kind === "ended")
    if (endedEvts[0].kind === "ended") {
      expect(endedEvts[0].reason).toBeUndefined()
    }
  })

  it("sendLifecycle forwards to sendSignal", async () => {
    const { peer, sendSignal } = makePeer("offerer")
    await peer.connect()
    await peer.sendLifecycle("pause")
    expect(sendSignal).toHaveBeenCalledWith({ kind: "pause", payload: null })
  })
})

/* ── close() ──────────────────────────────────────────────────── */

describe("createCobrowsePeer — close", () => {
  it("close() is idempotent", async () => {
    const { peer } = makePeer("offerer")
    await peer.connect()
    peer.close()
    expect(() => peer.close()).not.toThrow()
    expect(peer.getState()).toBe("closed")
  })

  it("connect() after close() is a no-op", async () => {
    const { peer, sendSignal } = makePeer("offerer")
    peer.close()
    await peer.connect()
    expect(sendSignal).not.toHaveBeenCalled()
  })

  it("handleIncomingSignal after close() is a no-op", async () => {
    const { peer, stub } = makePeer("offerer")
    await peer.connect()
    peer.close()
    await peer.handleIncomingSignal(env("answer", { type: "answer", sdp: "x" }))
    expect(stub._remoteDesc).toBeNull()
  })
})

/* ── malformed payload defense ────────────────────────────────── */

describe("createCobrowsePeer — payload guards", () => {
  it("ignores non-SDP offer payload", async () => {
    const { peer, stub } = makePeer("answerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("offer", "not an object"))
    expect(stub._remoteDesc).toBeNull()
  })

  it("ignores non-ICE-candidate payload", async () => {
    const { peer, stub } = makePeer("offerer")
    await peer.connect()
    await peer.handleIncomingSignal(env("answer", { type: "answer", sdp: "x" }))
    // After remote set, send a non-ice payload.
    await peer.handleIncomingSignal(env("ice", "garbage"))
    // _addedCandidates length unchanged.
    expect(stub._addedCandidates).toHaveLength(0)
  })
})
