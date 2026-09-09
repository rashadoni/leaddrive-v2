// Generate short Azerbaijani TTS samples in several Gemini voices so a human can
// pick the best-sounding one before committing a full guide render.
// Usage: GEMINI_API_KEY=… node scripts/tts-voice-samples.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
if (!key) { console.error("GEMINI_API_KEY required"); process.exit(1); }
const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const voices = (process.env.SAMPLE_VOICES ||
  "Sulafat,Charon,Algieba,Vindemiatrix,Achird,Kore").split(",").map(s => s.trim()).filter(Boolean);
const text = process.env.SAMPLE_TEXT ||
  "AI Məsləhətçi — şirkətin bütün risklərini bir yerə toplayan əməliyyat mərkəzidir. " +
  "O, hər modulu özü tarayır və təhlükəli məqamları hazır qərar kimi qarşına qoyur.";

const outDir = resolve(process.cwd(), "video/voice-samples");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function gen(voice) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = { contents: [{ parts: [{ text }] }], generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } };
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .catch(e => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.status === 429) { console.log(`  ⏳ ${voice}: 429, wait 30s (try ${attempt})`); await sleep(30000); continue; }
    if (!res.ok) { const d = await res.text?.().catch(() => ""); if (res.status >= 500 && attempt < 8) { await sleep(3000); continue; } throw new Error(`${res.status}: ${String(d).slice(0,200)}`); }
    const json = await res.json();
    const b64 = json?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData?.data;
    if (!b64) throw new Error("no audio: " + JSON.stringify(json).slice(0, 200));
    const mp3 = resolve(outDir, `az-${voice}.mp3`);
    const pcm = mp3 + ".pcm";
    writeFileSync(pcm, Buffer.from(b64, "base64"));
    execFileSync("ffmpeg", ["-y","-hide_banner","-loglevel","error","-f","s16le","-ar","24000","-ac","1","-i",pcm,"-codec:a","libmp3lame","-q:a","3",mp3], { stdio: "inherit" });
    rmSync(pcm, { force: true });
    console.log(`  ✔ ${voice} → video/voice-samples/az-${voice}.mp3`);
    return;
  }
  throw new Error(`${voice}: exhausted retries`);
}

console.log(`Generating ${voices.length} az samples: ${voices.join(", ")}`);
for (const v of voices) {
  try { await gen(v); } catch (e) { console.log(`  ✗ ${v}: ${e.message}`); }
  await sleep(12000); // spacing to respect the preview model's per-minute limit
}
console.log("DONE → open video/voice-samples/ and play the mp3s");
