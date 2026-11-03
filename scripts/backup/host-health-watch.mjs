#!/usr/bin/env node
// Tell the owner when production's housekeeping stops: the page a person
// reaches stops answering, last night's backup did not run, or the disk is
// filling up.
//
// Why these three. docs/BACKUP_RUNBOOK.md lists what nothing watched: the main
// page from outside, the freshness of yesterday's dump, and free disk space.
// The WAL archive has its own watch, the line and the station have theirs.
// These three had none, and each is noticed on the day it is already too late.
//
// Everything is observed FROM OUTSIDE, and that is the point:
//   * the page is fetched the way a person reaches it — Cloudflare, nginx, the
//     app — so a green pass means somebody can actually get to the login form;
//   * the backups and the disk are read over ssh in one read-only call.
//
// Nothing is installed on production for this. The WAL check runs there because
// a five-minute timer already drives that script and two drivers would race
// for its lock; `systemctl show` and `df` are stateless reads, so a second
// script on production would be machinery for nothing.
//
// Because every verdict is reached HERE, every one of them waits for a second
// pass before it speaks: one bad network minute from this box pages nobody.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { REMIND_MS, decide, isBoxOffline, run } from './watch-delivery.mjs'

const PROD_HOST = process.env.LD_HOST_WATCH_HOST ?? 'root@13.140.132.245'
const PROD_KEY = process.env.LD_HOST_WATCH_KEY ?? path.join(process.env.HOME ?? '', '.ssh/leaddrive_prod_2026_09_09')
const BASE_URL = (process.env.LD_HOST_WATCH_URL ?? 'https://app.leaddrivecrm.org').replace(/\/$/, '')
const SSH_TIMEOUT_MS = 30_000
const PAGE_TIMEOUT_MS = Number(process.env.LD_HOST_WATCH_PAGE_TIMEOUT_MS ?? 20_000)
// The page is server-rendered and goes through Cloudflare. 0.3–1.0 s is the
// normal range measured on 2026-11-02; six seconds means the single Node thread
// is busy, which is the shape every slowness incident here has had.
const PAGE_SLOW_MS = Number(process.env.LD_HOST_WATCH_PAGE_SLOW_MS ?? 6_000)

// What is watched is what actually runs on this production host, and only that.
//
// The schedule that runs is pgBackRest's (ops/systemd/leaddrive-wal-backup.*,
// live since 2026-11-01), so it is watched through its own timer and service: a
// backup that writes somewhere else is still a backup, but a timer that is gone
// is not.
//
// The four units of the commissioning chain — leaddrive-postgres-backup,
// leaddrive-secrets-snapshot, leaddrive-runtime-files-snapshot and
// leaddrive-log-ship — are deliberately NOT here. Measured on production on
// 2026-11-02: the first two are `disabled`, the third is not installed, and
// log shipping is enabled but cannot work until the runbook's log evidence is
// finished. That is the documented state of an uncommissioned host (the
// recovery gate runs in plain mode), not an incident, and a watch that reds on
// a chosen gap reds for ever — after which nobody reads it. Put each one back
// the day its activation is finished; the runbook's own stop conditions
// require all four to be loaded, enabled and active before that gate counts
// as closed.
export const WATCHED_JOBS = [
  { unit: 'leaddrive-wal-backup', what: 'бэкап pgBackRest', warnHours: 30, critHours: 50 },
]

// The backup the owner actually relies on is made by a host script
// (/usr/local/sbin/leaddrive-backup.sh, since 2026-10-23) and lands here,
// age-encrypted. Its scheduler is not ours to name, so it is watched by what it
// produces: the age of the newest file of each shape.
export const BACKUP_DIR = process.env.LD_HOST_WATCH_BACKUP_DIR ?? '/var/backups/leaddrive'

// The offsite copy of client files (scripts/backup/uploads-offsite-mirror.sh)
// leaves its state here, flat key=value so this watch reads it with the same
// parser as everything else. While the file is absent nothing is said: the copy
// is not installed on every host, and the open gap is recorded in
// docs/BACKUP_RUNBOOK.md rather than shouted at the owner every five minutes.
export const UPLOADS_OFFSITE_STATE = process.env.LD_HOST_WATCH_OFFSITE_STATE ?? '/var/lib/leaddrive-uploads-offsite/state'
export const OFFSITE_WARN_HOURS = 30
export const OFFSITE_CRIT_HOURS = 50
export const WATCHED_BACKUP_FILES = [
  { key: 'dump', glob: '*.dump.age', what: 'ночной дамп базы', warnHours: 30, critHours: 50 },
  { key: 'secrets', glob: 'etc-leaddrive-*.tgz.age', what: 'снимок секретов хоста', warnHours: 30, critHours: 50 },
]

export const WATCHED_MOUNTS = ['/', '/var/lib/leaddrive-v2', '/var/backups/leaddrive', '/opt/leaddrive-v2']

// Absolute floors first, a percentage only as a second and tighter alarm.
// A percentage alone is wrong at both ends: ten per cent of twenty terabytes is
// two terabytes and nobody needs waking, while ten per cent of a small disk is
// gone in a night. What matters is how long there is to react, and the things
// that grow here — call recordings, encrypted files, out-logs — grow in
// gibibytes a day, so gibibytes is the honest unit. The percentage catches the
// case the floors cannot: a disk so small that even 6 GiB is nearly all of it.
export const DISK_WARN_GIB = 15
export const DISK_CRIT_GIB = 6
export const DISK_WARN_PERCENT = 10
export const DISK_CRIT_PERCENT = 5

/**
 * The one command that runs on production. Read-only by construction: it asks
 * systemd what it already knows and df how much room is left. The host does the
 * date arithmetic, because systemd prints timestamps in the host's own zone
 * (production runs Europe/Berlin) and `Date.parse` cannot be trusted with
 * "Mon 2026-11-02 02:15:31 CET".
 */
export function probeProgram(jobs = WATCHED_JOBS, mounts = WATCHED_MOUNTS, backupDir = BACKUP_DIR, files = WATCHED_BACKUP_FILES) {
  return [
    'set -u',
    "printf 'now=%s\\n' \"$(date -u +%s)\"",
    // The backup files, newest first. `newest` is the newest file of ANY name:
    // when a shape finds nothing, the message can name what IS there instead
    // of leaving the owner with "no dump" and no idea whether the watch is
    // simply looking for the wrong name.
    `if [ -f ${UPLOADS_OFFSITE_STATE} ]; then cat ${UPLOADS_OFFSITE_STATE}; fi`,
    `if [ -d ${backupDir} ]; then`,
    "  printf 'backupdir=present\\n'",
    `  printf 'newest=%s\\n' "$(find ${backupDir} -maxdepth 1 -type f -printf '%T@ %f\\n' 2>/dev/null | sort -nr | head -1 | tr ' ' '|')"`,
    ...files.flatMap((file) => [
      `  printf 'file=${file.key} found=%s\\n' "$(find ${backupDir} -maxdepth 1 -type f -name '${file.glob}' -printf '%T@ %f\\n' 2>/dev/null | sort -nr | head -1 | tr ' ' '|')"`,
    ]),
    'else',
    "  printf 'backupdir=missing\\n'",
    'fi',
    `for unit in ${jobs.map((job) => job.unit).join(' ')}; do`,
    '  stamp="$(systemctl show -p ExecMainExitTimestamp --value "$unit.service" 2>/dev/null || true)"',
    '  finished=""',
    '  if [ -n "$stamp" ]; then finished="$(date -d "$stamp" +%s 2>/dev/null || true)"; fi',
    "  printf 'unit=%s load=%s enabled=%s result=%s finished=%s\\n' \"$unit\" \\",
    '    "$(systemctl show -p LoadState --value "$unit.timer" 2>/dev/null || echo unknown)" \\',
    '    "$(systemctl show -p UnitFileState --value "$unit.timer" 2>/dev/null || echo unknown)" \\',
    '    "$(systemctl show -p Result --value "$unit.service" 2>/dev/null || echo unknown)" \\',
    '    "$finished"',
    'done',
    `for mount in ${mounts.join(' ')}; do`,
    '  df -P -- "$mount" 2>/dev/null | awk -v m="$mount" \'NR==2 {printf "disk=%s fs=%s total=%s avail=%s\\n", m, $1, $2, $4}\'',
    'done',
  ].join('\n')
}

// "<epoch>.<fraction>|<name>" as the probe prints it, or nothing at all.
function splitFound(value) {
  if (!value) return null
  const [stamp, name] = value.split('|')
  const at = Number(stamp) * 1000
  if (!Number.isFinite(at) || at <= 0) return null
  return { at, name: name ?? '' }
}

export function parseProbe(text) {
  const out = { now: NaN, jobs: new Map(), disks: [], files: new Map(), backupDir: '', newest: null, offsite: {} }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const fields = Object.fromEntries(
      line
        .trim()
        .split(' ')
        .map((pair) => {
          const at = pair.indexOf('=')
          return at < 0 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)]
        }),
    )
    if (fields.now !== undefined) out.now = Number(fields.now) * 1000
    else if (fields.unit !== undefined) out.jobs.set(fields.unit, fields)
    else if (fields.disk !== undefined) out.disks.push(fields)
    // The offsite state is a file of its own, so each of its keys arrives on
    // its own line — not one line with every field, like the others here.
    else if (Object.keys(fields).some((key) => key.startsWith('offsite'))) Object.assign(out.offsite, fields)
    else if (fields.backupdir !== undefined) out.backupDir = fields.backupdir
    else if (fields.newest !== undefined) out.newest = splitFound(fields.newest)
    else if (fields.file !== undefined) out.files.set(fields.file, splitFound(fields.found))
  }
  return out
}

function hours(ms) {
  return Math.round(ms / 3600_000)
}

/** Verdicts about the nightly chain. */
export function assessJobs(probe, jobs = WATCHED_JOBS) {
  const problems = []
  // Production's own clock, so a wrong clock on this box cannot invent an age.
  const now = Number.isFinite(probe.now) ? probe.now : Date.now()
  for (const job of jobs) {
    const key = `job:${job.unit}`
    const seen = probe.jobs.get(job.unit)
    if (!seen) {
      problems.push({ key, critical: true, text: `прод не ответил про ${job.what} (${job.unit})` })
      continue
    }
    if (seen.load !== 'loaded') {
      problems.push({ key, critical: true, text: `${job.what}: таймера ${job.unit}.timer на проде нет (${seen.load || 'пусто'})` })
      continue
    }
    if (seen.enabled !== 'enabled' && seen.enabled !== 'enabled-runtime') {
      problems.push({ key, critical: true, text: `${job.what}: таймер ${job.unit}.timer не включён (${seen.enabled || 'пусто'}) — расписания нет` })
      continue
    }
    const finished = Number(seen.finished) * 1000
    if (!seen.finished || !Number.isFinite(finished) || finished <= 0) {
      // A unit that never ran reports Result=success, so the timestamp is the
      // only thing that tells the difference between healthy and never tried.
      problems.push({ key, critical: true, text: `${job.what}: ${job.unit}.service ни разу не отработал` })
      continue
    }
    if (seen.result !== 'success') {
      problems.push({ key, critical: true, text: `${job.what}: последний запуск завершился как ${seen.result} (${hours(now - finished)} ч назад)` })
      continue
    }
    const age = now - finished
    if (age > job.critHours * 3600_000) {
      problems.push({ key, critical: true, text: `${job.what} не делался ${hours(age)} ч (порог ${job.critHours} ч)` })
    } else if (age > job.warnHours * 3600_000) {
      problems.push({ key, critical: false, text: `${job.what} не делался ${hours(age)} ч (порог ${job.warnHours} ч)` })
    }
  }
  return problems
}

/**
 * Verdicts about the backup files the host script leaves behind. A shape that
 * matches nothing is an alarm that names the newest file there is, so a watch
 * looking for the wrong name says something useful instead of something scary.
 */
export function assessBackupFiles(probe, files = WATCHED_BACKUP_FILES, dir = BACKUP_DIR) {
  if (!probe.backupDir) return []
  const now = Number.isFinite(probe.now) ? probe.now : Date.now()
  if (probe.backupDir !== 'present') {
    return [{ key: 'backupdir', critical: true, text: `каталога бэкапов ${dir} на проде нет` }]
  }
  const problems = []
  for (const file of files) {
    const key = `backup:${file.key}`
    const found = probe.files.get(file.key)
    if (!found) {
      const instead = probe.newest
        ? `самый свежий файл там — ${probe.newest.name} (${hours(now - probe.newest.at)} ч назад)`
        : `и каталог пуст`
      problems.push({ key, critical: true, text: `${file.what}: в ${dir} нет ни одного ${file.glob}; ${instead}` })
      continue
    }
    const age = now - found.at
    if (age > file.critHours * 3600_000) {
      problems.push({ key, critical: true, text: `${file.what} ${found.name} сделан ${hours(age)} ч назад (порог ${file.critHours} ч)` })
    } else if (age > file.warnHours * 3600_000) {
      problems.push({ key, critical: false, text: `${file.what} ${found.name} сделан ${hours(age)} ч назад (порог ${file.warnHours} ч)` })
    }
  }
  return problems
}

/**
 * Verdicts about the offsite copy of client files, and about the disk it reads.
 * Silent until the copy is installed; after that, a copy that stopped is an
 * alarm — the whole reason it exists is that the database comes back from
 * object storage and the files it points at did not — and a client's file
 * lying plain on that disk is a warning.
 */
export function assessUploadsOffsite(probe) {
  const state = probe.offsite ?? {}
  if (state.offsite !== 'present') return []
  const problems = []
  const copy = assessOffsiteCopy(state, probe)
  if (copy) problems.push(copy)
  // Not about the copy: everything is age-encrypted on the way out either way.
  // The mirror walks the whole tree, so it is the one thing here that looks at
  // the disk and can tell that a client's file is lying on it plain — which
  // tenant-file-readers-guard.test.ts cannot see, because it reads code. The
  // journal of the mirror's own run names the directories.
  const plain = Number(state.offsite_plain_unexpected)
  if (Number.isFinite(plain) && plain > 0) {
    problems.push({
      key: 'uploads-plain',
      critical: false,
      text: `на диске ${plain} незашифрованных файл(ов) клиентов (журнал leaddrive-uploads-offsite назовёт каталоги)`,
    })
  }
  return problems
}

/** One verdict about the copy itself, or null while it is healthy. */
function assessOffsiteCopy(state, probe) {
  const now = Number.isFinite(probe.now) ? probe.now : Date.now()
  const ranAt = Number(state.offsite_ran_at) * 1000
  const pending = Number(state.offsite_pending)
  const backlog = Number.isFinite(pending) && pending > 0 ? `, в очереди ${pending} файл(ов)` : ''
  if (!Number.isFinite(ranAt) || ranAt <= 0) {
    return { key: 'offsite', critical: true, text: 'копия файлов клиентов оставила состояние без времени прогона' }
  }
  const age = now - ranAt
  if (age > OFFSITE_CRIT_HOURS * 3600_000) {
    return { key: 'offsite', critical: true, text: `копия файлов клиентов не делалась ${hours(age)} ч (порог ${OFFSITE_CRIT_HOURS} ч)${backlog}` }
  }
  if (age > OFFSITE_WARN_HOURS * 3600_000) {
    return { key: 'offsite', critical: false, text: `копия файлов клиентов не делалась ${hours(age)} ч (порог ${OFFSITE_WARN_HOURS} ч)${backlog}` }
  }
  if (state.offsite_status === 'crit') {
    return { key: 'offsite', critical: true, text: `копия файлов клиентов не отправила ни одного файла (отказов ${state.offsite_failures ?? '?'})${backlog}` }
  }
  if (state.offsite_status === 'warn') {
    return { key: 'offsite', critical: false, text: `копия файлов клиентов прошла с отказами (${state.offsite_failures ?? '?'})${backlog}` }
  }
  return null
}

/** Verdicts about free space, one per filesystem however many paths share it. */
export function assessDisks(probe) {
  const problems = []
  const seen = new Set()
  for (const disk of probe.disks) {
    if (seen.has(disk.fs)) continue
    seen.add(disk.fs)
    const total = Number(disk.total)
    const avail = Number(disk.avail)
    if (!Number.isFinite(total) || !Number.isFinite(avail) || total <= 0) continue
    const gib = avail / 1024 / 1024
    const percent = (avail / total) * 100
    const where = `${disk.fs} (${disk.disk})`
    const much = `${gib.toFixed(1)} ГиБ из ${(total / 1024 / 1024).toFixed(0)} (${percent.toFixed(1)} %)`
    if (gib < DISK_CRIT_GIB || percent < DISK_CRIT_PERCENT) {
      problems.push({ key: `disk:${disk.fs}`, critical: true, text: `на диске ${where} осталось ${much}` })
    } else if (gib < DISK_WARN_GIB || percent < DISK_WARN_PERCENT) {
      problems.push({ key: `disk:${disk.fs}`, critical: false, text: `на диске ${where} осталось ${much}` })
    }
  }
  return problems
}

/** The verdict about the page, with ping as the discriminator. */
export function assessPage(page) {
  if (page.ok) {
    if (page.ms > PAGE_SLOW_MS) {
      return [{ key: 'page', critical: false, text: `страница входа открылась за ${(page.ms / 1000).toFixed(1)} с (порог ${PAGE_SLOW_MS / 1000} с)` }]
    }
    return []
  }
  const text = page.pingOk
    ? `страница входа не открывается снаружи (${page.reason}), а /api/v1/ping отвечает: приложение живо, страница — нет`
    : `прод не отвечает снаружи: ${page.reason}`
  return [{ key: 'page', critical: true, text }]
}

async function readProduction() {
  const override = process.env.LD_HOST_WATCH_PROBE_CMD
  const result = override
    ? await run('sh', ['-c', override], SSH_TIMEOUT_MS)
    : await run(
        'ssh',
        ['-i', PROD_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', PROD_HOST, probeProgram()],
        SSH_TIMEOUT_MS,
      )
  if (result.code !== 0) {
    return { error: (result.stderr || result.stdout).trim().split('\n').pop() ?? 'ssh не ответил' }
  }
  return { probe: parseProbe(result.stdout) }
}

async function get(url, timeoutMs) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'ld-host-watch' } })
    const body = await response.text()
    return { status: response.status, finalUrl: response.url, body, ms: Date.now() - started }
  } catch (error) {
    return { error: error?.name === 'AbortError' ? `нет ответа за ${timeoutMs / 1000} с` : String(error?.message ?? error), ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetches the page a person lands on. `/` answers 307 to `/login`, so the
 * redirect is followed and the destination is where the markup must appear:
 * that whole chain is what a person goes through, and asserting the markup is
 * what tells an app-rendered page from a Cloudflare error page with a 200.
 */
export async function checkPage(baseUrl = BASE_URL, timeoutMs = PAGE_TIMEOUT_MS) {
  const page = await get(`${baseUrl}/`, timeoutMs)
  if (page.error) return { ok: false, reason: page.error, ms: page.ms }
  if (page.status !== 200) return { ok: false, reason: `код ${page.status}`, ms: page.ms }
  if (!page.finalUrl.endsWith('/login')) return { ok: false, reason: `увело не на /login, а на ${page.finalUrl}`, ms: page.ms }
  if (!page.body.includes('/_next/static/')) return { ok: false, reason: 'ответ не похож на страницу приложения', ms: page.ms }
  return { ok: true, ms: page.ms }
}

async function main() {
  const stateDir = process.env.LD_HOST_WATCH_STATE ?? path.join(process.env.HOME ?? '', '.local/state/ld-host-watch')
  const notify = process.env.LD_HOST_WATCH_NOTIFY ?? path.join(process.env.HOME ?? '', 'bin/notify-telegram')
  const prefix = process.env.LD_HOST_WATCH_PREFIX ?? ''
  const dryRun = process.argv.includes('--dry-run')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })

  if (process.argv.includes('--notify-failure')) {
    // OnFailure of the watch unit: silence must not read as a healthy host.
    const stamp = path.join(stateDir, 'failure-notified')
    if (existsSync(stamp) && Date.now() - Number(readFileSync(stamp, 'utf8')) < 6 * 3600_000) return
    const { code } = await run(notify, [
      `${prefix}⚠️ Сторож прода сам сломался`,
      'Проверка страницы, бэкапов и диска не смогла выполниться, поэтому эти тревоги сейчас не придут. Перешли это сообщение в сессию Claude.',
    ], SSH_TIMEOUT_MS)
    if (code === 0) writeFileSync(stamp, String(Date.now()))
    return
  }

  const stateFile = path.join(stateDir, 'state.json')
  const local = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}

  const page = await checkPage()
  if (!page.ok) page.pingOk = (await get(`${BASE_URL}/api/v1/ping`, PAGE_TIMEOUT_MS)).status === 200
  const read = await readProduction()

  // When this box has no network every probe fails at once, and none of those
  // failures says anything about production.
  if (!page.ok && read.error && (await isBoxOffline())) {
    console.log('this box is offline; pass not counted')
    return
  }

  const problems = [
    ...assessPage(page),
    ...(read.error
      ? [{ key: 'unreachable', critical: true, text: `не удалось прочитать состояние прода по ssh: ${read.error}` }]
      : [...assessJobs(read.probe), ...assessBackupFiles(read.probe), ...assessUploadsOffsite(read.probe), ...assessDisks(read.probe)]),
  ]

  const now = Date.now()
  // Every verdict here is this box's own, so every one waits for a second pass.
  const { incidents, sends, held, recovered } = decide(problems, local, now, { needsTwoRuns: () => true, remindMs: REMIND_MS })

  for (const send of sends) {
    const head = `${prefix}${send.critical ? '🔴' : '⚠️'} Прод${send.repeat ? ' (всё ещё)' : ''}`
    console.log(`${head}: ${send.text}`)
    if (!dryRun) await run(notify, [head, send.text], SSH_TIMEOUT_MS)
  }
  if (recovered) {
    console.log('прод снова в порядке')
    if (!dryRun) await run(notify, [`${prefix}✅ Прод снова в порядке`, 'Страница, бэкапы и диск снова в норме.'], SSH_TIMEOUT_MS)
  }
  if (!sends.length && !recovered) {
    if (!problems.length) {
      const offsite = read.probe?.offsite?.offsite === 'present'
        ? `, копия файлов клиентов свежая${Number(read.probe.offsite.offsite_pending) > 0 ? ` (в очереди ${read.probe.offsite.offsite_pending})` : ''}`
        : ''
      console.log(`страница ${(page.ms / 1000).toFixed(2)} с, бэкапы и диск в порядке${offsite}`)
    } else {
      for (const h of held) console.log(`${h.key}: ${h.detail} — ${h.text}`)
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
