#!/usr/bin/env node
// Tell the owner when the WAL archive stops being restorable.
//
// This runs on the workstation, not on production, because the Telegram bot
// token lives here (beside the Kafka and line watches) and the owner chose not
// to copy it onto the production host.
//
// It does NOT run the check itself. leaddrive-wal-check.timer on production
// does that every five minutes, next to the data, and leaves its verdict,
// wording and two-run streak in a state file. This reads that file over ssh and
// decides only delivery — plus the one thing production cannot say about
// itself: that it went silent. Two drivers for one check would race for the
// script's lock, and a run that loses the lock exits 0, which this would have
// read as health.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PROD_HOST = process.env.LD_WAL_WATCH_HOST ?? 'root@13.140.132.245'
const PROD_KEY = process.env.LD_WAL_WATCH_KEY ?? path.join(process.env.HOME, '.ssh/leaddrive_prod_2026_09_09')
const STATE_PATH = process.env.LD_WAL_WATCH_REMOTE_STATE ?? '/var/lib/leaddrive-wal-archive/check-state.json'
// Production checks every 5 minutes, so four missed runs is a stopped timer,
// not a slow one.
const STALE_MS = Number(process.env.LD_WAL_WATCH_STALE_MS ?? 20 * 60_000)
const REMIND_MS = 3600_000
const SSH_TIMEOUT_MS = 30_000

// Keys this host decides by itself. Production already waited two runs before
// setting shouldAlert, so an archive problem is forwarded on sight; a problem
// seen from here waits two runs of its own, so one bad network minute is quiet.
const LOCAL_KEYS = new Set(['unreachable', 'state-unreadable', 'watch-silent'])

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, killSignal: 'SIGKILL', encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve({ code: error ? (error.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' }),
    )
  })
}

async function readRemoteState() {
  const override = process.env.LD_WAL_WATCH_STATE_CMD
  const result = override
    ? await run('sh', ['-c', override], SSH_TIMEOUT_MS)
    : await run(
        'ssh',
        ['-i', PROD_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', PROD_HOST, 'cat', STATE_PATH],
        SSH_TIMEOUT_MS,
      )
  if (result.code !== 0) {
    return { error: 'unreachable', detail: (result.stderr || result.stdout).trim().split('\n').pop() ?? '' }
  }
  try {
    const parsed = JSON.parse(result.stdout)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.status !== 'string') {
      return { error: 'state-unreadable', detail: 'состояние без status' }
    }
    return { state: parsed }
  } catch {
    return { error: 'state-unreadable', detail: 'состояние не разбирается как JSON' }
  }
}

export function assess(read, now) {
  if (read.error === 'unreachable') {
    return [{ key: 'unreachable', critical: true, text: `не удалось прочитать состояние WAL-архива с прода: ${read.detail || 'ssh не ответил'}` }]
  }
  if (read.error === 'state-unreadable') {
    return [{ key: 'state-unreadable', critical: true, text: `сторож WAL-архива на проде оставил нечитаемое состояние: ${read.detail}` }]
  }
  const { state } = read
  const checkedAt = Date.parse(state.checkedAt ?? '')
  if (!Number.isFinite(checkedAt)) {
    return [{ key: 'state-unreadable', critical: true, text: 'в состоянии WAL-архива нет времени проверки' }]
  }
  const age = now - checkedAt
  if (age > STALE_MS) {
    // Silence is the dangerous case: a stopped timer leaves the last verdict in
    // place, so a stale "ok" would read as health for ever.
    return [{
      key: 'watch-silent',
      critical: true,
      text: `сторож WAL-архива на проде молчит ${Math.round(age / 60_000)} мин (последняя проверка ${state.checkedAt})`,
    }]
  }
  if (state.shouldAlert === true && state.status !== 'ok') {
    return [{ key: 'archive', critical: state.status !== 'warn', text: state.message || `WAL-архив: состояние ${state.status}` }]
  }
  return []
}

export function stripSubject(text) {
  return text.replace(/^WAL-архив:\s*/u, '')
}

export function decide(problems, state, now) {
  const incidents = { ...(state.incidents ?? {}) }
  const sends = []
  // Why a problem produced no message. The journal is read when something is
  // already wrong, so "waiting for a second check" must not stand in for
  // "already told you, holding the hourly reminder".
  const held = []
  const seen = new Set()

  for (const problem of problems) {
    seen.add(problem.key)
    const previous = incidents[problem.key]
    const streak = (previous?.streak ?? 0) + 1
    const needsTwo = LOCAL_KEYS.has(problem.key)
    let reported = previous?.reported ?? false
    let lastSent = previous?.lastSent ?? 0
    const ripe = !needsTwo || streak >= 2
    const due = !reported || (problem.critical && now - lastSent >= REMIND_MS)
    if (ripe && due) {
      sends.push({ critical: problem.critical, text: problem.text, repeat: reported })
      reported = true
      lastSent = now
    } else if (!ripe) {
      held.push({ key: problem.key, reason: 'streak', detail: `прогон ${streak} из 2` })
    } else if (problem.critical) {
      // Only an alarm is repeated, and only once an hour.
      const wait = Math.max(0, REMIND_MS - (now - lastSent))
      held.push({
        key: problem.key,
        reason: 'reminder',
        detail: `уже сообщено, напоминание через ${Math.round(wait / 60_000)} мин`,
      })
    } else {
      held.push({
        key: problem.key,
        reason: 'said-once',
        detail: 'уже сообщено; предупреждение не повторяется, пока не станет аварией',
      })
    }
    incidents[problem.key] = { streak, reported, lastSent, critical: problem.critical }
  }

  const resolved = Object.entries(incidents).filter(([key, value]) => !seen.has(key) && value.reported)
  for (const [key] of resolved) delete incidents[key]
  for (const key of Object.keys(incidents)) if (!seen.has(key)) delete incidents[key]

  return { incidents, sends, held, recovered: resolved.length > 0 && problems.length === 0 }
}

async function main() {
  const stateDir = process.env.LD_WAL_WATCH_STATE ?? path.join(process.env.HOME, '.local/state/ld-wal-watch')
  const notify = process.env.LD_WAL_WATCH_NOTIFY ?? path.join(process.env.HOME, 'bin/notify-telegram')
  const prefix = process.env.LD_WAL_WATCH_PREFIX ?? ''
  const dryRun = process.argv.includes('--dry-run')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })

  if (process.argv.includes('--notify-failure')) {
    // OnFailure of the watch unit: silence must not read as a healthy archive.
    const stamp = path.join(stateDir, 'failure-notified')
    if (existsSync(stamp) && Date.now() - Number(readFileSync(stamp, 'utf8')) < 6 * 3600_000) return
    const { code } = await run(notify, [
      `${prefix}⚠️ Сторож WAL-архива сам сломался`,
      'Проверка WAL-архива не смогла выполниться, поэтому тревоги об архиве сейчас не придут. Перешли это сообщение в сессию Claude.',
    ], SSH_TIMEOUT_MS)
    if (code === 0) writeFileSync(stamp, String(Date.now()))
    return
  }

  const stateFile = path.join(stateDir, 'state.json')
  let local = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}
  const read = await readRemoteState()

  // When this box has no network every probe fails; that is not an incident.
  if (read.error === 'unreachable') {
    const online = await run('ssh', ['-V'], 5_000)
    const reachable = await run('getent', ['hosts', 'api.telegram.org'], 5_000)
    if (online.code !== 0 || reachable.code !== 0) {
      console.log('this box is offline; pass not counted')
      return
    }
  }

  const now = Date.now()
  const problems = assess(read, now)
  const { incidents, sends, held, recovered } = decide(problems, local, now)

  for (const send of sends) {
    const head = `${prefix}${send.critical ? '🔴' : '⚠️'} WAL-архив${send.repeat ? ' (всё ещё)' : ''}`
    // Production's wording already names the subject, and the heading names it
    // again: the owner reads the label once.
    const body = stripSubject(send.text)
    console.log(`${head}: ${body}`)
    if (!dryRun) await run(notify, [head, body], SSH_TIMEOUT_MS)
  }
  if (recovered) {
    console.log('WAL-архив снова в порядке')
    if (!dryRun) await run(notify, [`${prefix}✅ WAL-архив снова в порядке`, 'Проверка на проде снова проходит.'], SSH_TIMEOUT_MS)
  }
  if (!sends.length && !recovered) {
    if (!problems.length) {
      console.log('WAL-архив в порядке')
    } else {
      for (const h of held) console.log(`${h.key}: ${h.detail}`)
    }
  }

  if (!dryRun) writeFileSync(stateFile, JSON.stringify({ ...local, incidents }), { mode: 0o600 })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
