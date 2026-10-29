#!/usr/bin/env node
// Zeytun line watch: one pass per timer tick (every minute) on the operator
// workstation, the way the Kafka watch runs (scripts/event-platform/cluster/
// watch.mjs). Owner, 2026-10-28: «сторож линии с сообщением в Telegram».
//
// It asks the line the way the PBX station does — app.leaddrivecrm.org,
// through Cloudflare and nginx, to the line process — whether a call would be
// taken now (/api/internal/voice-agent/line-health: the line grant, its
// catalog, the call lookup in the database). A problem is told on Telegram
// after two passes in a row, once, with a reminder while it lasts, and its end
// once it is gone for two passes. No loops, no sleeps: state lives in
// $LD_LINE_WATCH_STATE between ticks.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HEALTH_URL = 'https://app.leaddrivecrm.org/api/internal/voice-agent/line-health'
export const CONFIRM_PASSES = 2
export const REMIND_MS = { critical: 3600_000, warning: 24 * 3600_000 }
// The station waits 4 s for a lookup and 5 s for the answered mark.
export const SLOW_MS = 3000
export const TIMEOUT_MS = 10_000

const CHECKS = {
  grant: 'разрешение линии не действует (файл разрешения, срок или номер)',
  catalog: 'каталог Зейтуна не загружен или старше суток',
  database: 'нет ответа базы',
}

// One pass's answer -> its problems. `answer` is { status, body, ms } or { error }.
export function evaluate(answer) {
  if (answer.error || ![200, 503].includes(answer.status) || typeof answer.body?.ok !== 'boolean') {
    const why = answer.error ?? `ответ ${answer.status ?? '—'}${answer.body ? '' : ' не от CRM'}`
    return [{ id: 'line-unreachable', severity: 'critical', title: 'Линия Зейтуна не отвечает станции',
      detail: `CRM не ответила на проверку тем путём, каким ходит станция (${why}). Звонки на линию сейчас, скорее всего, не принимаются.` }]
  }
  const problems = []
  if (!answer.body.ok) {
    const failing = Object.entries(CHECKS).filter(([key]) => answer.body.checks?.[key] !== true).map(([, text]) => text)
    problems.push({ id: 'line-not-ready', severity: 'critical', title: 'Линия Зейтуна не примет звонок',
      detail: `Не готово: ${failing.join('; ') || 'неизвестно что'}. ИИ на такой звонок не ответит.` })
  }
  if (answer.body.proc !== 'line') {
    problems.push({ id: 'line-on-web', severity: 'warning', title: 'Линия работает через запасной веб-процесс',
      detail: 'Процесс линии не принял соединение, станции отвечает основной веб. Звонки идут, но в начале минуты веб отвечает медленно — так 28.10 оборвался звонок.' })
  }
  if (answer.ms > SLOW_MS) {
    problems.push({ id: 'line-slow', severity: 'warning', title: 'Линия отвечает медленно',
      detail: `Проверка шла ${(answer.ms / 1000).toFixed(1)} с; станция ждёт поиск 4 с, отметку «отвечено» 5 с.` })
  }
  return problems
}

// Pure state transition: previous state + problems of this pass -> new state
// and the messages to send. `sent` is applied only after Telegram accepted.
export function step(state, problems, now) {
  const incidents = { ...(state.incidents ?? {}) }
  const current = new Map(problems.map((p) => [p.id, p]))
  const raise = [], remind = [], clear = []
  for (const p of problems) {
    const prev = incidents[p.id]
    const next = { ...prev, problem: p, seen: (prev?.seen ?? 0) + 1, missing: 0, since: prev?.since ?? now }
    if (!next.reported && next.seen >= CONFIRM_PASSES) raise.push(p.id)
    else if (next.reported && now - next.reported >= REMIND_MS[p.severity]) remind.push(p.id)
    incidents[p.id] = next
  }
  for (const [id, inc] of Object.entries(incidents)) {
    if (current.has(id)) continue
    if (!inc.reported) { delete incidents[id]; continue }
    inc.missing = (inc.missing ?? 0) + 1
    if (inc.missing >= CONFIRM_PASSES) clear.push(id)
  }
  return { incidents, raise, remind, clear }
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku' })

export function messages({ incidents, raise, remind, clear }) {
  const out = []
  const lines = (ids) => ids.map((id) => `• ${incidents[id].problem.title}. ${incidents[id].problem.detail}`).join('\n\n')
  if (raise.length) {
    const critical = raise.some((id) => incidents[id].problem.severity === 'critical')
    out.push({ ids: raise, kind: 'raise', title: `${critical ? '❗' : '⚠️'} ${raise.length === 1 ? incidents[raise[0]].problem.title : `Линия Зейтуна: ${raise.length} проблемы`}`,
      text: `${lines(raise)}\n\nЗамечено в ${hhmm(Math.min(...raise.map((id) => incidents[id].since)))} по Баку. Перешли это сообщение в сессию Claude, чтобы разобраться.` })
  }
  if (remind.length) {
    out.push({ ids: remind, kind: 'remind', title: `⏰ Линия Зейтуна: всё ещё не исправлено`,
      text: `${lines(remind)}\n\nС ${hhmm(Math.min(...remind.map((id) => incidents[id].since)))} по Баку.` })
  }
  if (clear.length) {
    out.push({ ids: clear, kind: 'clear', title: '✅ Линия Зейтуна: снова в порядке',
      text: clear.map((id) => `• ${incidents[id].problem.title} — с ${hhmm(incidents[id].since)}`).join('\n') })
  }
  return out
}

export function applySent(incidents, message, now) {
  for (const id of message.ids) {
    if (message.kind === 'clear') delete incidents[id]
    else incidents[id] = { ...incidents[id], reported: now }
  }
}

// Monday, from 09:00 Baku time, once a week: the watch is alive and what it saw.
export function weeklyDue(lastWeekly, now) {
  const baku = new Date(now + 4 * 3600_000)
  return baku.getUTCDay() === 1 && baku.getUTCHours() >= 9 && now - (lastWeekly ?? 0) > 6 * 24 * 3600_000
}

export function weeklyNote(week) {
  const passes = week?.passes ?? 0, failed = week?.failed ?? 0
  return { ids: [], kind: 'weekly', title: '🟢 Линия Зейтуна: сторож работает',
    text: `Проверяю линию каждую минуту. За неделю ${passes} проверок, линия не была готова в ${failed}.` }
}

export async function ask(url = HEALTH_URL, fetchImpl = fetch, clock = () => performance.now()) {
  const started = clock()
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'ld-line-watch' },
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    const text = await response.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* Cloudflare or nginx page */ }
    return { status: response.status, body, ms: Math.round(clock() - started) }
  } catch (error) {
    return { error: error?.name === 'TimeoutError' ? `нет ответа за ${TIMEOUT_MS / 1000} с` : (error?.cause?.code ?? error?.name ?? 'сбой сети') }
  }
}

function sh(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, killSignal: 'SIGKILL' }, (error) => resolve(error ? (error.code ?? 1) : 0))
  })
}

async function main() {
  const stateDir = process.env.LD_LINE_WATCH_STATE ?? path.join(process.env.HOME, '.local/state/ld-line-watch')
  const notify = process.env.LD_LINE_WATCH_NOTIFY ?? path.join(process.env.HOME, 'bin/notify-telegram')
  const dryRun = process.argv.includes('--dry-run')
  // Marks a live drill's messages, e.g. "[проверка] ", run with its own state dir.
  const prefix = process.env.LD_LINE_WATCH_PREFIX ?? ''
  const url = process.env.LD_LINE_WATCH_URL ?? HEALTH_URL
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })

  if (process.argv.includes('--notify-failure')) {
    // OnFailure of the watch unit: the owner must not read silence as health.
    const stamp = path.join(stateDir, 'failure-notified')
    if (existsSync(stamp) && Date.now() - Number(readFileSync(stamp, 'utf8')) < 6 * 3600_000) return
    const code = await sh(notify, [prefix + '⚠️ Сторож линии Зейтуна сам сломался',
      'Проверка линии не смогла выполниться, поэтому тревоги о линии сейчас не придут. Перешли это сообщение в сессию Claude.'], 30_000)
    if (code === 0) writeFileSync(stamp, String(Date.now()))
    return
  }

  // When this box itself is offline every probe fails; that is not an incident.
  const online = await ask('https://api.telegram.org')
  if (online.error) { console.log('this box is offline; pass not counted'); return }

  const answer = await ask(url)
  const problems = evaluate(answer)
  console.log(`line: ${answer.error ?? `${answer.status} ok=${answer.body?.ok} proc=${answer.body?.proc} ${answer.ms} ms`}; problems: ${problems.map((p) => p.id).join(', ') || 'none'}`)

  const stateFile = path.join(stateDir, 'state.json')
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}
  const now = Date.now()
  const next = step(state, problems, now)
  const week = { passes: (state.week?.passes ?? 0) + 1, failed: (state.week?.failed ?? 0) + (problems.some((p) => p.severity === 'critical') ? 1 : 0) }
  const outgoing = messages(next)
  if (weeklyDue(state.lastWeekly, now) && !Object.values(next.incidents).some((i) => i.reported)) outgoing.push(weeklyNote(week))
  let lastWeekly = state.lastWeekly
  for (const message of outgoing) {
    if (dryRun) { console.log(`[dry-run] ${message.title}\n${message.text}`); continue }
    const code = await sh(notify, [prefix + message.title, message.text], 30_000)
    if (code !== 0) { console.log(`telegram send failed, will retry: ${message.title}`); continue }
    console.log(`sent: ${message.title}`)
    if (message.kind === 'weekly') { lastWeekly = now; week.passes = 0; week.failed = 0 } else applySent(next.incidents, message, now)
  }
  if (dryRun) return
  const tmp = `${stateFile}.tmp`
  writeFileSync(tmp, JSON.stringify({ incidents: next.incidents, lastWeekly, week, lastPass: now }, null, 1), { mode: 0o600 })
  renameSync(tmp, stateFile)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exit(1) })
}
