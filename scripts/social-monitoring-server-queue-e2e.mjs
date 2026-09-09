import crypto from "node:crypto"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import bcrypt from "bcryptjs"
import { chromium, request } from "playwright"
import { makeScriptPrisma } from "./_rls.mjs"
import { passwordPolicyError } from "./password-policy.mjs"

const baseURL = (process.env.SOCIAL_QUEUE_E2E_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "")
const cronSecret = process.env.CRON_SECRET || ""
// The first dashboard navigation performs a cold Next.js dev compilation on
// an ephemeral runner. Keep the assertion bounded, but do not confuse the
// default 30-second Playwright navigation limit with an application failure.
const navigationTimeoutMs = 120_000

if (!cronSecret) throw new Error("CRON_SECRET is required")

const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
function hostname(rawUrl, allowedProtocols, allowCredentials = false) {
  try {
    const parsed = new URL(rawUrl)
    if ((!allowCredentials && (parsed.username || parsed.password)) || !allowedProtocols.includes(parsed.protocol)) return ""
    return parsed.hostname
  } catch {
    return ""
  }
}
if (
  process.env.NODE_ENV === "production"
  || !localHostnames.has(hostname(baseURL, ["http:", "https:"]))
  || !localHostnames.has(hostname(process.env.DATABASE_URL || "", ["postgres:", "postgresql:"], true))
) {
  throw new Error("social-monitoring-server-queue-e2e only runs in non-production against a localhost API and database")
}

const routePlanSource = await readFile(
  new URL("../src/lib/social/source-route-plan.ts", import.meta.url),
  "utf8",
)
const routePolicyMatch = routePlanSource.match(
  /export const SOURCE_ROUTE_POLICY_VERSION = "([^"]+)"/u,
)
assert.equal(
  typeof routePolicyMatch?.[1],
  "string",
  "Could not resolve SOURCE_ROUTE_POLICY_VERSION for the E2E fixture",
)
const sourceRoutePolicyVersion = routePolicyMatch[1]

const prisma = await makeScriptPrisma()
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12)
const organizationSlug = `social-queue-e2e-${suffix}`
const email = `manager-${suffix}@example.test`
const password = `E2e-${suffix}-Pass!9`
const passwordError = passwordPolicyError(password)
if (passwordError) throw new Error(`Generated E2E password rejected: ${passwordError}`)

async function withRlsBypass(callback) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`
    return callback(tx)
  })
}

async function login(browser) {
  const context = await browser.newContext({ baseURL, locale: "en-US" })
  const csrfResponse = await context.request.get("/api/auth/csrf")
  assert.equal(csrfResponse.ok(), true, `CSRF request failed: ${csrfResponse.status()}`)
  const { csrfToken } = await csrfResponse.json()

  const loginResponse = await context.request.post("/api/auth/callback/credentials", {
    headers: { "X-Auth-Return-Redirect": "1" },
    form: {
      csrfToken,
      email,
      password,
      organizationSlug,
      callbackUrl: `${baseURL}/social-monitoring?queue-e2e=authenticated`,
    },
  })
  assert.equal(loginResponse.ok(), true, `Credentials callback failed: ${loginResponse.status()}`)
  const loginPayload = await loginResponse.json().catch(() => null)
  assert.equal(typeof loginPayload?.url, "string", "Credentials callback returned no redirect URL")
  const loginRedirect = new URL(loginPayload.url, baseURL)
  assert.equal(loginRedirect.searchParams.get("error"), null, "Credentials callback rejected the login")
  const authCookies = await context.cookies(baseURL)
  assert.equal(
    authCookies.some(cookie => cookie.name.endsWith("authjs.session-token")),
    true,
    "Authenticated session cookie was not established",
  )

  const sessionResponse = await context.request.get("/api/auth/session")
  assert.equal(sessionResponse.ok(), true, `Session request failed: ${sessionResponse.status()}`)
  const session = await sessionResponse.json()
  assert.equal(session?.user?.email, email, "Authenticated session was not established")
  return context
}

let organizationId
let secondOrganizationId
let jobId
let firstBrowser
let secondBrowser

try {
  const passwordHash = await bcrypt.hash(password, 4)
  const organization = await prisma.organization.create({
    data: {
      name: "Social queue E2E",
      slug: organizationSlug,
      plan: "enterprise",
      modules: { social: true },
      features: ["social"],
      settings: {},
    },
  })
  organizationId = organization.id

  const user = await prisma.user.create({
    data: {
      organizationId,
      email,
      name: "Queue E2E Manager",
      passwordHash,
      role: "manager",
      require2fa: false,
      totpEnabled: false,
      smsAuthEnabled: false,
      isActive: true,
    },
  })
  const subject = await prisma.monitoringSubject.create({
    data: {
      organizationId,
      type: "BRAND",
      name: "Queue E2E Subject",
      status: "active",
      createdBy: user.id,
    },
  })
  const source = await prisma.monitoringSource.create({
    data: {
      organizationId,
      platform: "web",
      sourceType: "manual",
      query: `queue-e2e-${suffix}`,
      ownership: "external",
      collectionMode: "manual",
      status: "active",
      keywords: ["queue-e2e"],
      settings: {},
      createdBy: user.id,
    },
  })
  await prisma.monitoringSubjectSource.create({
    data: {
      organizationId,
      subjectId: subject.id,
      sourceId: source.id,
      relationType: "MONITORS",
    },
  })
  await prisma.sourceRoutePlan.create({
    data: {
      organizationId,
      routeKey: `social-queue-e2e:${source.id}`,
      sourceId: source.id,
      platform: "web",
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "MANUAL_TASK",
      fallbackAdapters: [],
      acquisitionMode: "MANUAL_URL",
      replyMode: "NO_ACTION",
      budget: { usdLimitsConfigured: false, timeoutSeconds: 30, maxItems: 1 },
      rateLimit: {},
      failoverConditions: [],
      policyVersion: sourceRoutePolicyVersion,
      reason: "Deterministic, network-free server queue E2E route",
      status: "ACTIVE",
    },
  })
  const secondOrganization = await prisma.organization.create({
    data: {
      name: "Social queue E2E isolation control",
      slug: `${organizationSlug}-other`,
      plan: "enterprise",
      modules: { social: true },
      features: ["social"],
    },
  })
  secondOrganizationId = secondOrganization.id

  firstBrowser = await chromium.launch({ headless: true })
  const firstContext = await login(firstBrowser)
  const page = await firstContext.newPage()
  await page.goto("/social-monitoring?queue-e2e=1", {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  })
  assert.notEqual(new URL(page.url()).pathname, "/login", "Social Monitoring page redirected to login")

  const idempotencyKey = `social-queue-e2e:${suffix}`
  const createPayload = { kind: "SOURCE_FULL", sourceScope: "EXTERNAL" }
  const createResult = await page.evaluate(async ({ idempotencyKey: key, payload }) => {
    const response = await fetch("/api/v1/social/monitoring-run-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json() }
  }, { idempotencyKey, payload: createPayload })
  assert.equal(createResult.status, 202, `Queue create failed: ${createResult.status}`)
  const created = createResult.body
  jobId = created?.data?.id
  assert.equal(typeof jobId, "string", "Queue create response has no job id")
  assert.equal(created.data.status, "QUEUED")
  assert.equal(created.data.totalItems, 1)

  const repeatedResult = await page.evaluate(async ({ idempotencyKey: key, payload }) => {
    const response = await fetch("/api/v1/social/monitoring-run-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json() }
  }, { idempotencyKey, payload: createPayload })
  assert.equal(repeatedResult.status, 202, `Idempotent replay failed: ${repeatedResult.status}`)
  const repeated = repeatedResult.body
  assert.equal(repeated?.data?.id, jobId, "Idempotent replay created a different job")

  const competingResult = await page.evaluate(async ({ idempotencyKey: key, payload }) => {
    const response = await fetch("/api/v1/social/monitoring-run-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${key}:competing` },
      body: JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json() }
  }, { idempotencyKey, payload: createPayload })
  assert.equal(competingResult.status, 409, "A second active queue was not rejected")
  assert.equal(competingResult.body?.error, "social_monitoring_run_job_already_active")

  const duplicateCount = await withRlsBypass(tx => tx.socialMonitoringRunJob.count({
    where: { organizationId, idempotencyKey },
  }))
  assert.equal(duplicateCount, 1, "Idempotency key produced duplicate durable jobs")

  // Simulate a server process dying after claiming the durable job. The page
  // and its authenticated request context are then destroyed before a fresh,
  // unauthenticated scheduler invocation takes over the expired lease.
  await withRlsBypass(tx => tx.socialMonitoringRunJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      leaseToken: `crashed-worker-${suffix}`,
      leaseExpiresAt: new Date(Date.now() - 60_000),
      startedAt: new Date(Date.now() - 120_000),
    },
  }))

  await firstContext.close()
  await firstBrowser.close()
  firstBrowser = undefined

  const scheduler = await request.newContext({
    baseURL,
    extraHTTPHeaders: { "x-cron-secret": cronSecret },
  })
  const cronResponse = await scheduler.post(
    `/api/cron/social-monitoring-run-jobs?organizationId=${encodeURIComponent(organizationId)}&limit=1&maxItemsPerJob=1`,
  )
  assert.equal(cronResponse.status(), 200, `Cron drain failed: ${cronResponse.status()}`)
  const cronPayload = await cronResponse.json()
  assert.equal(cronPayload?.success, true)
  assert.equal(cronPayload?.data?.claimed, 1, "Cron did not reclaim the expired server lease")
  await scheduler.dispose()

  secondBrowser = await chromium.launch({ headless: true })
  const secondContext = await login(secondBrowser)
  const jobResponse = await secondContext.request.get(
    `/api/v1/social/monitoring-run-jobs/${encodeURIComponent(jobId)}`,
  )
  assert.equal(jobResponse.status(), 200, `Queue read after reopen failed: ${jobResponse.status()}`)
  const finished = await jobResponse.json()
  assert.equal(finished?.data?.status, "COMPLETED_WITH_ISSUES")
  assert.equal(finished?.data?.processedItems, 1)
  assert.equal(finished?.data?.items?.length, 1)
  assert.equal(finished?.data?.items?.[0]?.status, "PARTIAL")
  assert.equal(finished?.data?.items?.[0]?.error, "manual_collection_required")
  assert.equal(typeof finished?.data?.startedAt, "string")
  assert.equal(typeof finished?.data?.finishedAt, "string")

  const reopenedPage = await secondContext.newPage()
  await reopenedPage.goto("/social-monitoring?view=sources&queue-e2e=reopened", {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  })
  const progress = reopenedPage.getByTestId("social-watchlist-run-progress")
  await progress.waitFor({ state: "visible", timeout: 60_000 })
  assert.match((await progress.textContent()) || "", /1\s*\/\s*1/u)

  const durableEvidence = await withRlsBypass(async tx => ({
    jobs: await tx.socialMonitoringRunJob.count({ where: { organizationId } }),
    items: await tx.socialMonitoringRunJobItem.count({ where: { organizationId, jobId } }),
    collectorRuns: await tx.collectorRun.count({ where: { organizationId, sourceId: source.id } }),
    collectorStatuses: await tx.collectorRun.findMany({
      where: { organizationId, sourceId: source.id },
      select: { status: true },
    }),
    providerRuns: await tx.socialProviderRun.count({ where: { organizationId, sourceId: source.id } }),
    jobLeaseToken: (await tx.socialMonitoringRunJob.findUnique({ where: { id: jobId } }))?.leaseToken,
    jobLeaseExpiresAt: (await tx.socialMonitoringRunJob.findUnique({ where: { id: jobId } }))?.leaseExpiresAt,
    item: await tx.socialMonitoringRunJobItem.findFirst({
      where: { organizationId, jobId },
      select: { collectorRunId: true, leaseToken: true, leaseExpiresAt: true },
    }),
  }))
  assert.equal(durableEvidence.jobs, 1)
  assert.equal(durableEvidence.items, 1)
  assert.equal(durableEvidence.collectorRuns, 1)
  assert.deepEqual(durableEvidence.collectorStatuses, [{ status: "partial" }])
  assert.equal(durableEvidence.providerRuns, 0)
  assert.equal(durableEvidence.jobLeaseToken, null)
  assert.equal(durableEvidence.jobLeaseExpiresAt, null)
  assert.equal(typeof durableEvidence.item?.collectorRunId, "string")
  assert.equal(durableEvidence.item?.leaseToken, null)
  assert.equal(durableEvidence.item?.leaseExpiresAt, null)

  const isolatedCount = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'off', true)`
    await tx.$executeRaw`SELECT set_config('app.org_id', ${secondOrganizationId}, true)`
    return tx.socialMonitoringRunJob.count()
  })
  assert.equal(isolatedCount, 0, "Another tenant can see the durable queue job")

  const postTerminalReplay = await reopenedPage.evaluate(async ({ idempotencyKey: key, payload }) => {
    const response = await fetch("/api/v1/social/monitoring-run-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json() }
  }, { idempotencyKey, payload: createPayload })
  assert.equal(postTerminalReplay.status, 202)
  assert.equal(postTerminalReplay.body?.data?.id, jobId)
  const collectorRunsAfterReplay = await withRlsBypass(tx => tx.collectorRun.count({
    where: { organizationId, sourceId: source.id },
  }))
  assert.equal(collectorRunsAfterReplay, 1, "Terminal idempotent replay dispatched a second collector")

  await secondContext.close()
  console.log("PASS: durable Social Monitoring queue survived browser close and reclaimed an expired server lease")
} finally {
  if (firstBrowser) await firstBrowser.close().catch(() => {})
  if (secondBrowser) await secondBrowser.close().catch(() => {})
  if (organizationId) {
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {})
  }
  if (secondOrganizationId) {
    await prisma.organization.delete({ where: { id: secondOrganizationId } }).catch(() => {})
  }
  await prisma.$disconnect()
}
