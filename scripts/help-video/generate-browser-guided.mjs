#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, request } from "playwright";
import { requireHelpVideoAuth } from "./auth-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const scenarioPath = resolve(repoRoot, "video/scenarios/browser-guided.json");
const outDir = resolve(repoRoot, "video/player");
const tmpRoot = resolve(repoRoot, "video/.tmp-browser-guided");
const renderer = resolve(repoRoot, "scripts/help-video/render-browser-guided.py");
const locales = ["az", "en", "ru"];
const audioExtensions = [".wav", ".mp3", ".m4a", ".aac"];

const args = parseArgs(process.argv.slice(2));
const slug = args.slug || "ai-actions";
const selectedLocales = (args.locales || "az,en,ru").split(",").map((value) => value.trim()).filter(Boolean);
const requestedBaseUrl = (args.baseUrl || process.env.HELP_VIDEO_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const {
  baseUrl,
  email: helpVideoEmail,
  password: helpVideoPassword,
  organizationSlug: helpVideoOrganizationSlug,
} = requireHelpVideoAuth(requestedBaseUrl);
const approvedAudioDir = args.audioDir || process.env.HELP_VIDEO_APPROVED_AUDIO_DIR || "";
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"))[slug];
if (!scenario) throw new Error(`No browser-guided scenario for slug: ${slug}`);
const viewport = { width: 1440, height: 900 };
const output = { width: 1280, height: 720 };

mkdirSync(outDir, { recursive: true });
mkdirSync(tmpRoot, { recursive: true });

for (const locale of selectedLocales) {
  if (!locales.includes(locale)) throw new Error(`Unsupported locale: ${locale}`);
  await renderLocale(locale);
}

async function renderLocale(locale) {
  const workDir = resolve(tmpRoot, `${slug}-${locale}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const audio = resolveApprovedAudio(locale);
  const audioDuration = ffprobeDuration(audio);
  const captures = await captureScenes(locale, workDir);
  const sceneDurations = durationPlan(scenario.steps, locale, audioDuration);
  const scenes = captures.map((capture, index) => ({
    ...capture,
    duration: sceneDurations[index],
    heading: localized(scenario.steps[index].heading, locale),
    voice: localized(scenario.steps[index].voice, locale),
    action: scenario.steps[index].action,
  }));

  const metaPath = resolve(workDir, "render-meta.json");
  const out = resolve(outDir, `${slug}.${locale}.VOICE.mp4`);
  const poster = resolve(outDir, `${slug}.${locale}.poster.jpg`);
  writeFileSync(
    metaPath,
    JSON.stringify({ workDir, audio, out, poster, scenes }, null, 2),
  );
  execFileSync("python3", [renderer, "--meta", metaPath], { cwd: repoRoot, stdio: "inherit" });
  verifyVideo(out);
  console.log(`rendered ${out}`);
}

async function captureScenes(locale, workDir) {
  const api = await request.newContext({ baseURL: baseUrl });
  const csrf = await (await api.get("/api/auth/csrf")).json();
  await api.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: helpVideoEmail,
      password: helpVideoPassword,
      organizationSlug: helpVideoOrganizationSlug,
      redirect: "false",
      json: "true",
    },
    maxRedirects: 0,
  });
  const session = await (await api.get("/api/auth/session")).json().catch(() => ({}));
  const userId = session?.user?.id || session?.userId || "demo";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport,
    deviceScaleFactor: 1,
  });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseUrl }]);
  const page = await context.newPage();
  await page.addInitScript(({ slug, locale, userId }) => {
    localStorage.setItem(`ld_help_video:v1:${slug}:${locale}`, JSON.stringify({
      expandedSeen: true,
      thumbnailDismissed: true,
    }));
    localStorage.setItem(`leaddrive_tours_${userId}`, JSON.stringify(["aiActions"]));
  }, { slug, locale, userId });

  const captures = [];
  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index];
    await page.goto(`${baseUrl}${step.route || scenario.route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.addStyleTag({
      content: [
        "aside[class*='fixed'][class*='bottom-']{display:none!important}",
        "[class*='fixed'][class*='bottom-'][class*='right-']{display:none!important}",
      ].join("\n"),
    }).catch(() => {});
    if (step.preclick) {
      await page.locator(step.preclick).first().click().catch(() => {});
      await page.waitForTimeout(650);
    }
    const locator = page.locator(step.target).first();
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(350);
    const pointerLocator = page.locator(step.pointerTarget || step.target).first();
    const box = await pointerLocator.boundingBox().catch(() => null);
    const screenshot = resolve(workDir, `scene-${String(index + 1).padStart(2, "0")}.jpg`);
    await page.screenshot({ path: screenshot, fullPage: false, type: "jpeg", quality: 92 });
    captures.push({
      screenshot,
      target: box
        ? mapBrowserPointToVideo(box.x + box.width / 2, box.y + box.height / 2)
        : { x: 640, y: 360 },
    });
  }

  await browser.close();
  await api.dispose();
  return captures;
}

function durationPlan(steps, locale, totalAudio) {
  const weights = steps.map((step) => Math.max(8, wordCount(localized(step.voice, locale)) + wordCount(localized(step.heading, locale)) * 0.5));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight) => Math.max(3.2, (weight / total) * (totalAudio + 0.8)));
}

function wordCount(text) {
  return String(text).split(/\s+/).filter(Boolean).length;
}

function localized(value, locale) {
  if (typeof value === "string") return value;
  return value?.[locale] || value?.en || value?.ru || value?.az || "";
}

function ffprobeDuration(file) {
  return Number(execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf8" },
  ).trim());
}

function verifyVideo(file) {
  const json = JSON.parse(execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", file],
    { encoding: "utf8" },
  ));
  const hasAudio = json.streams?.some((stream) => stream.codec_type === "audio");
  const video = json.streams?.find((stream) => stream.codec_type === "video");
  if (!hasAudio || !video || Number(json.format?.duration || 0) < 10) {
    throw new Error(`Rendered video failed verification: ${file}`);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveApprovedAudio(locale) {
  if (!approvedAudioDir) {
    throw new Error(
      [
        "Approved narration audio is required.",
        "Local TTS is prohibited by AGENTS.md and docs/help-video-audit-2026-07-03.md.",
        "Pass --audioDir <dir> or HELP_VIDEO_APPROVED_AUDIO_DIR with files named like ai-actions.ru.wav/mp3/m4a/aac.",
      ].join(" "),
    );
  }
  const base = resolve(repoRoot, approvedAudioDir);
  const stems = [`${slug}.${locale}`, `${slug}-${locale}`, `narration.${locale}`, locale];
  for (const stem of stems) {
    for (const ext of audioExtensions) {
      const candidate = resolve(base, `${stem}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`No approved narration audio found for ${slug}/${locale} in ${base}`);
}

function mapBrowserPointToVideo(x, y) {
  const scale = Math.max(output.width / viewport.width, output.height / viewport.height);
  const scaledWidth = viewport.width * scale;
  const scaledHeight = viewport.height * scale;
  const cropX = Math.max(0, (scaledWidth - output.width) / 2);
  const cropY = Math.max(0, (scaledHeight - output.height) / 2);
  return {
    x: clamp(x * scale - cropX, 48, output.width - 48),
    y: clamp(y * scale - cropY, 48, output.height - 48),
  };
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
