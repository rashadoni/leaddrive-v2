import {
  ActivityHandling,
  EndSensitivity,
  Modality,
  StartSensitivity,
  ThinkingLevel,
  TurnCoverage,
  type FunctionDeclaration,
  type LiveConnectConfig,
} from "@google/genai"
import { voiceTools } from "./realtime-tool-contract"

export const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview"
// Chosen by the owner on 2026-08-17 after listening to every preset speak the
// same Azerbaijani sentence. The console assistant and the phone agent are
// deliberately different voices: the phone line is a stranger calling a
// customer, the console is a tool the owner talks to, and hearing the same
// voice in both made the two feel like one system when they are not.
export const GEMINI_LIVE_VOICE = "Algieba"
export const GEMINI_LIVE_API_VERSION = "v1beta"

const TOKEN_CONNECT_WINDOW_MS = 60_000
const TOKEN_EXPIRY_GRACE_MS = 2 * 60_000
// Google requires an explicitly configured expiry to be less than 20 hours.
const MAX_TOKEN_LIFETIME_MS = 19 * 60 * 60_000 + 55 * 60_000

function languageInstruction(locale: string): string {
  const language = locale.split("-")[0]?.toLowerCase()
  if (language === "ru") return "Russian"
  if (language === "en") return "English"
  if (language === "az") return "Azerbaijani"
  return "Azerbaijani"
}

export function geminiLiveSystemInstruction(
  locale: string,
  firstName: string,
): string {
  return [
    // Three languages, not four. Turkish is excluded here for the same reason
    // the phone agent bans it: Azerbaijani and Turkish are close enough that a
    // phrase transcribed in Turkish orthography once flipped an entire call,
    // and the two surfaces should not disagree about which languages exist.
    // Russian and English are far enough from Azerbaijani that the confusion
    // cannot arise, and the owner confirmed both sound right.
    `You are LeadDrive CRM's conversational voice assistant. Start in ${languageInstruction(locale)} and follow the user's language if they switch between Azerbaijani, Russian and English. Never answer in Turkish: if the user speaks Turkish, keep answering in Azerbaijani. Do not mix languages inside one reply.`,
    firstName ? `Address the user as ${firstName}.` : "Do not invent the user's name.",
    // Names no voice: the preset is chosen in GEMINI_LIVE_VOICE and naming a
    // different one here told the model to imitate a voice it is not using.
    "Speak naturally, warmly, and concisely at your normal pace. Do not sound theatrical and do not add filler sounds mechanically.",
    // The prohibition alone was not enough. Asked "what boards are there", the
    // model answered "five" without calling a tool - the real answer was three,
    // with names it never mentioned. A rule that only forbids invention leaves
    // answering-from-memory as the path of least resistance, so the duty to
    // call a tool is now stated first and positively.
    "EVERY question about CRM data - counts, names, lists, amounts, statuses, dates, or 'what is there' - MUST be answered by calling a tool first. You have no knowledge of this organisation's data. If you have not just received a tool result for the exact question asked, you do not know the answer.",
    "Never state a number, a name, or a list that did not come from a tool result in this conversation. If no tool covers the question, or a tool fails, say plainly that you cannot see that data. An honest 'I cannot see that' is always correct; a plausible guess is never acceptable, because the user cannot tell them apart by ear.",
    "You may only read CRM data through the supplied tools. Never invent numbers, records, prices, or statuses.",
    "When asked WHY something happens (leads not converting, sales dropping) or HOW to improve a result: call the relevant read tools FIRST and build the advice on the numbers they return, citing them aloud. Never give general sales wisdom as if it came from this organisation's data; if the data is not reachable, say the advice is general.",
    "Use navigation tools when the user asks to open something. Localized section labels are mapped in the tool schema; if a label is ambiguous, ask which module or qualified label they mean.",
    "Treat tool error codes as final facts: DATA_UNAVAILABLE, REPORTING_TIMEZONE_UNAVAILABLE, and ACCESS_SCOPE_UNAVAILABLE mean the requested data cannot be reported now; MODULE_NOT_ENABLED means the organisation does not have that module, so say so and do not retry it; BAD_ARGUMENTS means your arguments were rejected, so correct them and call once more; SECTION_NOT_AVAILABLE and UNKNOWN_SECTION mean the section cannot be used; NOT_PERMITTED_FOR_ROLE means the user's role cannot access it. State that briefly and never substitute another section, period, record, or invented figure.",
    "read_record is how you answer questions about ONE record's contents - a deal's MEDDPICC, a contact's cashback on it, competitors, an invoice's amount. First find_record, then read_record with the returned id. Fields that come back null are genuinely empty: say the field is not filled in, never substitute a guess.",
    "find_record returns candidates. With zero matches say none were found; with multiple matches or truncated=true ask the user to choose using names and hints; call open_record only after one exact candidate is selected, and never read an opaque id aloud.",
    "BAD_RECORD means the selected record cannot be opened: do not guess another id or type; run find_record again or ask the user to clarify. If a report lists a requested facet or period in unavailable, state that limitation and do not infer the missing result.",
    "When a sales or forecast result includes wonDealsWithoutHistory greater than zero, state that those won deals cannot be assigned to the requested period. If that field is null, state that historical coverage could not be verified. Never present the recorded subset as complete.",
    "Never claim that you changed, deleted, sent, or created CRM data; all available CRM tools are read-only.",
  ].join("\n")
}

function functionDeclarations(
  allowedSections: readonly string[],
  locale: string,
): FunctionDeclaration[] {
  return voiceTools(allowedSections, locale).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  }))
}

/**
 * The complete Gemini Live configuration is minted into the ephemeral token.
 * The browser receives neither the long-lived key nor an opportunity to replace
 * the model, prompt, voice, tools, or VAD policy.
 */
export function geminiLiveConfig(input: {
  locale: string
  firstName: string
  allowedSections: readonly string[]
}): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_LIVE_VOICE } },
    },
    // MINIMAL made the assistant answer before deciding whether it needed a
    // tool, which is exactly how "five boards" happened. LOW leaves it enough
    // room to notice that a question is about data it cannot see.
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    systemInstruction: geminiLiveSystemInstruction(input.locale, input.firstName),
    tools: [{ functionDeclarations: functionDeclarations(input.allowedSections, input.locale) }],
    sessionResumption: {},
    inputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    // The ear, tuned for a room with people in it.
    //
    // HIGH start sensitivity treats a cough, a keyboard or a colleague two desks
    // away as the user beginning to speak, and START_OF_ACTIVITY_INTERRUPTS then
    // stops the assistant mid-sentence — the owner's complaint: "it breaks off
    // on any noise". HIGH end sensitivity with a 400 ms window is the same fault
    // in the other direction: the natural pause before a number or a name ends
    // the turn and the assistant answers half a question.
    //
    // LOW on both, with a longer silence window, costs a fraction of a second of
    // responsiveness and buys a conversation that survives an office. Barge-in
    // still works — real speech clears LOW easily; that is the whole point of
    // the setting, which is why interruption handling itself stays on.
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
        prefixPaddingMs: 300,
        silenceDurationMs: 900,
      },
      activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
      turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
    },
  }
}

/**
 * Token-locked policy. Session resumption is deliberately omitted from the
 * generated field mask: otherwise the SDK masks `sessionResumption` and the
 * token's empty object overwrites the browser's later `{handle}` on reconnect.
 * The browser is allowed to add only this transport-continuity field; all
 * model, prompt, voice, tool, transcription, and VAD fields remain locked.
 */
export function geminiLiveTokenConfig(input: {
  locale: string
  firstName: string
  allowedSections: readonly string[]
}): LiveConnectConfig {
  const locked = { ...geminiLiveConfig(input) }
  delete locked.sessionResumption
  return locked
}

export async function createGeminiLiveToken(input: {
  apiKey: string
  locale: string
  firstName: string
  allowedSections: readonly string[]
  maxSessionSeconds: number
  now?: Date
}): Promise<{ token: string; expiresAt: string }> {
  const now = input.now ?? new Date()
  const requestedLifetimeMs = Math.max(1, input.maxSessionSeconds) * 1000 + TOKEN_EXPIRY_GRACE_MS
  const expiresAt = new Date(now.getTime() + Math.min(requestedLifetimeMs, MAX_TOKEN_LIFETIME_MS))
  const newSessionExpiresAt = new Date(now.getTime() + TOKEN_CONNECT_WINDOW_MS)
  const config = geminiLiveConfig(input)
  const response = await fetch(
    `https://generativelanguage.googleapis.com/${GEMINI_LIVE_API_VERSION}/auth_tokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        expireTime: expiresAt.toISOString(),
        newSessionExpireTime: newSessionExpiresAt.toISOString(),
        uses: 1,
        bidiGenerateContentSetup: {
          model: `models/${GEMINI_LIVE_MODEL}`,
          generationConfig: {
            responseModalities: config.responseModalities,
            speechConfig: config.speechConfig,
            thinkingConfig: config.thinkingConfig,
          },
          systemInstruction: {
            parts: [{ text: String(config.systemInstruction ?? "") }],
            role: "user",
          },
          tools: config.tools,
          inputAudioTranscription: config.inputAudioTranscription,
          realtimeInputConfig: config.realtimeInputConfig,
          contextWindowCompression: config.contextWindowCompression,
        },
        // Explicit top-level paths avoid the SDK 2.17.1 `tools.0` mask bug.
        // Every policy field is locked. Session resumption is omitted from the
        // token setup and mask; the browser supplies `{}` initially and only a
        // provider-issued `{handle}` on reconnect.
        fieldMask: [
          "model",
          "generationConfig",
          "systemInstruction",
          "tools",
          "inputAudioTranscription",
          "realtimeInputConfig",
          "contextWindowCompression",
        ].join(","),
      }),
      signal: AbortSignal.timeout(12_000),
    },
  )
  if (!response.ok) throw new Error(`Gemini Live token mint failed (${response.status})`)
  const token = await response.json() as { name?: unknown }
  if (typeof token.name !== "string" || token.name.length === 0) {
    throw new Error("Gemini Live token response had no token")
  }
  return { token: token.name, expiresAt: expiresAt.toISOString() }
}
