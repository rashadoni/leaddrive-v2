import { describe, expect, it, vi } from "vitest"
import {
  createWhatsAppCallAnswer,
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
    expect(pc.remoteDescription).toEqual({ type: "offer", sdp: "v=remote-offer" })
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
