import type { AiProvider } from "./features"

/**
 * The platform's own key for a provider, from the server's environment — the
 * one place it is read. `GEMINI_API_KEY` may hold a comma-separated list
 * (the first is the one in use).
 */
export function platformAiKey(provider: AiProvider, env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const raw = {
    anthropic: env.ANTHROPIC_API_KEY,
    gemini: env.GEMINI_API_KEY,
    openai: env.OPENAI_API_KEY,
    voyage: env.VOYAGE_API_KEY,
    google_vision: env.GOOGLE_VISION_API_KEY,
    // Speech-to-Text runs on a service-account file, not a key (phone line).
    google_speech: undefined,
  }[provider]
  const key = (provider === "gemini" ? raw?.split(",")[0] : raw)?.trim()
  return key || null
}
