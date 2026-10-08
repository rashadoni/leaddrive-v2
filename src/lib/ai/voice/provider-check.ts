import { GoogleGenAI, type FunctionCall, type LiveServerMessage } from "@google/genai"
import {
  createGeminiLiveToken,
  GEMINI_LIVE_API_VERSION,
  type GeminiLiveModel,
} from "./gemini-live"
import {
  geminiAudioParts,
  geminiFunctionCalls,
  geminiFunctionResponse,
} from "./gemini-live-browser"
import { VOICE_SECTION_KEYS } from "./sections"

/**
 * Ask the real provider whether a Live model will hold a CRM voice session.
 *
 * Every other voice test stops at the request we send. This one sends it: it
 * mints the same sealed token the console gets, opens the session the browser
 * would open, and reports what Google did with it. It exists because a model
 * change cannot be proven any other way - a setup field the next model rejects
 * looks identical to a working one until a session is opened with it.
 *
 * It runs where the key already is (the server, behind the cron secret), so
 * checking production needs no copy of the key anywhere else.
 *
 * Two depths:
 *
 * - setup only: the provider accepted the model, the prompt, every tool
 *   declaration and the audio policy. No model turn, nothing billed.
 * - one turn: a data question in text, with the tool result held back. A model
 *   that keeps talking while a tool runs - the default from 3.8 Live on -
 *   finishes its turn inside that pause, and every "call a tool first" rule in
 *   the prompt is worth nothing. Then the result is sent in the browser's own
 *   response shape and the reply must come back as audio the console can play.
 */
export type GeminiLiveProviderCheck = Readonly<{
  model: string
  /** The provider accepted the whole sealed setup. */
  setupComplete: boolean
  /** `null` when no turn was asked for, or the session never opened. */
  toolFirst: null | Readonly<{
    /** The first tool the model called; `null` if it answered without one. */
    tool: string | null
    /** It called a tool and had not finished its turn when the withheld result was released. */
    waitedForResult: boolean
    /** It then spoke, as 24 kHz PCM16. */
    audioAfterResult: boolean
  }>
  /** Why it stopped, in the provider's words where it gave any. */
  failure: string | null
  ms: number
}>

export function providerCheckPassed(check: GeminiLiveProviderCheck): boolean {
  if (!check.setupComplete || check.failure !== null) return false
  const turn = check.toolFirst
  return turn === null || (turn.waitedForResult && turn.audioAfterResult)
}

export type ProviderCheckSession = Readonly<{
  sendClientContent: (params: { turns: string; turnComplete: boolean }) => void
  sendToolResponse: (params: { functionResponses: ReturnType<typeof geminiFunctionResponse>[] }) => void
  close: () => void
}>

export type ProviderCheckConnect = (input: {
  token: string
  model: string
  onmessage: (message: LiveServerMessage) => void
  /** The socket errored or closed. Reported once per event; may follow close(). */
  onfailure: (reason: string) => void
}) => Promise<ProviderCheckSession>

const QUESTION = "How many leads do we have right now?"
const HOLD_MS = 4_000
const TIMEOUT_MS = 45_000

const connectWithSdk: ProviderCheckConnect = ({ token, model, onmessage, onfailure }) => {
  const client = new GoogleGenAI({
    apiKey: token,
    httpOptions: { apiVersion: GEMINI_LIVE_API_VERSION },
  })
  return client.live.connect({
    model,
    // The one field the token leaves to the browser; the browser sends this.
    config: { sessionResumption: {} },
    callbacks: {
      onopen: () => {},
      onmessage,
      onerror: (event) => onfailure(`error: ${String(event.message ?? "")}`),
      onclose: (event) => onfailure(`closed: ${event.code} ${String(event.reason ?? "")}`),
    },
  })
}

/** A reason is diagnostics, not a place for a credential to end up. */
function bounded(reason: unknown): string {
  return String(reason instanceof Error ? reason.message : reason)
    .replace(/auth_tokens\/[\w-]+/g, "auth_tokens/...")
    .replace(/access_token=[^&\s]+/g, "access_token=...")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
}

export async function checkGeminiLiveProvider(input: {
  apiKey: string
  model: GeminiLiveModel
  /** Also ask one data question and watch the order of events. */
  turn: boolean
  connect?: ProviderCheckConnect
  mint?: typeof createGeminiLiveToken
  holdMs?: number
  timeoutMs?: number
}): Promise<GeminiLiveProviderCheck> {
  const started = Date.now()
  const connect = input.connect ?? connectWithSdk
  const mint = input.mint ?? createGeminiLiveToken
  const holdMs = input.holdMs ?? HOLD_MS

  let credential: Awaited<ReturnType<typeof createGeminiLiveToken>>
  try {
    // The console's own mint, with every section a session could publish.
    credential = await mint({
      apiKey: input.apiKey,
      locale: "en",
      firstName: "",
      allowedSections: VOICE_SECTION_KEYS,
      maxSessionSeconds: 60,
      model: input.model,
    })
  } catch (error) {
    return {
      model: input.model.id,
      setupComplete: false,
      toolFirst: null,
      failure: bounded(error),
      ms: Date.now() - started,
    }
  }

  return new Promise<GeminiLiveProviderCheck>((resolve) => {
    let session: ProviderCheckSession | null = null
    let settled = false
    let setupComplete = false
    let asked = false
    let firstTool: string | null = null
    let sawToolCall = false
    let answered = false
    let finishedBeforeResult = false
    let audioAfterResult = 0
    let held: FunctionCall[] = []
    let holdTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (failure: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(holdTimer)
      try { session?.close() } catch { /* already closed */ }
      resolve({
        model: credential.model,
        setupComplete,
        toolFirst: input.turn && asked
          ? {
            tool: firstTool,
            waitedForResult: sawToolCall && !finishedBeforeResult,
            audioAfterResult: audioAfterResult > 0,
          }
          : null,
        failure,
        ms: Date.now() - started,
      })
    }

    const answer = (calls: FunctionCall[]) => {
      if (settled || !session || calls.length === 0) return
      session.sendToolResponse({
        functionResponses: calls.map((call) => geminiFunctionResponse(call, JSON.stringify({ total: 7 }))),
      })
    }

    // Setup and the session handle arrive in either order.
    const proceed = () => {
      if (settled || asked || !session || !setupComplete) return
      if (!input.turn) {
        finish(null)
        return
      }
      asked = true
      session.sendClientContent({ turns: QUESTION, turnComplete: true })
    }

    const onmessage = (message: LiveServerMessage) => {
      if (settled) return
      try {
        if (message.setupComplete) {
          setupComplete = true
          proceed()
          return
        }
        // Throws on anything but 24 kHz PCM16 - the same check that ends a
        // real conversation with "connection lost".
        const audio = geminiAudioParts(message)
        if (answered) audioAfterResult += audio.length

        const calls = geminiFunctionCalls(message)
        if (calls.length > 0) {
          if (answered) {
            answer(calls)
          } else {
            held = [...held, ...calls]
            if (!sawToolCall) {
              sawToolCall = true
              firstTool = calls[0]?.name ?? null
              holdTimer = setTimeout(() => {
                answered = true
                answer(held)
                held = []
              }, holdMs)
            }
          }
        }

        if (message.serverContent?.turnComplete) {
          if (!answered) finishedBeforeResult = true
          finish(null)
        }
      } catch (error) {
        finish(bounded(error))
      }
    }

    const deadline = setTimeout(
      () => finish(setupComplete ? "no complete answer in time" : "setupComplete timed out"),
      input.timeoutMs ?? TIMEOUT_MS,
    )

    connect({
      token: credential.token,
      model: credential.model,
      onmessage,
      onfailure: (reason) => finish(bounded(reason)),
    }).then(
      (connected) => {
        if (settled) {
          try { connected.close() } catch { /* already closed */ }
          return
        }
        session = connected
        proceed()
      },
      (error) => finish(bounded(error)),
    )
  })
}
