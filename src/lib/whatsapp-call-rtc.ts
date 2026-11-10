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

/**
 * The SDP Meta sent, ready for the browser: CRLF line ends, the last line
 * included. Chrome refuses a description whose last line has no line end —
 * «Failed to parse SessionDescription. a=ssrc:… cname:WhatsAppAudioStream1
 * Invalid SDP line» — and `.trim()` cut exactly that: on 2026-11-10 the first
 * live outbound call connected at Meta and the owner's phone rang into
 * silence, because the browser threw Meta's answer away. Measured in Chrome
 * the same day: the same answer is accepted with the trailing CRLF and
 * refused without it, with CRLF or LF line ends alike.
 */
export function browserReadySdp(sdp: string): string {
  const body = sdp.trim()
  return body ? `${body.split(/\r?\n/).map((line) => line.trimEnd()).join("\r\n")}\r\n` : ""
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
  const offerSdp = browserReadySdp(options.offerSdp)
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
        const sdp = browserReadySdp(answerSdp)
        if (!sdp) throw new Error("missing_sdp_answer")
        await pc.setRemoteDescription({ type: "answer", sdp })
      },
    }
  } catch (error) {
    close()
    throw error
  }
}
