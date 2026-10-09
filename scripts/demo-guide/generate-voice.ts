/**
 * Records every text the demo guide can say (src/lib/demo-center/guide-voice.ts)
 * with Google Gemini TTS and writes public/sounds/demo-guide/<key>.mp3.
 *
 *   GEMINI_API_KEY=… JITI_ALIAS='{"@":"./src"}' npx jiti scripts/demo-guide/generate-voice.ts [--dry-run] [--limit N]
 *
 * Idempotent: a text whose file exists is skipped, so a run stopped by the
 * preview model's quota (~1–2 requests a minute, ~100 a day per key) resumes
 * where it stopped. Extra keys as GEMINI_API_KEY2, GEMINI_API_KEY3 rotate in on
 * a daily-quota refusal. No local TTS, ever (AGENTS.md): no key, no audio.
 * Files whose text the guide no longer says are listed, not deleted.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { DEMO_GUIDE_VOICE, DEMO_GUIDE_VOICE_DIR, demoGuideVoiceTexts, demoVoiceKey } from "../../src/lib/demo-center/guide-voice"
import { GEMINI_TTS_SUCCESSOR, geminiTtsModelRetired, geminiTtsPcm, geminiTtsRequest, geminiTtsTooShort } from "../lib/gemini-tts.mjs"

const OUT_DIR = path.join(process.cwd(), "public", DEMO_GUIDE_VOICE_DIR)
const dryRun = process.argv.includes("--dry-run")
const limitArg = process.argv.indexOf("--limit")
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity

const keys = ["GEMINI_API_KEY", "GEMINI_API_KEY2", "GEMINI_API_KEY3", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"]
  .map((name) => process.env[name]?.trim())
  .filter((value): value is string => Boolean(value))
let keyIndex = 0
const exhausted = new Set<number>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The same delivery the demo clips were read with: calm, clear, unhurried.
// A preview model is told so in the text; a 3.8 model would read that sentence
// into the recording, so it gets the same thing as style metadata instead.
const direction = "Sakit, aydın və mehriban səslə, tələsmədən, Azərbaycan dilində oxu:"
const style = "calm, clear and kind, unhurried"

async function record(text: string, outFile: string): Promise<void> {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    if (exhausted.size >= keys.length) throw new Error("daily TTS quota reached on every key — run again tomorrow")
    while (exhausted.has(keyIndex)) keyIndex = (keyIndex + 1) % keys.length
    const { url, body } = geminiTtsRequest({
      model: DEMO_GUIDE_VOICE.model,
      key: keys[keyIndex]!,
      text,
      voice: DEMO_GUIDE_VOICE.voice,
      direction,
      style,
    })
    let response: Response
    try {
      response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) })
    } catch (error) {
      console.log(`  network: ${(error as Error).message} — retrying`)
      await sleep(5_000)
      continue
    }
    if (response.status === 429) {
      const detail = await response.text().catch(() => "")
      const retry = Number(detail.match(/"retryDelay":\s*"(\d+)s"/)?.[1] ?? 60)
      if (retry > 120 || /per ?day|PerDay/i.test(detail)) {
        exhausted.add(keyIndex)
        console.log(`  key #${keyIndex + 1}: daily quota reached`)
        keyIndex = (keyIndex + 1) % keys.length
        continue
      }
      console.log(`  429 — waiting ${retry + 1}s`)
      await sleep((retry + 1) * 1000)
      continue
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      if (response.status >= 500) { await sleep(5_000); continue }
      // No quiet fallback here, unlike the video generators: a recording is
      // named after the model that read it, and one phrase in a newer voice
      // among fifty in the old one is heard as a different narrator.
      if (geminiTtsModelRetired(DEMO_GUIDE_VOICE.model, response.status)) {
        throw new Error(
          `${DEMO_GUIDE_VOICE.model} has been shut down by Google. Set DEMO_GUIDE_VOICE.model to "${GEMINI_TTS_SUCCESSOR}" `
          + "in src/lib/demo-center/guide-voice.ts and run this again: every phrase is re-recorded under a new name, "
          + "and the old files can then be deleted.",
        )
      }
      throw new Error(`Gemini TTS ${response.status}: ${detail.slice(0, 300)}`)
    }
    const json = await response.json()
    const audio = geminiTtsPcm(json, DEMO_GUIDE_VOICE.model)
    if (!audio) throw new Error(`Gemini TTS returned no audio: ${JSON.stringify(json).slice(0, 300)}`)
    if (geminiTtsTooShort(audio, text)) {
      console.log("  audio far too short for the text — asking again")
      await sleep(5_000)
      continue
    }
    const pcm = `${outFile}.pcm`
    writeFileSync(pcm, audio)
    // Mono speech at 48 kb/s: a sentence is tens of kilobytes.
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm, "-codec:a", "libmp3lame", "-b:a", "48k", outFile])
    rmSync(pcm, { force: true })
    return
  }
  throw new Error("Gemini TTS: out of attempts")
}

async function main() {
  const texts = demoGuideVoiceTexts()
  mkdirSync(OUT_DIR, { recursive: true })
  const wanted = new Map(texts.map((text) => [`${demoVoiceKey(text)}.mp3`, text]))
  const missing = [...wanted].filter(([file]) => !existsSync(path.join(OUT_DIR, file)))
  const stale = readdirSync(OUT_DIR).filter((file) => file.endsWith(".mp3") && !wanted.has(file))
  console.log(`${texts.length} texts, ${missing.length} to record, ${stale.length} no longer said${stale.length ? `: ${stale.join(", ")}` : ""}`)
  if (dryRun) {
    for (const [file, text] of missing) console.log(`  ${file}  ${text.slice(0, 90)}`)
    return
  }
  if (!keys.length) throw new Error("GEMINI_API_KEY is not set — there is no local fallback")
  let done = 0
  for (const [file, text] of missing) {
    if (done >= limit) break
    console.log(`[${done + 1}/${Math.min(missing.length, limit)}] ${file}  ${text.slice(0, 70)}`)
    await record(text, path.join(OUT_DIR, file))
    done += 1
    await sleep(1_500)
  }
  console.log(`recorded ${done}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
