// The delivery half of a watch: when a problem becomes a message, when a
// message repeats, when silence needs explaining, and when this box is simply
// offline and must not count a failed probe as an incident.
//
// Shared by the WAL archive watch and the host health watch. Not copied into
// both: a streak counter in two places is the same mistake the help-video name
// filter made — two copies of one rule, one of them quietly wrong.
import { execFile } from 'node:child_process'

export const REMIND_MS = 3600_000

export function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, killSignal: 'SIGKILL', encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve({ code: error ? (error.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' }),
    )
  })
}

/**
 * Has this box lost the network? When it has, every probe fails at once and
 * none of those failures says anything about production.
 */
export async function isBoxOffline(probe = run) {
  const resolver = await probe('getent', ['hosts', 'api.telegram.org'], 5_000)
  return resolver.code !== 0
}

/**
 * Turns the problems a pass found into the messages that actually go out.
 *
 * `needsTwoRuns(key)` marks a verdict this box reached by itself: it waits for
 * a second pass, so one bad network minute is quiet. A verdict production
 * already held for two of its own runs is forwarded on sight.
 *
 * An alarm repeats once an hour until it clears; a warning is said once and
 * then held until it becomes an alarm. `held` records what the problem was and
 * why it produced no message, because the journal is read when something is
 * already wrong: "waiting for a second pass" must not stand in for "already
 * told you", and a problem that came and went between passes must still have
 * left its wording behind.
 */
export function decide(problems, state, now, options = {}) {
  const needsTwoRuns = options.needsTwoRuns ?? (() => false)
  const remindMs = options.remindMs ?? REMIND_MS
  const incidents = { ...(state.incidents ?? {}) }
  const sends = []
  const held = []
  const seen = new Set()

  for (const problem of problems) {
    seen.add(problem.key)
    const previous = incidents[problem.key]
    const streak = (previous?.streak ?? 0) + 1
    const needsTwo = needsTwoRuns(problem.key)
    let reported = previous?.reported ?? false
    let lastSent = previous?.lastSent ?? 0
    const ripe = !needsTwo || streak >= 2
    const due = !reported || (problem.critical && now - lastSent >= remindMs)
    if (ripe && due) {
      sends.push({ critical: problem.critical, text: problem.text, repeat: reported })
      reported = true
      lastSent = now
    } else if (!ripe) {
      held.push({ key: problem.key, text: problem.text, reason: 'streak', detail: `прогон ${streak} из 2` })
    } else if (problem.critical) {
      const wait = Math.max(0, remindMs - (now - lastSent))
      held.push({
        key: problem.key,
        text: problem.text,
        reason: 'reminder',
        detail: `уже сообщено, напоминание через ${Math.round(wait / 60_000)} мин`,
      })
    } else {
      held.push({
        key: problem.key,
        text: problem.text,
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
