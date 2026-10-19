// @vitest-environment jsdom
/**
 * «Səslə soruşun» and the spoken answers, through the real player (owner,
 * 2026-10-20: «Кнопка "спросить голосом"»).
 *
 * The microphone and Web Audio are stand-ins that record what was asked of
 * them, and `fetch` answers for the server. What is checked is what the
 * prospect meets: no button without the server's switch; the consent before
 * the microphone is touched; a visible recording state; a 16 kHz mono WAV
 * sent to the transcribe route; «Eşitdim: …» shown and then asked as the
 * question; the microphone released after every clip; errors in words; a
 * Da Vinci answer spoken once through the guide's one audio element.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({
  toast: Object.assign(() => 0, { info: () => 0, dismiss: () => 0, success: () => 0, error: () => 0 }),
  Toaster: () => null,
}))
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { src: String(props.src ?? ""), alt: String(props.alt ?? "") }) }))

import { DemoJourneyPlayer } from "@/components/demo-center/journey/demo-journey-player"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"
import { DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS } from "@/lib/demo-center/assistant/voice-policy"
import { DEMO_JOURNEY_MODULES, PROSPECT_TO_CLOSED_WON } from "@/lib/demo-center/journey"

const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages/az.json"), "utf8"))
const TOKEN = "voice-test-token-0001"
const HEARD = "Sövdələşmələri göstərin"
const DEVICE_RATE = 48_000

let container: HTMLDivElement
let root: Root
let played: string[]
let calls: Array<{ url: string; init?: RequestInit }>
let reply: Record<string, unknown>
let transcribeReply: { status: number; body: Record<string, unknown> }
let voiceReply: { status: number; audio?: boolean; body?: Record<string, unknown> }
let microphone: { asked: number; stopped: number; closed: number; deny: string | null; processor: FakeProcessor | null }

class FakeProcessor {
  onaudioprocess: ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null = null
  connect() {}
  disconnect() {}
}

/** `seconds` of sound at the device's rate, in the 4096-sample buffers a script processor delivers. */
function speakFor(seconds: number) {
  const frames = Math.ceil((seconds * DEVICE_RATE) / 4096)
  for (let frame = 0; frame < frames; frame += 1) {
    const data = new Float32Array(4096).map((_, index) => Math.sin((frame * 4096 + index) / 9) * 0.3)
    microphone.processor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => data } })
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.removeItem("ld_demo_guide_voice")
  played = []
  calls = []
  reply = { success: true, answer: "Bu, lidin balıdır.", remaining: 49, source: "davinci", answerId: "ans-1", answerHash: "a".repeat(64) }
  transcribeReply = { status: 200, body: { success: true, text: HEARD } }
  voiceReply = { status: 200, audio: true }
  microphone = { asked: 0, stopped: 0, closed: 0, deny: null, processor: null }

  class FakeAudio {
    src = ""
    playbackRate = 1
    defaultPlaybackRate = 1
    preservesPitch = false
    play() { played.push(this.src); return Promise.resolve() }
    pause() {}
  }
  vi.stubGlobal("Audio", FakeAudio)
  class FakeAudioContext {
    sampleRate = DEVICE_RATE
    destination = {}
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createScriptProcessor() {
      microphone.processor = new FakeProcessor()
      return microphone.processor
    }
    resume() { return Promise.resolve() }
    close() { microphone.closed += 1; return Promise.resolve() }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext)
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        microphone.asked += 1
        if (microphone.deny) throw Object.assign(new Error("denied"), { name: microphone.deny })
        return { getTracks: () => [{ stop: () => { microphone.stopped += 1 } }] }
      }),
    },
  })
  // jsdom has no object URLs; a spoken answer's file gets a numbered one.
  let blobs = 0
  Object.assign(URL, {
    createObjectURL: () => `blob:voice-${(blobs += 1)}`,
    revokeObjectURL: () => {},
  })
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0) as unknown as number)
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url).includes("/assistant/transcribe")) return new Response(JSON.stringify(transcribeReply.body), { status: transcribeReply.status })
    if (String(url).endsWith("/assistant/voice")) {
      return voiceReply.audio
        ? new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { "Content-Type": "audio/wav" } })
        : new Response(JSON.stringify(voiceReply.body ?? {}), { status: voiceReply.status })
    }
    if (String(url).endsWith("/assistant")) return new Response(JSON.stringify(reply), { status: 200 })
    return new Response(JSON.stringify({ success: true, accepted: 1 }), { status: 200 })
  }))
  Element.prototype.scrollIntoView = () => {}
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

async function settle(ms = 40) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function renderPlayer(assistantVoice = true) {
  await act(async () => {
    root.render(createElement(
      NextIntlClientProvider,
      { locale: "az", messages, timeZone: "Asia/Baku" } as ComponentProps<typeof NextIntlClientProvider>,
      createElement(DemoJourneyPlayer, {
        variant: "granted",
        token: TOKEN,
        manifest: PROSPECT_TO_CLOSED_WON,
        identity: {
          name: "Nigar Əliyeva",
          company: "Xəzər Logistika MMC",
          jobTitle: "Satış direktoru",
          emailMasked: "ni•••@xezerlogistika.az",
          phoneMasked: "+994 ••••• 67",
          sourceChannel: "instagram",
          interests: DEMO_JOURNEY_MODULES.map((module) => module.id),
        },
        company: "Xəzər Logistika MMC",
        watermark: "Xəzər Logistika MMC",
        assistantVoice,
      }),
    ))
  })
  await settle()
}

const button = () => container.querySelector<HTMLButtonElement>('[data-testid="demo-assistant-voice-button"]')
const voiceState = () => container.querySelector('[data-testid="demo-assistant-voice"]')?.getAttribute("data-voice-state") ?? null
const callsTo = (suffix: string) => calls.filter((call) => call.url.split("?")[0].endsWith(suffix))

function pointer(type: "pointerdown" | "pointerup") {
  const Event = (window as unknown as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? window.MouseEvent
  return act(async () => {
    button()!.dispatchEvent(new Event(type, { bubbles: true, button: 0 }))
  })
}

/** Press the button the way a keyboard does (a click with no pointer before it). */
async function press() {
  await act(async () => button()!.click())
  await settle()
}

async function consentAndListen() {
  await press()
  const accept = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="demo-assistant-voice-consent"] button'))
    .find((candidate) => candidate.textContent === S.voiceConsentAccept)
  expect(accept, "the consent's own button").toBeDefined()
  await act(async () => accept!.click())
  await settle()
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })
}

describe("«Səslə soruşun»", () => {
  it("is not there while the server's switch is off", async () => {
    await renderPlayer(false)
    expect(container.querySelector("#demo-assistant-question"), "the typed box is still there").not.toBeNull()
    expect(button()).toBeNull()
  })

  it("asks for consent first, and touches the microphone only after it", async () => {
    await renderPlayer()
    expect(button()!.textContent).toContain(S.voiceAsk)
    await press()
    const consent = container.querySelector('[data-testid="demo-assistant-voice-consent"]')
    expect(consent?.textContent).toContain(S.voiceConsentBody(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS))
    expect(microphone.asked).toBe(0)

    const decline = Array.from(consent!.querySelectorAll("button")).find((candidate) => candidate.textContent === S.voiceConsentDecline)!
    await act(async () => decline.click())
    expect(microphone.asked).toBe(0)
    expect(voiceState()).toBe("idle")

    await consentAndListen()
    expect(microphone.asked).toBe(1)
    expect(voiceState()).toBe("recording")
    expect(button()!.textContent).toContain(S.voiceStop(0))
    expect(button()!.getAttribute("aria-pressed")).toBe("true")
    expect(container.textContent).toContain(S.voiceListening(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS))
  })

  it("tap, speak, tap: sends a 16 kHz mono WAV, shows what was heard, asks it, and lets the microphone go", async () => {
    await renderPlayer()
    await consentAndListen()
    speakFor(2)
    await press()
    await settle(80)

    const [sent] = callsTo("/assistant/transcribe")
    expect(sent, "the clip went to the transcribe route").toBeDefined()
    expect(new Headers(sent.init?.headers).get("Content-Type")).toBe("audio/wav")
    const bytes = await blobBytes(sent.init?.body as Blob)
    const view = new DataView(bytes.buffer)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF")
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    const seconds = view.getUint32(40, true) / 32_000
    expect(seconds).toBeGreaterThan(1.9)
    expect(seconds).toBeLessThan(2.2)

    expect(microphone.stopped).toBe(1)
    expect(microphone.closed).toBe(1)
    expect(container.querySelector('[data-testid="demo-assistant-voice-heard"]')?.textContent).toBe(S.voiceHeard(HEARD))
    const [asked] = callsTo("/assistant")
    expect(JSON.parse(String(asked.init?.body))).toMatchObject({ question: HEARD })
    expect(voiceState()).toBe("idle")
  })

  it("hold to talk: letting go sends", async () => {
    await renderPlayer()
    await consentAndListen()
    // The consent's own press started this clip; the next one is held.
    await press()
    await settle(80)
    calls = []
    await pointer("pointerdown")
    await settle()
    expect(voiceState()).toBe("recording")
    speakFor(1)
    await settle(500)
    await pointer("pointerup")
    await settle(80)
    expect(callsTo("/assistant/transcribe")).toHaveLength(1)
    expect(microphone.stopped).toBe(2)
  })

  it("stops by itself at fifteen seconds and sends what it has", async () => {
    await renderPlayer()
    await consentAndListen()
    speakFor(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS + 1)
    await settle(80)
    const [sent] = callsTo("/assistant/transcribe")
    expect(sent).toBeDefined()
    const bytes = await blobBytes(sent.init?.body as Blob)
    expect(new DataView(bytes.buffer).getUint32(40, true) / 32_000).toBeLessThanOrEqual(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS)
    expect(microphone.stopped).toBe(1)
  })

  it("says so in words when the microphone is refused, and sends nothing", async () => {
    microphone.deny = "NotAllowedError"
    await renderPlayer()
    await consentAndListen()
    expect(container.querySelector('[data-testid="demo-assistant-voice"] [role="alert"]')?.textContent).toBe(S.voiceDenied)
    expect(callsTo("/assistant/transcribe")).toEqual([])
    expect(voiceState()).toBe("idle")
  })

  it("shows the server's refusal, and once the voice minutes are spent the button gives way to the note", async () => {
    transcribeReply = { status: 429, body: { success: false, code: "demo_budget", error: "Bu demo üçün 10 dəqiqəlik səs limiti doldu." } }
    await renderPlayer()
    await consentAndListen()
    speakFor(1)
    await press()
    await settle(80)
    expect(callsTo("/assistant")).toEqual([])
    expect(button()).toBeNull()
    expect(container.querySelector('[data-testid="demo-assistant-voice-exhausted"]')?.textContent).toBe(S.voiceExhausted)
  })

  it("releases the microphone when the page goes away in the middle of a clip", async () => {
    await renderPlayer()
    await consentAndListen()
    expect(microphone.stopped).toBe(0)
    act(() => root.unmount())
    expect(microphone.stopped).toBe(1)
    root = createRoot(container)
  })
})

describe("Da Vinci's answers in the guide's voice", () => {
  async function askTyped(question: string) {
    const box = document.getElementById("demo-assistant-question") as HTMLTextAreaElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
    await act(async () => {
      setValue.call(box, question)
      box.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => box.form!.requestSubmit())
    await settle(80)
  }

  it("speaks a Da Vinci answer once, sending back exactly what the server vouched for, through the one audio element", async () => {
    await renderPlayer()
    const before = played.length
    await askTyped("Bu bal necə hesablanır?")
    const voiced = callsTo("/assistant/voice")
    expect(voiced).toHaveLength(1)
    expect(JSON.parse(String(voiced[0].init?.body))).toMatchObject({ answerId: "ans-1", answer: "Bu, lidin balıdır.", answerHash: "a".repeat(64) })
    expect(played.slice(before)).toEqual(["blob:voice-1"])
  })

  it("keeps a prepared answer's recording and asks for no voice; without the switch nothing is spoken", async () => {
    reply = { success: true, answer: "Sabit tariflər yoxdur.", remaining: 50, source: "prepared", audio: "/sounds/demo-guide/abc.mp3" }
    await renderPlayer()
    await askTyped("Qiymət nədir?")
    expect(callsTo("/assistant/voice")).toEqual([])
    expect(played.at(-1)).toBe("/sounds/demo-guide/abc.mp3")
  })

  it("asks for no voice when the switch is off, even for an answer that carries an id", async () => {
    await renderPlayer(false)
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant/voice")).toEqual([])
  })

  it("says it could not speak the answer, and the text stays", async () => {
    voiceReply = { status: 502, audio: false, body: { success: false, code: "unavailable", error: "x" } }
    await renderPlayer()
    await askTyped("Bu bal necə hesablanır?")
    expect(container.querySelector('[data-testid="demo-assistant-turns"]')?.textContent).toContain("Bu, lidin balıdır.")
    expect(container.querySelector('[data-testid="demo-assistant-voice-note"]')?.textContent).toBe(S.voiceAnswerFailed)
  })
})
