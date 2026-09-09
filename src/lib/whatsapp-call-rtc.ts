export interface WhatsAppCallAnswerSession {
  sdp: string
  peerConnection: RTCPeerConnection
  localStream: MediaStream
  close: () => void
}

export interface WhatsAppCallOfferSession {
  sdp: string
  peerConnection: RTCPeerConnection
  localStream: MediaStream
  applyAnswer: (answerSdp: string) => Promise<void>
  close: () => void
}

export type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>
export type PeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection

export interface CreateWhatsAppCallAnswerOptions {
  offerSdp: string
  onRemoteStream?: (stream: MediaStream) => void
  getUserMedia?: GetUserMedia
  peerConnectionFactory?: PeerConnectionFactory
  iceGatheringTimeoutMs?: number
}

export interface CreateWhatsAppCallOfferOptions {
  onRemoteStream?: (stream: MediaStream) => void
  getUserMedia?: GetUserMedia
  peerConnectionFactory?: PeerConnectionFactory
  iceGatheringTimeoutMs?: number
}

const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 5_000

export const WHATSAPP_CALL_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
}

export async function waitForIceGatheringComplete(
  pc: RTCPeerConnection,
  timeoutMs = DEFAULT_ICE_GATHERING_TIMEOUT_MS,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return

  await new Promise<void>((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      pc.removeEventListener("icegatheringstatechange", onStateChange)
      resolve()
    }
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") finish()
    }
    pc.addEventListener("icegatheringstatechange", onStateChange)
    timer = setTimeout(finish, timeoutMs)
  })
}

export async function createWhatsAppCallAnswer(
  options: CreateWhatsAppCallAnswerOptions,
): Promise<WhatsAppCallAnswerSession> {
  const offerSdp = options.offerSdp.trim()
  if (!offerSdp) throw new Error("missing_sdp_offer")

  const getUserMedia = options.getUserMedia ?? (
    typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : null
  )
  if (!getUserMedia) throw new Error("microphone_unavailable")

  const peerConnectionFactory = options.peerConnectionFactory ?? (
    typeof RTCPeerConnection !== "undefined"
      ? (config: RTCConfiguration) => new RTCPeerConnection(config)
      : null
  )
  if (!peerConnectionFactory) throw new Error("webrtc_unavailable")

  const localStream = await getUserMedia({ audio: true, video: false })
  const pc = peerConnectionFactory(WHATSAPP_CALL_RTC_CONFIG)
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    for (const track of localStream.getTracks()) track.stop()
    pc.close()
  }

  try {
    for (const track of localStream.getAudioTracks()) pc.addTrack(track, localStream)
    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (stream) options.onRemoteStream?.(stream)
    }

    await pc.setRemoteDescription({ type: "offer", sdp: offerSdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await waitForIceGatheringComplete(pc, options.iceGatheringTimeoutMs)

    const sdp = pc.localDescription?.sdp?.trim()
    if (!sdp) throw new Error("missing_sdp_answer")

    return {
      sdp,
      peerConnection: pc,
      localStream,
      close,
    }
  } catch (error) {
    close()
    throw error
  }
}

export async function createWhatsAppCallOffer(
  options: CreateWhatsAppCallOfferOptions = {},
): Promise<WhatsAppCallOfferSession> {
  const getUserMedia = options.getUserMedia ?? (
    typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : null
  )
  if (!getUserMedia) throw new Error("microphone_unavailable")

  const peerConnectionFactory = options.peerConnectionFactory ?? (
    typeof RTCPeerConnection !== "undefined"
      ? (config: RTCConfiguration) => new RTCPeerConnection(config)
      : null
  )
  if (!peerConnectionFactory) throw new Error("webrtc_unavailable")

  const localStream = await getUserMedia({ audio: true, video: false })
  const pc = peerConnectionFactory(WHATSAPP_CALL_RTC_CONFIG)
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    for (const track of localStream.getTracks()) track.stop()
    pc.close()
  }

  try {
    for (const track of localStream.getAudioTracks()) pc.addTrack(track, localStream)
    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (stream) options.onRemoteStream?.(stream)
    }

    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
    await pc.setLocalDescription(offer)
    await waitForIceGatheringComplete(pc, options.iceGatheringTimeoutMs)

    const sdp = pc.localDescription?.sdp?.trim()
    if (!sdp) throw new Error("missing_sdp_offer")

    return {
      sdp,
      peerConnection: pc,
      localStream,
      close,
      applyAnswer: async (answerSdp: string) => {
        const trimmed = answerSdp.trim()
        if (!trimmed) throw new Error("missing_sdp_answer")
        await pc.setRemoteDescription({ type: "answer", sdp: trimmed })
      },
    }
  } catch (error) {
    close()
    throw error
  }
}
