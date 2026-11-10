import { describe, expect, it, vi } from "vitest"
import {
  browserReadySdp,
  createWhatsAppCallAnswer,
  createWhatsAppCallOffer,
  waitForIceGatheringComplete,
} from "@/lib/whatsapp-call-rtc"

interface StubPc {
  iceGatheringState: RTCIceGatheringState
  localDescription: RTCSessionDescriptionInit | null
  remoteDescription: RTCSessionDescriptionInit | null
  ontrack: ((event: { streams: MediaStream[] }) => void) | null
  addTrack: (track: MediaStreamTrack, stream: MediaStream) => void
  setRemoteDescription: (description: RTCSessionDescriptionInit) => Promise<void>
  createAnswer: () => Promise<RTCSessionDescriptionInit>
  setLocalDescription: (description: RTCSessionDescriptionInit) => Promise<void>
  close: () => void
  addEventListener: (event: string, listener: () => void) => void
  removeEventListener: (event: string, listener: () => void) => void
  fireRemoteStream: (stream: MediaStream) => void
  completeIce: () => void
  addedTracks: MediaStreamTrack[]
  listeners: Set<() => void>
}

function makeTrack() {
  return { stop: vi.fn() } as unknown as MediaStreamTrack
}

function makeStream(track = makeTrack()) {
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream
}

function makePc(): StubPc & RTCPeerConnection {
  const pc: StubPc = {
    iceGatheringState: "complete",
    localDescription: null,
    remoteDescription: null,
    ontrack: null,
    addedTracks: [],
    listeners: new Set(),
    addTrack(track) {
      pc.addedTracks.push(track)
    },
    async setRemoteDescription(description) {
      pc.remoteDescription = description
    },
    async createAnswer() {
      return { type: "answer", sdp: "v=local-answer" }
    },
    async setLocalDescription(description) {
      pc.localDescription = description
    },
    close: vi.fn(),
    addEventListener(_event, listener) {
      pc.listeners.add(listener)
    },
    removeEventListener(_event, listener) {
      pc.listeners.delete(listener)
    },
    fireRemoteStream(stream) {
      pc.ontrack?.({ streams: [stream] })
    },
    completeIce() {
      pc.iceGatheringState = "complete"
      for (const listener of pc.listeners) listener()
    },
  }
  return pc as StubPc & RTCPeerConnection
}

describe("createWhatsAppCallAnswer", () => {
  it("creates a browser SDP answer from a WhatsApp offer", async () => {
    const pc = makePc()
    const track = makeTrack()
    const stream = makeStream(track)
    const getUserMedia = vi.fn(async () => stream)

    const session = await createWhatsAppCallAnswer({
      offerSdp: "v=remote-offer",
      getUserMedia,
      peerConnectionFactory: () => pc,
    })

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false })
    expect(pc.remoteDescription).toEqual({ type: "offer", sdp: "v=remote-offer\r\n" })
    expect(pc.localDescription).toEqual({ type: "answer", sdp: "v=local-answer" })
    expect(pc.addedTracks).toEqual([track])
    expect(session.sdp).toBe("v=local-answer")

    session.close()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(pc.close).toHaveBeenCalledTimes(1)
  })

  it("forwards remote audio stream", async () => {
    const pc = makePc()
    const onRemoteStream = vi.fn()
    await createWhatsAppCallAnswer({
      offerSdp: "v=remote-offer",
      getUserMedia: async () => makeStream(),
      peerConnectionFactory: () => pc,
      onRemoteStream,
    })

    const remote = makeStream()
    pc.fireRemoteStream(remote)
    expect(onRemoteStream).toHaveBeenCalledWith(remote)
  })

  it("cleans up local media if negotiation fails", async () => {
    const pc = makePc()
    const track = makeTrack()
    pc.createAnswer = async () => {
      throw new Error("answer_failed")
    }

    await expect(createWhatsAppCallAnswer({
      offerSdp: "v=remote-offer",
      getUserMedia: async () => makeStream(track),
      peerConnectionFactory: () => pc,
    })).rejects.toThrow("answer_failed")

    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(pc.close).toHaveBeenCalledTimes(1)
  })
})

describe("waitForIceGatheringComplete", () => {
  it("waits until the peer connection reports complete ICE gathering", async () => {
    const pc = makePc()
    pc.iceGatheringState = "gathering"

    const promise = waitForIceGatheringComplete(pc, 1000)
    expect(pc.listeners.size).toBe(1)
    pc.completeIce()
    await promise
    expect(pc.listeners.size).toBe(0)
  })
})

// Meta's answer to the first live outbound call (2026-11-10) ended in this
// line; Chrome refused it once the trailing line end was cut off.
const META_ANSWER = [
  "v=0",
  "o=- 1762764163 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 3480 UDP/TLS/RTP/SAVPF 111",
  "a=rtpmap:111 opus/48000/2",
  "a=ssrc:3328139132 cname:WhatsAppAudioStream1",
].join("\r\n") + "\r\n"

describe("the SDP Meta sends reaches the browser whole", () => {
  it("keeps the line end after the last line", () => {
    expect(browserReadySdp(META_ANSWER)).toBe(META_ANSWER)
    expect(browserReadySdp(`  ${META_ANSWER}\r\n\r\n`)).toBe(META_ANSWER)
  })

  it("restores the last line end and CRLF when they arrive cut or as LF", () => {
    expect(browserReadySdp(META_ANSWER.trim())).toBe(META_ANSWER)
    expect(browserReadySdp(META_ANSWER.replace(/\r\n/g, "\n"))).toBe(META_ANSWER)
  })

  it("is empty for an empty description", () => {
    expect(browserReadySdp(" \r\n ")).toBe("")
  })

  it("an outbound call hands Meta's answer to the browser with its last line end", async () => {
    const pc = Object.assign(makePc() as StubPc, {
      createOffer: async (): Promise<RTCSessionDescriptionInit> => ({ type: "offer", sdp: "v=local-offer" }),
    })
    const session = await createWhatsAppCallOffer({
      getUserMedia: async () => makeStream(),
      peerConnectionFactory: () => pc as unknown as RTCPeerConnection,
    })
    await session.applyAnswer(META_ANSWER)
    expect(pc.remoteDescription).toEqual({ type: "answer", sdp: META_ANSWER })
  })

  it("an incoming call hands Meta's offer to the browser with its last line end", async () => {
    const pc = makePc()
    await createWhatsAppCallAnswer({
      offerSdp: META_ANSWER,
      getUserMedia: async () => makeStream(),
      peerConnectionFactory: () => pc,
    })
    expect(pc.remoteDescription?.sdp).toBe(META_ANSWER)
  })
})
