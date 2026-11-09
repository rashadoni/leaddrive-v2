/**
 * What an installed root crontab actually runs, as plain cron lines.
 *
 * Since 2026-11-09 cron itself starts one line a minute,
 * scripts/cron-dispatch.sh, and the LeadDrive jobs sit in the managed block as
 * `#@<second> <five fields> <command>`: a comment to cron, a job to the
 * dispatcher (why: the header of scripts/cron-dispatch.sh). A plain comment —
 * a disabled schedule — runs nothing.
 */
export function runnableCronLines(crontab: string): string[] {
  return crontab.split("\n").flatMap((line) => {
    const job = /^#@\d+ (.*)$/.exec(line)
    if (job) return [job[1]]
    const trimmed = line.trim()
    return trimmed === "" || trimmed.startsWith("#") ? [] : [line]
  })
}

/** The installer refuses to run without both scripts; tests stub them. */
export const CRON_SCRIPT_STUBS = ["cron-trigger.sh", "cron-dispatch.sh"] as const
