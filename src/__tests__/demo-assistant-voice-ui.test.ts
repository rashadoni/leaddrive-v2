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
 *
 * And, in every case, the guide never starts talking while a microphone
 * track is live: what the audio element is asked to play is recorded with
 * whether the microphone was open at that moment, and `afterEach` holds every
 * case to none.
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
import { DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS, DEMO_VOICE_REFUSAL_TEXT } from "@/lib/demo-center/assistant/voice-policy"
import { stepVoiceUrl } from "@/lib/demo-center/guide-voice"
import { DEMO_JOURNEY_MODULES, PROSPECT_TO_CLOSED_WON, findStep } from "@/lib/demo-center/journey"

const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages/az.json"), "utf8"))
const TOKEN = "voice-test-token-0001"
const HEARD = "Sövdələşmələri göstərin"
const DEVICE_RATE = 48_000
const davinci = () => ({ success: true, answer: "Bu, lidin balıdır.", remaining: 49, source: "davinci", answerId: "ans-1", answerHash: "a".repeat(64) })

let container: HTMLDivElement
let root: Root
let played: string[]
/** What the guide started playing while a microphone track was live: its voice would be in the question. */
let playedIntoMicrophone: string[]
/** Every pause of the guide's element: a scroll that began on the button must not cut the guide off. */
let pauses: number
/** Every audio element the page made: the guide's one, last. */
let audioElements: Array<{ src: string; paused: boolean }>
const guideAudio = () => audioElements.at(-1)
let calls: Array<{ url: string; init?: RequestInit }>
let reply: Record<string, unknown>
/** What the transcribe route answers; `fails`: the request itself fails (the network, a dropped connection). */
let transcribeReply: { status: number; body: Record<string, unknown>; fails?: boolean }
let voiceReply: { status: number; audio?: boolean; body?: Record<string, unknown> }
let microphone: { asked: number; stopped: number; closed: number; live: number; deny: string | null; processor: FakeProcessor | null }
/** Held answers: a request waits here until its gate opens (the server or the microphone taking its time). */
let gates: { assistant: Promise<void> | null; voice: Promise<void> | null; microphone: Promise<void> | null; transcribe: Promise<void> | null }

function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open: () => act(async () => { open() }) }
}

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
  // On, as a fresh browser has it — written out, because the switch also keeps
  // its last choice in memory, and a case that turned it off must not leave
  // the next one silent.
  window.localStorage.setItem("ld_demo_guide_voice", "on")
  played = []
  playedIntoMicrophone = []
  pauses = 0
  audioElements = []
  calls = []
  reply = davinci()
  transcribeReply = { status: 200, body: { success: true, text: HEARD } }
  voiceReply = { status: 200, audio: true }
  microphone = { asked: 0, stopped: 0, closed: 0, live: 0, deny: null, processor: null }
  gates = { assistant: null, voice: null, microphone: null, transcribe: null }

  class FakeAudio {
    src = ""
    playbackRate = 1
    defaultPlaybackRate = 1
    preservesPitch = false
    paused = true
    ended = false
    constructor() {
      audioElements.push(this)
    }
    play() {
      played.push(this.src)
      if (microphone.live > 0) playedIntoMicrophone.push(this.src)
      this.paused = false
      return Promise.resolve()
    }
    pause() {
      pauses += 1
      this.paused = true
    }
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
        if (gates.microphone) await gates.microphone
        if (microphone.deny) throw Object.assign(new Error("denied"), { name: microphone.deny })
        microphone.live += 1
        let stopped = false
        return {
          getTracks: () => [{
            stop: () => {
              microphone.stopped += 1
              if (!stopped) microphone.live -= 1
              stopped = true
            },
          }],
        }
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
    if (String(url).includes("/assistant/transcribe")) {
      if (gates.transcribe) await gates.transcribe
      if (transcribeReply.fails) throw new TypeError("Failed to fetch")
      return new Response(JSON.stringify(transcribeReply.body), { status: transcribeReply.status })
    }
    if (String(url).endsWith("/assistant/voice")) {
      if (gates.voice) await gates.voice
      return voiceReply.audio
        ? new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { "Content-Type": "audio/wav" } })
        : new Response(JSON.stringify(voiceReply.body ?? {}), { status: voiceReply.status })
    }
    if (String(url).endsWith("/assistant")) {
      if (gates.assistant) await gates.assistant
      return new Response(JSON.stringify(reply), { status: 200 })
    }
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
  expect(playedIntoMicrophone, "the guide started talking while the microphone was open").toEqual([])
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

function pointer(type: "pointerdown" | "pointerup" | "pointermove" | "pointercancel", init: PointerEventInit = {}) {
  const Event = (window as unknown as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? window.MouseEvent
  return act(async () => {
    button()!.dispatchEvent(new Event(type, { bubbles: true, button: 0, ...init }))
  })
}

/** A finger on the button: jsdom's PointerEvent carries its type and where it is. */
function touch(type: "pointerdown" | "pointerup" | "pointermove" | "pointercancel", x: number, y: number) {
  expect(typeof window.PointerEvent, "jsdom has PointerEvent").toBe("function")
  return pointer(type, { pointerType: "touch", isPrimary: true, clientX: x, clientY: y })
}

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

/** «İrəli» where the step is shown: on the coach card, or in the panel without one. */
function nextButton(): HTMLButtonElement | null {
  const within = [document.querySelector('[data-testid="demo-coach-card"]'), container.querySelector('[data-testid="demo-guide"]')]
  for (const scope of within) {
    const found = scope && Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => !candidate.disabled && candidate.textContent?.includes(S.next))
    if (found) return found
  }
  return null
}

/** The one voice switch on screen: in the coach card while it carries the step, in the panel otherwise. */
const voiceSwitch = () => document.querySelector<HTMLButtonElement>('[data-testid="demo-coach-voice"], [data-testid="demo-guide-voice"]')!

const voiceNote = () => container.querySelector('[data-testid="demo-assistant-voice-note"]')?.textContent ?? null
const voiceAlert = () => container.querySelector('[data-testid="demo-assistant-voice"] [role="alert"]')?.textContent ?? null
const questionBox = () => document.getElementById("demo-assistant-question") as HTMLTextAreaElement
const askButton = () => questionBox().form!.querySelector<HTMLButtonElement>('button[type="submit"]')!
const heardWaiting = () => container.querySelector('[data-testid="demo-assistant-heard-waiting"]')?.textContent ?? null
const playedBlobs = () => played.filter((src) => src.startsWith("blob:"))
/** Where the story is, as the player keeps it for the tab. */
function frontier(): { sectionId: string; stepId: string } {
  const parsed = JSON.parse(window.sessionStorage.getItem(`ld_demo_journey_${TOKEN.slice(-16)}`)!)
  return parsed.snapshot ?? parsed
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

  it("a finger that slides off the button is a scroll: the clip is thrown away, never sent", async () => {
    await renderPlayer()
    await consentAndListen()
    await press()
    await settle(80)
    calls = []
    expect(microphone.stopped).toBe(1)

    await touch("pointerdown", 120, 300)
    await settle()
    expect(voiceState()).toBe("recording")
    await touch("pointermove", 121, 260)
    expect(voiceState()).toBe("idle")
    expect(microphone.stopped).toBe(2)
    expect(microphone.closed).toBe(2)
    await touch("pointerup", 121, 240)
    // Whatever the room says next goes nowhere: there is no clip any more.
    speakFor(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS + 1)
    await settle(80)
    expect(callsTo("/assistant/transcribe")).toEqual([])
    expect(callsTo("/assistant")).toEqual([])
    expect(button()!.textContent).toContain(S.voiceAsk)
  })

  it("a finger that only trembles is still a tap, and a held finger may drift", async () => {
    await renderPlayer()
    await consentAndListen()
    await press()
    await settle(80)
    calls = []

    // A tap with a few pixels of jitter (and the click a tap ends with): still listening until the next tap.
    await touch("pointerdown", 60, 60)
    await settle()
    await touch("pointermove", 63, 64)
    await touch("pointerup", 63, 64)
    await act(async () => button()!.click())
    expect(voiceState()).toBe("recording")
    speakFor(1)
    await touch("pointerdown", 61, 61)
    await touch("pointerup", 61, 61)
    await act(async () => button()!.click())
    await settle(80)
    expect(callsTo("/assistant/transcribe")).toHaveLength(1)

    // Held past the hold time, then moved: a hold, and letting go sends.
    calls = []
    await touch("pointerdown", 60, 60)
    await settle()
    speakFor(1)
    await settle(500)
    await touch("pointermove", 60, 120)
    expect(voiceState()).toBe("recording")
    await touch("pointerup", 60, 120)
    await settle(80)
    expect(callsTo("/assistant/transcribe")).toHaveLength(1)
  })

  it("a pointer the browser cancels throws the clip away instead of sending it", async () => {
    await renderPlayer()
    await consentAndListen()
    await press()
    await settle(80)
    calls = []

    await touch("pointerdown", 40, 40)
    await settle()
    expect(voiceState()).toBe("recording")
    await touch("pointercancel", 40, 40)
    expect(voiceState()).toBe("idle")
    expect(microphone.stopped).toBe(2)
    speakFor(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS + 1)
    await settle(80)
    expect(callsTo("/assistant/transcribe")).toEqual([])
  })

  it("voice running out in the middle of a clip releases the microphone there and then, and nothing is sent", async () => {
    // A typed answer's voice is on its way when a tap leaves the microphone
    // listening; then it is refused: the minutes are gone.
    const answer = gate()
    gates.voice = answer.promise
    voiceReply = { status: 429, audio: false, body: { success: false, code: "demo_budget", error: "x", exhausted: true } }
    await renderPlayer()
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant/voice")).toHaveLength(1)
    await consentAndListen()
    expect(voiceState()).toBe("recording")
    await answer.open()
    await settle(80)

    expect(button()).toBeNull()
    expect(container.querySelector('[data-testid="demo-assistant-voice-exhausted"]')?.textContent).toBe(S.voiceExhausted)
    expect(microphone.stopped).toBe(1)
    expect(microphone.closed).toBe(1)
    // The fifteen-second stop would have sent it by itself.
    speakFor(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS + 1)
    await settle(80)
    expect(callsTo("/assistant/transcribe")).toEqual([])
  })

  it("voice running out while the microphone is still opening: the clip is released the moment it opens", async () => {
    transcribeReply = { status: 422, body: { success: false, code: "silent", error: "x" } }
    await renderPlayer()
    await consentAndListen()
    await press()
    await settle(80)
    expect(microphone.stopped).toBe(1)

    const answer = gate()
    gates.voice = answer.promise
    voiceReply = { status: 429, audio: false, body: { success: false, code: "day_budget", error: "x", exhausted: true } }
    await askTyped("Bu bal necə hesablanır?")
    const opening = gate()
    gates.microphone = opening.promise
    await press()
    expect(voiceState()).toBe("starting")

    await answer.open()
    await settle(80)
    expect(button()).toBeNull()
    await opening.open()
    await settle(80)
    expect(microphone.asked).toBe(2)
    expect(microphone.stopped).toBe(2)
    expect(microphone.closed).toBe(2)
    speakFor(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS + 1)
    await settle(80)
    expect(callsTo("/assistant/transcribe")).toHaveLength(1)
  })

  it("releases the microphone when the page goes away in the middle of a clip, and the next page's guide speaks", async () => {
    await renderPlayer()
    await consentAndListen()
    expect(microphone.stopped).toBe(0)
    const before = played.length
    act(() => root.unmount())
    expect(microphone.stopped).toBe(1)
    expect(played.length, "nothing starts for a page that is gone").toBe(before)
    root = createRoot(container)
    await renderPlayer()
    expect(played.length, "the guide is not left waiting for a microphone that went with the page").toBe(before + 1)
  })
})

describe("Da Vinci's answers in the guide's voice", () => {
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

  it("a spoken answer that comes back while the microphone is open waits, and is dropped once the clip is sent", async () => {
    const answer = gate()
    gates.voice = answer.promise
    await renderPlayer()
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant/voice")).toHaveLength(1)
    // The text is on the screen and the audio is still being made: the prospect starts asking.
    await consentAndListen()
    expect(voiceState()).toBe("recording")
    await answer.open()
    await settle(80)
    expect(playedBlobs(), "not over the open microphone").toEqual([])

    // The question that was being recorded gets its own answer, and that one is spoken.
    speakFor(1)
    await press()
    await settle(120)
    expect(callsTo("/assistant/voice")).toHaveLength(2)
    expect(playedBlobs()).toEqual(["blob:voice-1"])
  })

  it("the guide's voice switched off while the answer is coming: nothing is sent to be spoken", async () => {
    const answer = gate()
    gates.assistant = answer.promise
    await renderPlayer()
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant")).toHaveLength(1)
    // The one switch on screen: in the coach card while it carries the step, in the panel otherwise.
    const toggle = () => container.querySelector<HTMLButtonElement>('[data-testid="demo-coach-voice"], [data-testid="demo-guide-voice"]')!
    expect(toggle().textContent).toContain(S.voiceOff)
    await act(async () => toggle().click())
    expect(toggle().textContent).toContain(S.voiceOn)

    await answer.open()
    await settle(80)
    expect(container.querySelector('[data-testid="demo-assistant-turns"]')?.textContent).toContain("Bu, lidin balıdır.")
    expect(callsTo("/assistant/voice")).toEqual([])

    // On again: the next answer is spoken.
    await act(async () => toggle().click())
    gates.assistant = null
    await askTyped("Bəs bu?")
    expect(callsTo("/assistant/voice")).toHaveLength(1)
  })

  it("a long answer refused over the budget stays text, and voice goes on while a question still fits", async () => {
    voiceReply = { status: 429, audio: false, body: { success: false, code: "demo_budget", error: "x", exhausted: false } }
    await renderPlayer()
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant/voice")).toHaveLength(1)
    expect(button(), "«Səslə soruşun» stays").not.toBeNull()
    expect(container.querySelector('[data-testid="demo-assistant-voice-exhausted"]')).toBeNull()
    expect(voiceNote()).toBe(S.voiceAnswerFailed)

    voiceReply = { status: 200, audio: true }
    await askTyped("Bəs bu?")
    expect(callsTo("/assistant/voice")).toHaveLength(2)
    expect(playedBlobs()).toEqual(["blob:voice-1"])
  })

  it("over the budget with not even one question left: the button gives way to the note", async () => {
    voiceReply = { status: 429, audio: false, body: { success: false, code: "demo_budget", error: "x", exhausted: true } }
    await renderPlayer()
    await askTyped("Bu bal necə hesablanır?")
    expect(button()).toBeNull()
    expect(container.querySelector('[data-testid="demo-assistant-voice-exhausted"]')?.textContent).toBe(S.voiceExhausted)
    await askTyped("Bəs bu?")
    expect(callsTo("/assistant/voice")).toHaveLength(1)
  })

  it("says it could not speak the answer, and the text stays", async () => {
    voiceReply = { status: 502, audio: false, body: { success: false, code: "unavailable", error: "x" } }
    await renderPlayer()
    await askTyped("Bu bal necə hesablanır?")
    expect(container.querySelector('[data-testid="demo-assistant-turns"]')?.textContent).toContain("Bu, lidin balıdır.")
    expect(container.querySelector('[data-testid="demo-assistant-voice-note"]')?.textContent).toBe(S.voiceAnswerFailed)
  })
})

/**
 * The guide never talks into the question (verifier, after e658fd644): not
 * an answer typed while a tap leaves the microphone listening, not a step
 * that opens meanwhile, not the voice switched back on. And a touch that
 * turns out to be a scroll takes nothing away: the guide reads on, and an
 * answer on its way is heard.
 */
describe("the guide and an open microphone", () => {
  it("a question typed while a tap leaves the microphone listening is answered in text: nothing plays into the clip, nothing is sent to be spoken", async () => {
    await renderPlayer()
    await consentAndListen()
    expect(voiceState()).toBe("recording")
    await askTyped("Bu bal necə hesablanır?")
    expect(voiceState(), "still listening").toBe("recording")
    expect(container.querySelector('[data-testid="demo-assistant-turns"]')?.textContent).toContain("Bu, lidin balıdır.")
    expect(callsTo("/assistant/voice"), "nothing paid to be spoken while the microphone is open").toEqual([])
    expect(playedBlobs()).toEqual([])

    // A prepared answer's recording does not play into it either.
    reply = { success: true, answer: "Sabit tariflər yoxdur.", remaining: 48, source: "prepared", audio: "/sounds/demo-guide/abc.mp3" }
    await askTyped("Qiymət nədir?")
    expect(played).not.toContain("/sounds/demo-guide/abc.mp3")

    // The clip sent, the question it carried gets its spoken answer.
    reply = davinci()
    speakFor(1)
    await press()
    await settle(120)
    expect(callsTo("/assistant/transcribe")).toHaveLength(1)
    expect(callsTo("/assistant/voice")).toHaveLength(1)
    expect(playedBlobs()).toEqual(["blob:voice-1"])
  })

  it("a step opened, or the voice switched back on, while the microphone is open is said only once the clip is thrown away", async () => {
    await renderPlayer()
    const first = played[0]
    expect(first, "the first step speaks").toMatch(/^\/sounds\/demo-guide\//)
    await consentAndListen()
    expect(voiceState()).toBe("recording")
    const before = played.length

    // «İrəli» while it listens: the next step opens, and is not read into the question.
    await act(async () => nextButton()!.click())
    await settle()
    expect(played.length, "no step narration over the open microphone").toBe(before)
    // Off and on again: «on» says the step inside the click — that waits as well.
    await act(async () => voiceSwitch().click())
    await act(async () => voiceSwitch().click())
    await settle()
    expect(voiceSwitch().textContent).toContain(S.voiceOff)
    expect(played.length, "no coach-card voice over the open microphone").toBe(before)

    // Thrown away: the guide reads the step it is on now.
    await pointer("pointercancel")
    await settle()
    expect(voiceState()).toBe("idle")
    expect(microphone.live).toBe(0)
    expect(played.length).toBe(before + 1)
    expect(played.at(-1)).toMatch(/^\/sounds\/demo-guide\//)
    expect(played.at(-1), "the new step, not the one before").not.toBe(first)
  })

  it("a scroll that begins on the button, thrown away while the microphone is still opening, cuts nothing off", async () => {
    await renderPlayer()
    await consentAndListen()
    // The consent's own clip is thrown away, and the guide is reading the step again.
    await pointer("pointercancel")
    await settle()
    await act(async () => voiceSwitch().click())
    await act(async () => voiceSwitch().click())
    await settle()
    expect(guideAudio()?.src).toMatch(/^\/sounds\/demo-guide\//)
    expect(guideAudio()?.paused, "the guide is talking").toBe(false)

    // A typed answer's voice is still being made…
    const answer = gate()
    gates.voice = answer.promise
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant/voice")).toHaveLength(1)

    // …when a finger lands on the button and slides on: a scroll.
    const opening = gate()
    gates.microphone = opening.promise
    const pausesBefore = pauses
    await touch("pointerdown", 120, 300)
    expect(voiceState()).toBe("starting")
    await touch("pointermove", 121, 260)
    expect(voiceState()).toBe("idle")
    await touch("pointerup", 121, 240)
    await opening.open()
    await settle()
    expect(microphone.asked).toBe(2)
    expect(microphone.live, "the microphone that opened late is let go at once").toBe(0)
    expect(pauses, "the guide was not cut off").toBe(pausesBefore)
    expect(guideAudio()?.paused).toBe(false)

    await answer.open()
    await settle(80)
    expect(playedBlobs(), "the answer on its way is heard").toEqual(["blob:voice-1"])
    expect(callsTo("/assistant/transcribe")).toEqual([])
  })

  it("a scroll seen only after the microphone opened gives it all back: the guide reads on, and the answer that came back meanwhile is heard", async () => {
    await renderPlayer()
    const first = played[0]
    await consentAndListen()
    expect(guideAudio()?.paused, "the microphone open, the guide is quiet").toBe(true)
    // Thrown away: the guide reads on from where it was.
    await pointer("pointercancel")
    await settle()
    expect(guideAudio()?.src).toBe(first)
    expect(guideAudio()?.paused, "the guide reads on").toBe(false)
    const answer = gate()
    gates.voice = answer.promise
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant/voice")).toHaveLength(1)

    await touch("pointerdown", 120, 300)
    await settle()
    expect(voiceState()).toBe("recording")
    expect(guideAudio()?.paused, "the microphone open, the guide is quiet").toBe(true)
    await answer.open()
    await settle(80)
    expect(playedBlobs(), "not into the open microphone").toEqual([])

    await touch("pointermove", 121, 260)
    expect(voiceState()).toBe("idle")
    await touch("pointerup", 121, 240)
    await settle(80)
    expect(playedBlobs(), "heard once the clip is thrown away").toEqual(["blob:voice-1"])
    expect(callsTo("/assistant/transcribe")).toEqual([])
  })
})

/**
 * A clip that comes back with no question in it (verifier, after 93dca4595):
 * silent, too short, or not heard at all. It asked nothing, so it costs the
 * prospect nothing either: the guide reads on from where the microphone
 * stopped it, and a spoken answer that came back meanwhile, or is still on
 * its way, is heard — as after a clip thrown away.
 */
describe("a clip that comes back with no question in it", () => {
  const emptyClips: ReadonlyArray<{ name: string; reply: typeof transcribeReply; alert: string }> = [
    { name: "silent (422)", reply: { status: 422, body: { success: false, code: "silent", error: DEMO_VOICE_REFUSAL_TEXT.silent } }, alert: DEMO_VOICE_REFUSAL_TEXT.silent },
    { name: "too short (400)", reply: { status: 400, body: { success: false, code: "too_short", error: DEMO_VOICE_REFUSAL_TEXT.too_short } }, alert: DEMO_VOICE_REFUSAL_TEXT.too_short },
    { name: "Google failed (502)", reply: { status: 502, body: { success: false, code: "unavailable", error: DEMO_VOICE_REFUSAL_TEXT.unavailable } }, alert: DEMO_VOICE_REFUSAL_TEXT.unavailable },
    { name: "the request failed", reply: { status: 0, body: {}, fails: true }, alert: S.voiceFailed },
  ]

  it.each(emptyClips)("$name: nothing is asked, and the guide reads on from where the microphone stopped it", async ({ reply: empty, alert }) => {
    await renderPlayer()
    const first = played[0]
    expect(first, "the first step speaks").toMatch(/^\/sounds\/demo-guide\//)
    expect(guideAudio()?.paused, "the guide is talking").toBe(false)
    transcribeReply = empty
    // A tap: the microphone listens, and the guide goes quiet for it.
    await consentAndListen()
    expect(voiceState()).toBe("recording")
    expect(guideAudio()?.paused, "the microphone open, the guide is quiet").toBe(true)

    speakFor(1)
    await press()
    await settle(80)
    expect(callsTo("/assistant/transcribe")).toHaveLength(1)
    expect(voiceState()).toBe("idle")
    expect(voiceAlert()).toBe(alert)
    expect(callsTo("/assistant"), "no question was asked").toEqual([])
    expect(guideAudio()?.src).toBe(first)
    expect(guideAudio()?.paused, "the guide reads on").toBe(false)
  })

  it.each(emptyClips)("$name: a spoken answer that came back while the microphone was open is heard", async ({ reply: empty }) => {
    await renderPlayer()
    // A typed answer's voice is still being made…
    const answer = gate()
    gates.voice = answer.promise
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant/voice")).toHaveLength(1)
    // …when a tap leaves the microphone listening; it comes back meanwhile, and waits.
    transcribeReply = empty
    await consentAndListen()
    expect(voiceState()).toBe("recording")
    await answer.open()
    await settle(80)
    expect(playedBlobs(), "not into the open microphone").toEqual([])

    speakFor(1)
    await press()
    await settle(80)
    expect(callsTo("/assistant"), "the clip asked nothing").toHaveLength(1)
    expect(playedBlobs(), "the answer that waited is heard").toEqual(["blob:voice-1"])
    expect(guideAudio()?.paused).toBe(false)
  })

  it("a spoken answer still on its way while the clip is being heard is played when it lands", async () => {
    await renderPlayer()
    const answer = gate()
    gates.voice = answer.promise
    await askTyped("Bu bal necə hesablanır?")
    transcribeReply = emptyClips[0].reply
    await consentAndListen()
    // The clip is being turned into text: whether it was a question is not known yet.
    const hearing = gate()
    gates.transcribe = hearing.promise
    speakFor(1)
    await press()
    expect(voiceState()).toBe("sending")
    expect(microphone.live, "the microphone is let go as the clip leaves").toBe(0)
    await hearing.open()
    await settle(80)
    expect(voiceState()).toBe("idle")
    expect(playedBlobs()).toEqual([])

    await answer.open()
    await settle(80)
    expect(callsTo("/assistant")).toHaveLength(1)
    expect(playedBlobs(), "the answer on its way is heard").toEqual(["blob:voice-1"])
  })

  it("nothing starts while the clip is being heard, and a clip heard as a question keeps the guide quiet for its answer", async () => {
    await renderPlayer()
    await consentAndListen()
    const hearing = gate()
    gates.transcribe = hearing.promise
    speakFor(1)
    await press()
    expect(voiceState()).toBe("sending")
    const before = played.length
    // The voice switched off and on while the clip is being heard: «on» says the step, and that waits for the reply.
    await act(async () => voiceSwitch().click())
    await act(async () => voiceSwitch().click())
    await settle()
    expect(voiceSwitch().textContent).toContain(S.voiceOff)
    expect(played.length, "nothing starts before the reply says what the clip was").toBe(before)

    await hearing.open()
    await settle(120)
    expect(callsTo("/assistant")).toHaveLength(1)
    expect(JSON.parse(String(callsTo("/assistant")[0].init?.body))).toMatchObject({ question: HEARD })
    // The step is not read over the question; its spoken answer is what plays.
    expect(played.slice(before)).toEqual(["blob:voice-1"])
  })

  it("a page left while its clip is being heard asks nothing, and its late reply does not open the next page's microphone to the guide", async () => {
    await renderPlayer()
    await consentAndListen()
    const hearing = gate()
    gates.transcribe = hearing.promise
    speakFor(1)
    await press()
    expect(voiceState()).toBe("sending")
    act(() => root.unmount())
    root = createRoot(container)
    await renderPlayer()
    await consentAndListen()
    expect(voiceState()).toBe("recording")
    const before = played.length

    // The clip of the page that is gone comes back as text only now.
    await hearing.open()
    await settle(80)
    expect(callsTo("/assistant"), "no question is asked for a page that is gone").toEqual([])
    // This page's microphone is still open: «İrəli» reads nothing into it.
    await act(async () => nextButton()!.click())
    await settle()
    expect(voiceState()).toBe("recording")
    expect(played.length, "no step narration over the open microphone").toBe(before)
  })
})

/**
 * A spoken question heard while a typed one is still being answered
 * (verifier, after 93dca4595): it was shown as «Eşitdim: …», paid for, and
 * asked into an `ask` that was busy — so it was never asked, and the typed
 * answer then wiped it from the box. One question at a time: it waits in the
 * box, it says so, and one press of «Soruş» asks it.
 */
describe("a spoken question heard while another is being answered", () => {
  it("waits in the box, says so, survives the answer before it, and one press of «Soruş» asks it", async () => {
    await renderPlayer()
    await consentAndListen()
    expect(voiceState()).toBe("recording")
    // A tap left the microphone listening; the prospect types a question meanwhile.
    const answer = gate()
    gates.assistant = answer.promise
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant")).toHaveLength(1)
    expect(askButton().textContent).toBe(S.assistantAsking)

    // The clip is stopped while that question is still being answered.
    speakFor(1)
    await press()
    await settle(80)
    expect(container.querySelector('[data-testid="demo-assistant-voice-heard"]')?.textContent).toBe(S.voiceHeard(HEARD))
    expect(callsTo("/assistant"), "one question at a time").toHaveLength(1)
    expect(questionBox().value).toBe(HEARD)

    // The typed answer lands: the spoken question is still in the box, nothing asked it, and the box says so.
    await answer.open()
    await settle(80)
    expect(container.querySelector('[data-testid="demo-assistant-turns"]')?.textContent).toContain("Bu bal necə hesablanır?")
    expect(callsTo("/assistant")).toHaveLength(1)
    expect(questionBox().value, "the answer before it does not wipe it").toBe(HEARD)
    expect(heardWaiting()).toBe(S.voiceHeardWaiting(S.assistantAsk))
    expect(askButton().disabled).toBe(false)

    // One press asks it.
    await act(async () => askButton().click())
    await settle(80)
    const asked = callsTo("/assistant")
    expect(asked).toHaveLength(2)
    expect(JSON.parse(String(asked[1].init?.body))).toMatchObject({ question: HEARD })
    expect(heardWaiting()).toBeNull()
    expect(questionBox().value).toBe("")
  })

  it("heard while a question typed during the clip's hearing is answered: not asked alongside it", async () => {
    await renderPlayer()
    await consentAndListen()
    const hearing = gate()
    gates.transcribe = hearing.promise
    speakFor(1)
    // Stopped while nothing was being asked…
    await press()
    expect(voiceState()).toBe("sending")
    // …then a question typed while the clip is being heard.
    const answer = gate()
    gates.assistant = answer.promise
    await askTyped("Bu bal necə hesablanır?")
    expect(callsTo("/assistant")).toHaveLength(1)

    await hearing.open()
    await settle(80)
    expect(callsTo("/assistant"), "not a second question while the first is answered").toHaveLength(1)
    expect(questionBox().value).toBe(HEARD)
    expect(heardWaiting()).toBe(S.voiceHeardWaiting(S.assistantAsk))

    await answer.open()
    await settle(80)
    expect(questionBox().value).toBe(HEARD)
    await act(async () => askButton().click())
    await settle(80)
    expect(callsTo("/assistant")).toHaveLength(2)
    expect(JSON.parse(String(callsTo("/assistant")[1].init?.body))).toMatchObject({ question: HEARD })
  })
})

/**
 * «İrəli» while a clip is being turned into text (verifier, after
 * 315f12a64): the new step's narration waited for the reply, the reply said
 * «a question», and that dropped it; the question was asked about the step
 * it was sent from, so its answer was not spoken either — the new step said
 * nothing at all. The question is still asked where it was sent from, its
 * answer stays text, and the guide reads the step the prospect moved to.
 */
describe("«İrəli» while a clip is being heard", () => {
  const answers: ReadonlyArray<{ name: string; reply: () => Record<string, unknown>; text: string }> = [
    { name: "a Da Vinci answer", reply: davinci, text: "Bu, lidin balıdır." },
    { name: "a prepared answer", reply: () => ({ success: true, answer: "Sabit tariflər yoxdur.", remaining: 48, source: "prepared", audio: "/sounds/demo-guide/abc.mp3" }), text: "Sabit tariflər yoxdur." },
  ]

  it.each(answers)("$name: the question is asked about the step it was sent from and stays text, and the new step is read", async ({ reply: answer, text }) => {
    await renderPlayer()
    reply = answer()
    await consentAndListen()
    const hearing = gate()
    gates.transcribe = hearing.promise
    speakFor(1)
    await press()
    expect(voiceState()).toBe("sending")
    const sentFrom = frontier()
    const before = played.length

    // The prospect goes on while the clip is being heard: the new step waits for the reply.
    await act(async () => nextButton()!.click())
    await settle()
    const now = frontier()
    expect(now.stepId, "«İrəli» opened another step").not.toBe(sentFrom.stepId)
    expect(played.length, "nothing starts before the reply says what the clip was").toBe(before)

    await hearing.open()
    await settle(120)
    // Still a question, asked about the step it was sent from.
    expect(callsTo("/assistant")).toHaveLength(1)
    expect(JSON.parse(String(callsTo("/assistant")[0].init?.body))).toMatchObject({ question: HEARD, sectionId: sentFrom.sectionId, stepId: sentFrom.stepId })
    expect(container.querySelector('[data-testid="demo-assistant-turns"]')?.textContent).toContain(text)
    // The step on screen is read, and the answer about the step left cuts nothing off.
    const narration = stepVoiceUrl(findStep(PROSPECT_TO_CLOSED_WON, now.stepId)!.step)
    expect(played.slice(before), "the new step is read, and only that").toEqual([narration])
    expect(guideAudio()?.src).toBe(narration)
    expect(guideAudio()?.paused, "the guide reads the new step").toBe(false)
    expect(callsTo("/assistant/voice"), "nothing is paid to be spoken for an answer about a step left").toEqual([])
  })
})
