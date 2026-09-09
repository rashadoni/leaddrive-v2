#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const scenarioPath = resolve(repoRoot, "video/scenarios/browser-guided.json");
const defaultOutDir = resolve(repoRoot, "video/approved-audio");

loadProjectEnv();

const localeConfig = {
  az: { lang: "az-AZ", voice: "az-AZ-BabekNeural" },
  en: { lang: "en-US", voice: "en-US-Ava:DragonHDLatestNeural" },
  ru: { lang: "ru-RU", voice: "ru-RU-DmitryNeural" },
};

const args = parseArgs(process.argv.slice(2));
const slug = args.slug || "ai-actions";
const selectedLocales = (args.locales || "az,en,ru").split(",").map((value) => value.trim()).filter(Boolean);
const outDir = resolve(repoRoot, args.outDir || process.env.HELP_VIDEO_APPROVED_AUDIO_DIR || defaultOutDir);
const region = args.region || firstEnv("AZURE_SPEECH_REGION", "SPEECH_REGION", "AZURE_AI_SPEECH_REGION", "MICROSOFT_SPEECH_REGION");
const key = args.key || firstEnv("AZURE_SPEECH_KEY", "SPEECH_KEY", "AZURE_AI_SPEECH_KEY", "MICROSOFT_SPEECH_KEY");
const endpoint = (args.endpoint || firstEnv("AZURE_SPEECH_ENDPOINT", "SPEECH_ENDPOINT", "AZURE_AI_SPEECH_ENDPOINT", "MICROSOFT_SPEECH_ENDPOINT")).replace(/\/$/, "");
const outputFormat = args.outputFormat || process.env.AZURE_SPEECH_OUTPUT_FORMAT || "audio-24khz-160kbitrate-mono-mp3";
const scenarios = JSON.parse(readFileSync(scenarioPath, "utf8"));
const scenario = scenarios[slug];

if (!scenario) throw new Error(`No browser-guided scenario for slug: ${slug}`);
if (!key) throw new Error("Azure Speech key is required. Use AZURE_SPEECH_KEY or SPEECH_KEY in your shell/.env. Do not commit this secret.");
if (!region && !endpoint) throw new Error("Azure Speech region or endpoint is required. Use AZURE_SPEECH_REGION or AZURE_SPEECH_ENDPOINT.");

mkdirSync(outDir, { recursive: true });

for (const locale of selectedLocales) {
  if (!localeConfig[locale]) throw new Error(`Unsupported locale: ${locale}`);
  const text = narrationText(locale);
  const voice = args[`voice.${locale}`] || process.env[`AZURE_SPEECH_VOICE_${locale.toUpperCase()}`] || localeConfig[locale].voice;
  const lang = localeConfig[locale].lang;
  const audio = await synthesize({ text, voice, lang });
  const outPath = resolve(outDir, `${slug}.${locale}.mp3`);
  writeFileSync(outPath, Buffer.from(audio));
  console.log(`wrote ${outPath}`);
}

async function synthesize({ text, voice, lang }) {
  const url = endpoint
    ? `${endpoint}/tts/cognitiveservices/v1`
    : `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": outputFormat,
      "User-Agent": "leaddrive-help-video-generator",
    },
    body: ssml({ text, voice, lang }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Azure Speech synthesis failed: ${response.status} ${response.statusText} ${body.slice(0, 500)}`);
  }

  return response.arrayBuffer();
}

function ssml({ text, voice, lang }) {
  return [
    `<speak version="1.0" xml:lang="${escapeXml(lang)}" xmlns="http://www.w3.org/2001/10/synthesis">`,
    `  <voice name="${escapeXml(voice)}">`,
    `    <prosody rate="-4%">${escapeXml(text)}</prosody>`,
    "  </voice>",
    "</speak>",
  ].join("\n");
}

function narrationText(locale) {
  return [
    localized(scenario.title, locale),
    localized(scenario.goal, locale),
    ...scenario.steps.map((step) => `${localized(step.heading, locale)}. ${localized(step.voice, locale)}`),
  ].join("\n\n");
}

function localized(value, locale) {
  if (typeof value === "string") return value;
  return value?.[locale] || value?.en || value?.ru || value?.az || "";
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=");
    parsed[key] = inline ?? values[index + 1];
    if (inline === undefined) index += 1;
  }
  return parsed;
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

function loadProjectEnv() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(repoRoot, name);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = unquoteEnvValue(rawValue);
    }
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
