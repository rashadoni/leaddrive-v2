import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const profileList = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-profile-list.tsx"),
  "utf8",
)
const sourceWatchlist = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-source-watchlist.tsx"),
  "utf8",
)
const messages = Object.fromEntries(
  ["en", "ru", "az"].map(locale => [
    locale,
    JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8")),
  ]),
) as Record<string, {
  socialMonitoring: {
    profiles: { bulk: Record<string, unknown> }
    watchlist: { runJobStatuses: Record<string, string>; runJobProgress: string }
  }
}>

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe("social monitoring durable bulk queue UI", () => {
  it("enqueues the profile-wide run once and leaves single-profile execution untouched", () => {
    const bulk = section(
      profileList,
      "async function runAllProfiles()",
      "async function stopBulkRun()",
    )
    expect(bulk).toContain('fetch("/api/v1/social/monitoring-run-jobs"')
    expect(bulk).toContain('"Idempotency-Key": requestKey')
    expect(bulk).toContain("bulkIdempotencyKeyRef.current = requestKey")
    expect(bulk).toContain('kind: "PROFILE_FULL"')
    expect(bulk).toContain("fullArchiveConfirmed: true")
    expect(bulk).toContain("paidConfirmed: true")
    expect(bulk).toContain("sharedConfirmed: true")
    expect(bulk).not.toContain("executeProfileRun(")
    expect(profileList).toContain("await executeProfileRun(profile, platform, runMode)")
  })

  it("restores, polls, cancels, and resumes the latest profile job", () => {
    expect(profileList).toContain(
      '"/api/v1/social/monitoring-run-jobs?kind=PROFILE_FULL&latest=1"',
    )
    expect(profileList).toContain("MONITORING_RUN_JOB_POLL_MS")
    expect(profileList).toContain("/cancel`")
    expect(profileList).toContain("/resume`")
    expect(profileList).toContain("socialMonitoringRunJobProfileQueueState(bulkJob, profile)")
    expect(profileList).toContain("completed={job.processedItems}")
    expect(profileList).toContain("total={job.totalItems}")
    expect(profileList).toContain(
      "const runNavigationLocked = Boolean(runningProfileId) || bulkJobMutating",
    )
  })

  it("keeps quota-paid direct runs explicitly confirmed when no USD cap is sent", () => {
    const paidRun = section(
      sourceWatchlist,
      "const confirmPaidRun = async",
      "const startBulkRun = async",
    )
    expect(paidRun).toContain("paidRunUsesQuota")
    expect(paidRun).toMatch(
      /executeSourceNow\(\s*paidRunSource,\s*undefined,\s*paidRunCapability \|\| undefined,\s*true,/,
    )
    expect(sourceWatchlist).toContain("...(paidRunConfirmed ? { paidConfirmed: true } : {})")
  })

  it("enqueues both watchlist bulk modes without dispatching individual sources in the tab", () => {
    const bulk = section(
      sourceWatchlist,
      "const startBulkRun = async",
      "const targetHint =",
    )
    expect(bulk).toContain('fetch("/api/v1/social/monitoring-run-jobs"')
    expect(bulk).toContain('"Idempotency-Key": requestKey')
    expect(bulk).toContain("bulkIdempotencyKeysRef.current[requestSlot] = requestKey")
    expect(bulk).toContain('await startBulkRun("SOURCE_FULL")')
    expect(bulk).toContain('await startBulkRun("WEB_NEWS")')
    expect(sourceWatchlist).toMatch(
      /\{view === "external" \? \(\s+<Button\s+data-testid="social-run-web-news"/,
    )
    expect(bulk).toContain("sourceScope,")
    expect(bulk).toContain('kind === "SOURCE_FULL" ? { paidConfirmed: true }')
    expect(bulk).not.toContain("runSourceRequest(")
    expect(sourceWatchlist).toContain("WATCHLIST_RUN_JOB_KINDS.map")
    expect(sourceWatchlist).toContain("fetchLatestWatchlistRunJob(kind, sourceScope, headers)")
    expect(sourceWatchlist).toContain("?kind=${kind}&sourceScope=${sourceScope}&latest=1")
    expect(sourceWatchlist).toContain("displayedBulkJob.processedItems")
    expect(sourceWatchlist).toContain("bulkRunningSourceIds.has(source.id)")
    expect(sourceWatchlist).not.toContain("bulkStopRef")
  })

  it("localizes durable queue states in every supported locale", () => {
    for (const locale of ["en", "ru", "az"]) {
      const profileBulk = messages[locale].socialMonitoring.profiles.bulk
      expect(profileBulk.queuedTitle).toBeTruthy()
      expect(profileBulk.waitingProviderTitle).toBeTruthy()
      expect(profileBulk.resume).toBeTruthy()

      const watchlist = messages[locale].socialMonitoring.watchlist
      expect(watchlist.runJobProgress).toContain("{completed}")
      expect(Object.keys(watchlist.runJobStatuses)).toEqual([
        "queued",
        "running",
        "waitingProvider",
        "cancelRequested",
        "completed",
        "completedWithIssues",
        "canceled",
        "failed",
      ])
    }
  })
})
