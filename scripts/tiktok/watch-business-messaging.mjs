#!/usr/bin/env node
/**
 * Noticing the day TikTok starts issuing Business Messaging access again.
 *
 * Why anything watches at all: TikTok's support said plainly on 2026-11-22 that they cannot flag an
 * account, subscribe an app to a notification or tell a developer when the revised onboarding opens
 * — «monitoring the TikTok for Developers Portal» is on us. Until it opens, the direct messages of
 * our own CRM stay shut while every vendor that got in earlier keeps working.
 *
 * Why a browser: there is nothing to fetch. Checked 2026-11-26 — the docs pages are a Next.js shell
 * whose HTML carries only a title (36 KB of script, 48 characters of text), `__NEXT_DATA__` holds
 * nothing but SEO fields, the content arrives from code, and there is no JSON mirror, no `.md`
 * twin, no RSS and no `llms.txt`. A plain GET sees an empty page, so this renders it.
 *
 * What it cannot watch, and why: our app's own «Scope of permission» page is the authoritative
 * answer, and it needs the owner's portal session. Nothing here logs in, keeps a cookie or touches
 * the account — it reads two public pages:
 *
 *   • the Business Messaging product overview — where the product's own wording lives;
 *   • «What's New», TikTok's weekly changelog for the whole API.
 *
 * It speaks only when the words change, and it says so loudly when the new words are about
 * applications, onboarding or access — that is the sentence we are waiting for. A watcher that
 * reports every week that nothing happened stops being read by the third week.
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"

export const WATCHED_PAGES = [
  // The product's own page: short, and every word on it is about this product, so any change is
  // worth a line.
  { key: "business-messaging", title: "Business Messaging API", url: "https://business-api.tiktok.com/portal/docs/business-messaging-api/v1.3", watch: "all" },
  // The whole API's weekly changelog — it changes every week by design. Only the lines that name
  // messaging are news here; without that filter the watch would speak every Monday about ad
  // campaigns and be muted by the third one.
  { key: "whats-new", title: "What's New", url: "https://business-api.tiktok.com/portal/docs/whats-new/v1.3", watch: "messaging" },
]

/** On the changelog, only these lines are about us. */
export const MESSAGING_WORDS = ["business messaging", "direct message", "message.list", "messaging api"]

/**
 * Words that turn a documentation edit into news. A changed sentence carrying one of these is the
 * thing we are waiting for; anything else is a typo fix and gets a quieter line.
 */
export const OPENING_WORDS = [
  "application", "applications", "apply", "onboarding", "request access", "access request",
  "now available", "general availability", "allowlist", "eligible", "eligibility",
]

const STATE_DIR = process.env.LD_TIKTOK_WATCH_STATE ?? path.join(process.env.HOME ?? "", ".local/state/ld-tiktok-watch")
const NOTIFY = process.env.LD_TIKTOK_WATCH_NOTIFY ?? path.join(process.env.HOME ?? "", "bin/notify-telegram")
const RENDER_TIMEOUT_MS = 60_000

export const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16)

/** Page text as one line per sentence-ish block, so a diff names what changed rather than «something». */
export function normalise(text) {
  return String(text ?? "")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
}

/**
 * What to say about one page, given what it said last time.
 *
 * The first run is silent on purpose: it has nothing to compare with, and a watcher whose first act
 * is to shout teaches its reader to ignore it. A page that stops rendering is reported once, after
 * a second failure in a row — one bad network minute is not news either.
 */
export function decidePage({ page, previous, current, failure }) {
  const before = previous ?? { hash: null, lines: [], failures: 0 }
  if (failure) {
    const failures = (before.failures ?? 0) + 1
    const state = { ...before, failures, lastFailure: failure }
    // Twice in a row: either TikTok changed the page beyond recognition or the renderer is broken.
    // Both mean the watch is not watching, which the owner has to know.
    return { state, alerts: failures === 2 ? [{ level: "warn", text: `TikTok: не смог прочитать «${page.title}» два раза подряд (${failure}). Сторож не следит, пока это так.` }] : [] }
  }

  const lines = current
  const hash = digest(lines.join("\n"))
  const state = { hash, lines, failures: 0 }
  const alerts = []
  // Say it recovered, once, so a silent watcher is never mistaken for a working one.
  if ((before.failures ?? 0) >= 2) alerts.push({ level: "info", text: `TikTok: «${page.title}» снова читается.` })
  // Nothing to compare with yet, or nothing changed.
  if (!before.hash || before.hash === hash) return { state, alerts }

  const known = new Set(before.lines ?? [])
  let added = lines.filter((line) => !known.has(line))
  if (page.watch === "messaging") {
    added = added.filter((line) => MESSAGING_WORDS.some((word) => line.toLowerCase().includes(word)))
    // A week of changes that says nothing about messaging is not news; the new text is remembered
    // so the same lines are not weighed again.
    if (added.length === 0) return { state, alerts }
  }
  const news = added.filter((line) => OPENING_WORDS.some((word) => line.toLowerCase().includes(word)))
  const quote = (list) => list.slice(0, 4).map((line) => `• ${line.length > 220 ? `${line.slice(0, 217)}…` : line}`).join("\n")
  if (news.length > 0) {
    return {
      state,
      alerts: [...alerts, {
        level: "open",
        text: `TikTok, «${page.title}» — появились слова про доступ и заявки:\n${quote(news)}\n${page.url}`,
      }],
    }
  }
  return {
    state,
    alerts: [...alerts, {
      level: "info",
      text: added.length > 0
        ? `TikTok, «${page.title}» изменилась:\n${quote(added)}\n${page.url}`
        : `TikTok, «${page.title}»: текст изменился (что-то убрали).\n${page.url}`,
    }],
  }
}

/** Reads the whole watch's verdict. Pure: the pages come from the caller. */
export function decide({ previous, pages }) {
  const state = {}
  const alerts = []
  for (const page of WATCHED_PAGES) {
    const read = pages[page.key] ?? { failure: "not read" }
    const verdict = decidePage({ page, previous: previous?.[page.key], current: read.lines, failure: read.failure })
    state[page.key] = verdict.state
    alerts.push(...verdict.alerts)
  }
  return { state, alerts }
}

function readState() {
  try {
    return JSON.parse(readFileSync(path.join(STATE_DIR, "state.json"), "utf8"))
  } catch {
    return {}
  }
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(path.join(STATE_DIR, "state.json"), `${JSON.stringify(state, null, 2)}\n`)
}

function tell(text) {
  const sent = spawnSync(NOTIFY, [text], { encoding: "utf8", timeout: 30_000 })
  if (sent.status !== 0) console.error(`notify failed: ${sent.stderr || sent.error || sent.status}`)
}

/** Renders one page with the browser the repository already installs for its end-to-end tests. */
async function renderPage(browser, page) {
  const context = await browser.newContext({ locale: "en-US" })
  try {
    const tab = await context.newPage()
    await tab.goto(page.url, { waitUntil: "networkidle", timeout: RENDER_TIMEOUT_MS })
    // The shell renders before the text does, and `main` also holds the sidebar and whatever banner
    // TikTok is running that month — the article alone is `.doc-content-body`.
    const article = () => document.querySelector(".doc-content-body, [class*=doc-content]")?.innerText ?? ""
    await tab.waitForFunction(() => (document.querySelector(".doc-content-body, [class*=doc-content]")?.innerText ?? "").length > 300, null, { timeout: RENDER_TIMEOUT_MS })
    const text = await tab.evaluate(article)
    const lines = normalise(text)
    return lines.length > 5 ? { lines } : { failure: `only ${lines.length} lines` }
  } catch (error) {
    return { failure: error instanceof Error ? error.message.split("\n")[0] : "render failed" }
  } finally {
    await context.close().catch(() => {})
  }
}

async function main() {
  const { chromium } = await import("playwright-core")
  const browser = await chromium.launch({ headless: true })
  const pages = {}
  try {
    for (const page of WATCHED_PAGES) pages[page.key] = await renderPage(browser, page)
  } finally {
    await browser.close().catch(() => {})
  }
  const previous = readState()
  const { state, alerts } = decide({ previous, pages })
  writeState(state)
  for (const alert of alerts) tell(alert.text)
  console.log(JSON.stringify({
    checked: WATCHED_PAGES.map((page) => ({ page: page.key, ok: !pages[page.key]?.failure, hash: state[page.key]?.hash ?? null })),
    alerts: alerts.map((alert) => alert.level),
  }))
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
