#!/usr/bin/env node
// Kafka platform watch: one pass per timer tick on the operator workstation.
// Probes every host of the primary cluster and the CDC source over the watch
// key (forced command, read-only), asks one broker for the cluster view,
// evaluates, and tells the owner on Telegram through $LD_KAFKA_WATCH_NOTIFY.
//
// A second copy runs on BACKUP_WATCH_HOST, outside the workstation's provider
// (LD_KAFKA_WATCH_ROLE=backup). Each finished pass here leaves a heartbeat
// there; while it is fresh the backup only keeps itself alive. When it stops,
// the backup says the main watch is silent and watches Kafka itself until the
// heartbeat returns. This watch in turn reports a backup that stopped passing.
//
// A problem is reported after it was seen on two passes in a row, once per
// incident, with a reminder a day later if it is still there; its end is
// reported once it is gone for two passes. No loops, no sleeps: state lives in
// $LD_KAFKA_WATCH_STATE between ticks.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, summary } from './health.mjs'
import { loadTopology, SOURCE_ROLE } from './render.mjs'

export const CONFIRM_PASSES = 2
export const REMIND_MS = 24 * 3600_000
// OVH Gravlin: another provider than the workstation (Contabo) and production.
export const BACKUP_WATCH_HOST = 'kafka-p-broker-gra'
// Passes start every 5 minutes and take up to 4; one missed pass is not silence.
export const PRIMARY_SILENT_MS = 12 * 60_000
export const PRIMARY_SILENT = 'primary-watch-silent'

// The backup's view of the main watch from the heartbeat it last left:
// null while it is fresh, otherwise the problem to raise.
export function primarySilence(heartbeat, now) {
  if (Number.isFinite(heartbeat) && now - heartbeat < PRIMARY_SILENT_MS) return null
  const minutes = Number.isFinite(heartbeat) ? `${Math.round((now - heartbeat) / 60_000)} мин` : 'с момента установки запасного сторожа'
  return { id: PRIMARY_SILENT, severity: 'critical', title: 'Главный сторож Kafka молчит',
    detail: `Dev-бокс не проверял Kafka ${minutes}: он выключен, завис или без сети. Пока он молчит, Kafka проверяет запасной сторож на OVH Гравлин и пишет сюда сам.` }
}

// While the main watch is alive the backup tells nothing about Kafka: its
// incidents are dropped silently (the main watch owns them), except the
// silence itself, whose end is told.
export function standbyState(state) {
  const silent = state.incidents?.[PRIMARY_SILENT]
  return { ...state, incidents: silent?.reported ? { [PRIMARY_SILENT]: silent } : {} }
}

// Pure state transition: previous state + problems of this pass -> new state
// and the messages to send. `sent` is applied only after Telegram accepted.
export function step(state, problems, now) {
  const incidents = { ...(state.incidents ?? {}) }
  const current = new Map(problems.map((p) => [p.id, p]))
  const raise = []
  const remind = []
  const clear = []
  for (const p of problems) {
    const prev = incidents[p.id]
    const next = { ...prev, problem: p, seen: (prev?.seen ?? 0) + 1, missing: 0, since: prev?.since ?? now }
    if (!next.reported && next.seen >= CONFIRM_PASSES) raise.push(p.id)
    else if (next.reported && p.severity === 'critical' && prev.severity === 'warning') raise.push(p.id)
    else if (next.reported && now - next.reported >= REMIND_MS) remind.push(p.id)
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
  const fresh = raise.filter((id) => !incidents[id].reported)
  const worse = raise.filter((id) => incidents[id].reported)
  if (fresh.length || worse.length) {
    const ids = [...fresh, ...worse]
    const critical = ids.some((id) => incidents[id].problem.severity === 'critical')
    out.push({ ids, kind: 'raise', title: `${critical ? '❗' : '⚠️'} Kafka: ${ids.length === 1 ? incidents[ids[0]].problem.title : `${ids.length} проблемы`}`,
      text: `${lines(ids)}\n\nЗамечено в ${hhmm(Math.min(...ids.map((id) => incidents[id].since)))}. Перешли это сообщение в сессию Claude, чтобы разобраться.` })
  }
  if (remind.length) {
    out.push({ ids: remind, kind: 'remind', title: `⏰ Kafka: всё ещё не исправлено (${remind.length})`, text: lines(remind) })
  }
  if (clear.length) {
    out.push({ ids: clear, kind: 'clear', title: '✅ Kafka: снова в порядке',
      text: clear.map((id) => `• ${incidents[id].problem.title} — с ${hhmm(incidents[id].since)}`).join('\n') })
  }
  return out
}

export function applySent(incidents, message, now) {
  for (const id of message.ids) {
    if (message.kind === 'clear') delete incidents[id]
    else incidents[id] = { ...incidents[id], reported: now, severity: incidents[id].problem.severity }
  }
}

// Monday, from 09:00 Baku time, once a week: the watch is alive and what it sees.
export function weeklyDue(lastWeekly, now) {
  const baku = new Date(now + 4 * 3600_000)
  return baku.getUTCDay() === 1 && baku.getUTCHours() >= 9 && now - (lastWeekly ?? 0) > 6 * 24 * 3600_000
}

function sh(cmd, args, { timeout, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 32 << 20, killSignal: 'SIGKILL' }, (error, stdout, stderr) =>
      resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }))
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

async function main() {
  const stateDir = process.env.LD_KAFKA_WATCH_STATE ?? path.join(process.env.HOME, '.local/state/ld-kafka-watch')
  const opState = process.env.LD_KAFKA_STATE ?? path.join(process.env.HOME, '.leaddrive-kafka')
  const key = process.env.LD_KAFKA_WATCH_KEY ?? path.join(process.env.HOME, '.ssh/leaddrive_kafka_watch')
  const notify = process.env.LD_KAFKA_WATCH_NOTIFY ?? path.join(process.env.HOME, 'bin/notify-telegram')
  const dryRun = process.argv.includes('--dry-run')
  const backup = process.env.LD_KAFKA_WATCH_ROLE === 'backup'
  const heartbeatFile = process.env.LD_KAFKA_WATCH_HEARTBEAT ?? '/var/lib/ld-kafka-watch/primary-heartbeat'
  // Marks a live drill's messages, e.g. "[проверка] ", run with its own state dir.
  const prefix = process.env.LD_KAFKA_WATCH_PREFIX ?? ''
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })

  if (process.argv.includes('--notify-failure')) {
    // OnFailure of the watch unit: the owner must not read silence as health.
    const stamp = path.join(stateDir, 'failure-notified')
    if (existsSync(stamp) && Date.now() - Number(readFileSync(stamp, 'utf8')) < 6 * 3600_000) return
    const r = await sh(notify, [prefix + '⚠️ Сторож Kafka сам сломался',
      'Проверка Kafka не смогла выполниться, поэтому тревоги о Kafka сейчас не придут. Перешли это сообщение в сессию Claude.'], { timeout: 30_000 })
    if (r.code === 0) writeFileSync(stamp, String(Date.now()))
    return
  }

  // When this box itself is offline every probe fails; that is not an incident.
  const online = await sh('curl', ['-sS', '-o', '/dev/null', '-m', '10', 'https://api.telegram.org'], { timeout: 15_000 })
  if (online.code !== 0) { console.log('this box is offline; pass not counted'); return }

  const topology = loadTopology()
  const inventory = JSON.parse(readFileSync(path.join(opState, 'inventory.json'), 'utf8'))
  const primary = topology.clusters.find((c) => c.name === 'primary')
  const members = [...primary.hosts, { name: topology.sourceHost.name, roles: [SOURCE_ROLE] }].filter((h) => inventory.hosts[h.name]?.publicAddress)
  const ssh = (name, command, timeout) => sh('ssh', ['-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ControlMaster=no',
    '-o', 'ControlPath=none', '-o', `UserKnownHostsFile=${path.join(opState, 'known_hosts')}`, '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=10', `root@${inventory.hosts[name].publicAddress}`, ...(command ? [command] : [])], { timeout })
  const parse = (r) => { try { const d = JSON.parse(r.stdout); return d.error ? { ok: false, error: d.error } : { ok: true, data: d } } catch { return { ok: false, error: (r.stderr || `exit ${r.code}`).trim().slice(0, 200) } } }

  const stateFile = path.join(stateDir, 'state.json')
  let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}
  const silence = backup ? primarySilence(existsSync(heartbeatFile) ? Number(readFileSync(heartbeatFile, 'utf8')) : NaN, Date.now()) : null
  let problems = []
  let probes = {}
  let cluster = null
  if (backup && !silence) {
    state = standbyState(state)
    console.log('main watch is alive; standing by')
  } else {
    const results = await Promise.all(members.map(async (m) => [m.name, parse(await ssh(m.name, '', 40_000))]))
    probes = Object.fromEntries(results)
    for (const broker of members.filter((m) => m.roles.includes('broker') && probes[m.name].ok)) {
      const r = parse(await ssh(broker.name, 'cluster', 200_000))
      if (r.ok && r.data.cluster && !r.data.cluster.error) { cluster = { broker: broker.name, data: r.data.cluster }; break }
      console.log(`cluster view from ${broker.name} failed: ${r.error ?? r.data.cluster?.error}`)
    }
    problems = [...(silence ? [silence] : []), ...evaluate({ topology, inventory, probes, cluster })]
    console.log(`probed ${members.length} hosts, cluster via ${cluster?.broker ?? 'none'}; problems: ${problems.map((p) => p.id).join(', ') || 'none'}`)
  }

  const now = Date.now()
  const next = step(state, problems, now)
  const outgoing = messages(next)
  // The Monday note is the main watch's; it already reports a dead backup.
  if (!backup && weeklyDue(state.lastWeekly, now) && !Object.values(next.incidents).some((i) => i.reported)) {
    outgoing.push({ ids: [], kind: 'weekly', title: '🟢 Kafka: неделя, всё работает', text: `Сторож проверяет кластер каждые 5 минут. Сейчас: ${summary({ probes, topology, cluster }) || 'данные недоступны'}.` })
  }
  let lastWeekly = state.lastWeekly
  for (const message of outgoing) {
    if (dryRun) { console.log(`[dry-run] ${message.title}\n${message.text}`); continue }
    const r = await sh(notify, [prefix + message.title, message.text], { timeout: 30_000 })
    if (r.code !== 0) { console.log(`telegram send failed, will retry: ${message.title}`); continue }
    console.log(`sent: ${message.title}`)
    if (message.kind === 'weekly') lastWeekly = now
    else applySent(next.incidents, message, now)
  }
  if (dryRun) return
  const tmp = `${stateFile}.tmp`
  writeFileSync(tmp, JSON.stringify({ incidents: next.incidents, lastWeekly, lastPass: now }, null, 1), { mode: 0o600 })
  renameSync(tmp, stateFile)
  // The pass is over: tell the backup this watch is alive. A host that is not
  // set up for it refuses; the backup then calls this watch silent.
  if (!backup && inventory.hosts[BACKUP_WATCH_HOST]?.publicAddress) {
    const r = await ssh(BACKUP_WATCH_HOST, 'heartbeat', 30_000)
    if (r.code !== 0) console.log(`heartbeat to ${BACKUP_WATCH_HOST} failed: ${(r.stdout || r.stderr).trim().slice(0, 200)}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exit(1) })
}
