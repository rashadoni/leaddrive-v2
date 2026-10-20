/**
 * The kill switch for the guide's voice: speaking Da Vinci's answers and the
 * «Səslə soruşun» button (owner, 2026-10-20).
 *
 * Off unless `DEMO_ASSISTANT_VOICE` says on. Off means no button on the page,
 * both voice routes answer 404, the assistant hands out nothing to voice, and
 * the private demo page keeps `microphone=()` like every other public page.
 * Read on every call, so a PM2 restart with a new environment applies at
 * once. No imports: the proxy reads it too, and must not pull anything else
 * into its bundle.
 */
export function demoAssistantVoiceEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const raw = (env.DEMO_ASSISTANT_VOICE ?? "").trim().toLowerCase()
  return raw === "on" || raw === "true" || raw === "1"
}
