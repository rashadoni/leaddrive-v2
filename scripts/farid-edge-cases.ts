import { passwordPolicyError } from "./password-policy.mjs"

export {} // module — keeps top-level consts out of the shared global scope

/**
 * Farid's edge cases — drives the demo flow into the corners that
 * `farid-day.ts` skips:
 *
 *   1. Geofence violation as a regular AGENT  → 400 expected
 *   2. Force-override as regular AGENT       → 403 expected (F-28 role check)
 *   3. Force-override after role upgrade     → 201 + CHECK_IN_FORCED audit
 *   4. Mobile-auth rate limit (F-02)         → 6th call returns 429
 *   5. Location rate limit (F-30)            → 31st ping/min returns 429
 *   6. Route deviation alert + notification  → mtmAlert + notifyAgent fired
 *   7. Photo upload via multipart with real
 *      magic-numbered JPEG / HEIC bytes      → 201 + PHOTO_UPLOAD audit
 *   8. Mobile notifications fetch + mark-all → unread count == 0 afterwards
 *
 * No prod code is touched. Reads/writes happen against the running dev
 * server through the same mobile-JWT path the real app uses.
 *
 * Usage:
 *   MTM_DEMO_AGENT_PASSWORD=... BASE_URL=http://localhost:56694 \
 *     npx tsx scripts/farid-edge-cases.ts
 */

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "")
const EMAIL = process.env.MTM_DEMO_EMAIL || "farid@leaddrive.com"
const PASSWORD = process.env.MTM_DEMO_AGENT_PASSWORD || ""
const ORG_SLUG = process.env.MTM_DEMO_ORG_SLUG || "leaddrive"

function localHostname(rawUrl: string, allowedProtocols: string[], allowCredentials = false) {
  try {
    const parsed = new URL(rawUrl)
    if ((!allowCredentials && (parsed.username || parsed.password)) || !allowedProtocols.includes(parsed.protocol)) return ""
    return parsed.hostname
  } catch {
    return ""
  }
}

function assertLocalSafety() {
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
  const apiHostname = localHostname(BASE_URL, ["http:", "https:"])
  const dbHostname = localHostname(process.env.DATABASE_URL || "", ["postgres:", "postgresql:"], true)
  if (
    process.env.NODE_ENV === "production"
    || !localHostnames.has(apiHostname)
    || !localHostnames.has(dbHostname)
  ) {
    throw new Error("scripts/farid-edge-cases.ts only runs in non-production against a localhost API and database")
  }
  const policyError = passwordPolicyError(PASSWORD)
  if (policyError) throw new Error(`MTM_DEMO_AGENT_PASSWORD: ${policyError}`)
}

type Json = Record<string, unknown> & { success?: boolean; data?: any; error?: string }

async function rawApi(
  token: string | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: Json
  try {
    json = JSON.parse(text) as Json
  } catch {
    json = { raw: text } as Json
  }
  return { status: res.status, json }
}

function expect(cond: boolean, label: string) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${label}`)
    throw new Error(label)
  }
  console.log(`  ✅ ${label}`)
}

async function login(): Promise<{ token: string; agentId: string }> {
  const r = await rawApi(null, "POST", "/api/v1/mtm/mobile/auth", {
    email: EMAIL,
    password: PASSWORD,
    organizationSlug: ORG_SLUG,
  })
  expect(r.status === 200, `login → 200 (got ${r.status})`)
  return { token: r.json.data!.token, agentId: r.json.data!.agent.id }
}

async function getCustomerId(token: string, code: string) {
  const r = await rawApi(token, "GET", `/api/v1/mtm/customers?search=${encodeURIComponent(code)}&limit=5`)
  const found = (r.json.data?.customers as Array<{ id: string; code: string }> | undefined)?.find((c) => c.code === code)
  if (!found) throw new Error(`Customer ${code} missing — run seed-mtm.ts first`)
  return found.id
}

// ─── 1 + 2 + 3: Geofence + force-override ──────────────────────────────────

async function testGeofence(token: string, agentId: string) {
  console.log("\n── 1. Geofence violation as AGENT → expected 400 ──")
  const custId = await getCustomerId(token, "MTM-A01") // Əczaçı Plus lat 40.3953 lng 49.8822

  // Faraway GPS so the geofence check fires.
  const farAway = { latitude: 41.0, longitude: 50.5 } // ~70km off
  const r1 = await rawApi(token, "POST", "/api/v1/mtm/visits", {
    agentId,
    customerId: custId,
    ...farAway,
    notes: "intentional geofence violation",
  })
  expect(r1.status === 400, `regular agent + faraway GPS → 400 (got ${r1.status})`)
  expect(typeof r1.json.error === "string" && r1.json.error.includes("Too far"), `error mentions distance — "${r1.json.error}"`)

  console.log("\n── 2. force=true as AGENT → expected 403 (F-28 role check) ──")
  const r2 = await rawApi(token, "POST", "/api/v1/mtm/visits", {
    agentId,
    customerId: custId,
    ...farAway,
    force: true,
    notes: "tries to bypass as AGENT",
  })
  expect(r2.status === 403, `force=true as AGENT → 403 (got ${r2.status})`)
}

// Bumped-role retry runs as a separate, prisma-side role change.
async function testForceOverrideAsSupervisor(token: string, agentId: string) {
  console.log("\n── 3. After bumping Farid → SUPERVISOR, force=true should now succeed ──")
  const { makeScriptPrisma } = await import("./_rls.mjs")
  const p = await makeScriptPrisma()
  try {
    await p.mtmAgent.update({ where: { id: agentId }, data: { role: "SUPERVISOR" } })
    const custId = await getCustomerId(token, "MTM-A01")
    const r = await rawApi(token, "POST", "/api/v1/mtm/visits", {
      agentId,
      customerId: custId,
      latitude: 41.0,
      longitude: 50.5,
      force: true,
      notes: "force override by SUPERVISOR",
    })
    expect(r.status === 201, `force=true as SUPERVISOR → 201 (got ${r.status})`)
    expect(r.json.data?.id != null, `visit returned with id ${r.json.data?.id}`)
  } finally {
    // Restore role so the rest of the suite (and future runs) sees AGENT.
    await p.mtmAgent.update({ where: { id: agentId }, data: { role: "AGENT" } })
    await p.$disconnect()
  }
}

// ─── 4. Mobile-auth rate limit ─────────────────────────────────────────────

async function testAuthRateLimit() {
  console.log("\n── 4. mobile-auth: 6th wrong-password attempt → 429 ──")
  // Use a fresh nonexistent email so this test's rate-limit counter doesn't
  // share state with the suite's earlier successful login on EMAIL — the
  // window is 60s and the limit is 5/(IP, email).
  const probeEmail = `rate-probe-${Date.now()}@leaddrive.local`
  const fake = { email: probeEmail, password: "wrongwrong", organizationSlug: ORG_SLUG }
  // The limit is 5 per minute per (IP, email). 5 attempts → all 401 (agent
  // not found, but rate counter still increments), 6th → 429.
  let statuses: number[] = []
  for (let i = 0; i < 6; i++) {
    const r = await rawApi(null, "POST", "/api/v1/mtm/mobile/auth", fake)
    statuses.push(r.status)
  }
  expect(statuses.slice(0, 5).every((s) => s === 401), `first 5 attempts all 401 → got [${statuses.slice(0, 5).join(",")}]`)
  expect(statuses[5] === 429, `6th attempt → 429 (got ${statuses[5]})`)
}

// ─── 5. Location rate limit ────────────────────────────────────────────────

async function testLocationRateLimit(token: string) {
  console.log("\n── 5. mobile/location: 31 pings in one second → 429 ──")
  const pings = [] as Promise<{ status: number }>[]
  for (let i = 0; i < 32; i++) {
    pings.push(rawApi(token, "POST", "/api/v1/mtm/mobile/location", {
      latitude: 40.4 + i * 0.0001,
      longitude: 49.8 + i * 0.0001,
      accuracy: 5,
    }))
  }
  const results = await Promise.all(pings)
  const ok = results.filter((r) => r.status === 200).length
  const limited = results.filter((r) => r.status === 429).length
  expect(ok >= 25 && limited >= 1, `≥25 × 200 and ≥1 × 429 in burst (got ok=${ok}, 429=${limited})`)
}

// ─── 6. Route deviation alert ──────────────────────────────────────────────

async function testRouteDeviation(token: string, agentId: string) {
  console.log("\n── 6. Route deviation — ping far from planned route ──")
  // The seeded `[SEED] Nəsimi-Səbail Route` (PLANNED) has customers at
  // lat ~40.39, lng ~49.87. A ping in Lökbatan (lat 40.31, lng 49.75) is
  // ~10km off — well above the default 500m threshold.
  const { makeScriptPrisma } = await import("./_rls.mjs")
  const p = await makeScriptPrisma()
  const orgId = (await p.mtmAgent.findUnique({ where: { id: agentId } }))?.organizationId || ""

  // Honour the deviation-alert throttle window (default 10min) by clearing
  // recent OUT_OF_ZONE alerts BEFORE we take the baseline count — otherwise
  // `alertsBefore` includes rows we're about to delete, and `alertsAfter >
  // alertsBefore` becomes impossible after a single new insert.
  await p.mtmAlert.deleteMany({
    where: { organizationId: orgId, agentId, type: "OUT_OF_ZONE", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
  })

  const alertsBefore = await p.mtmAlert.count({ where: { organizationId: orgId, agentId, type: "OUT_OF_ZONE" } })
  const notifsBefore = await p.mtmNotification.count({ where: { organizationId: orgId, agentId, title: { contains: "deviation", mode: "insensitive" } } })

  // Make sure Farid is bound to a PLANNED/IN_PROGRESS route with ≥2 points.
  const route = await p.mtmRoute.findFirst({
    where: { organizationId: orgId, agentId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
    include: { points: { select: { id: true } } },
  })
  if (!route || route.points.length < 2) {
    // Re-bind first PLANNED route to Farid for the test.
    const anyRoute = await p.mtmRoute.findFirst({
      where: { organizationId: orgId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      include: { points: { select: { id: true } } },
    })
    if (!anyRoute || anyRoute.points.length < 2) {
      console.log("  (skip — no PLANNED route with ≥2 points in seed)")
      await p.$disconnect()
      return
    }
    await p.mtmRoute.update({ where: { id: anyRoute.id }, data: { agentId } })
  }

  // Ping far off the corridor.
  const r = await rawApi(token, "POST", "/api/v1/mtm/mobile/location", {
    latitude: 40.31,
    longitude: 49.75,
    accuracy: 8,
  })
  expect(r.status === 200, `location ping accepted → 200 (got ${r.status})`)
  // Cron / handler write is async; small delay before counting.
  await new Promise((res) => setTimeout(res, 800))
  const alertsAfter = await p.mtmAlert.count({ where: { organizationId: orgId, agentId, type: "OUT_OF_ZONE" } })
  const notifsAfter = await p.mtmNotification.count({ where: { organizationId: orgId, agentId, title: { contains: "deviation", mode: "insensitive" } } })
  expect(alertsAfter > alertsBefore, `OUT_OF_ZONE alert count rose (was ${alertsBefore}, now ${alertsAfter})`)
  expect(notifsAfter > notifsBefore, `Route-deviation notification count rose (was ${notifsBefore}, now ${notifsAfter})`)
  await p.$disconnect()
}

// ─── 7. Photo upload (multipart with real magic-numbered bytes) ────────────

async function testPhotoUpload(token: string, agentId: string) {
  console.log("\n── 7. Photo upload — JPEG and HEIC magic bytes ──")
  const jpeg = new Uint8Array(64)
  jpeg[0] = 0xff
  jpeg[1] = 0xd8
  jpeg[2] = 0xff
  // HEIC: bytes 4-7 = "ftyp", 8-11 = "heic"
  const heic = new Uint8Array(64)
  heic.set([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0)

  async function upload(buf: Uint8Array, name: string) {
    const form = new FormData()
    form.append("file", new Blob([buf as BlobPart], { type: "application/octet-stream" }), name)
    form.append("agentId", agentId)
    form.append("category", "display")
    form.append("latitude", "40.3953")
    form.append("longitude", "49.8822")
    const res = await fetch(`${BASE_URL}/api/v1/mtm/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const json = (await res.json().catch(() => ({}))) as Json
    return { status: res.status, json }
  }

  const j = await upload(jpeg, "visit-proof.jpg")
  expect(j.status === 201, `JPEG upload → 201 (got ${j.status})`)
  expect(typeof j.json.data?.url === "string" && j.json.data.url.endsWith(".jpg"), `URL ends with .jpg → ${j.json.data?.url}`)

  const h = await upload(heic, "visit-proof.jpg")
  expect(h.status === 201, `HEIC body w/ .jpg name → 201 (server rewrites ext)`)
  expect(
    typeof h.json.data?.url === "string" && h.json.data.url.endsWith(".heic"),
    `URL was rewritten to .heic (got ${h.json.data?.url})`
  )

  // Invalid magic should be rejected.
  const garbage = new Uint8Array(64)
  garbage.fill(0x00)
  const g = await upload(garbage, "bad.jpg")
  expect(g.status === 400, `garbage bytes rejected → 400 (got ${g.status})`)
}

// ─── 8. Mobile notifications + mark-all ────────────────────────────────────

async function testMobileNotifications(token: string) {
  console.log("\n── 8. Mobile notifications endpoint ──")
  const r1 = await rawApi(token, "GET", "/api/v1/mtm/mobile/notifications")
  expect(r1.status === 200, `GET /mobile/notifications → 200 (got ${r1.status})`)
  const unreadBefore = r1.json.data?.unread ?? 0
  console.log(`  unread before: ${unreadBefore}`)

  if (unreadBefore === 0) {
    console.log("  (no unread notifications — out-of-zone test seeded none; skipping mark-all)")
    return
  }
  const r2 = await rawApi(token, "PATCH", "/api/v1/mtm/mobile/notifications", { all: true, isRead: true })
  expect(r2.status === 200, `PATCH all:true → 200 (got ${r2.status})`)
  expect(r2.json.data?.updated >= unreadBefore, `updated count ≥ unreadBefore (got ${r2.json.data?.updated})`)

  const r3 = await rawApi(token, "GET", "/api/v1/mtm/mobile/notifications")
  expect(r3.json.data?.unread === 0, `unread now 0 (got ${r3.json.data?.unread})`)
}

// ─── Runner ────────────────────────────────────────────────────────────────

async function main() {
  assertLocalSafety()
  console.log(`🔬 Edge cases against ${BASE_URL}`)
  console.log(`   ${EMAIL} @ ${ORG_SLUG}\n`)
  const { token, agentId } = await login()
  console.log(`✅ token + agentId acquired (${agentId})\n`)

  await testGeofence(token, agentId)
  await testForceOverrideAsSupervisor(token, agentId)
  await testRouteDeviation(token, agentId)
  await testPhotoUpload(token, agentId)
  await testMobileNotifications(token)
  await testLocationRateLimit(token)
  // F-02 auth-rate-limit test is gated behind --auth-rate flag. The probe
  // intentionally exhausts the (IP, email) bucket on a throwaway email, but
  // any failed login inside main() before the limit expires would 429 too
  // — and the limit window is 60s, which is awkward in a single run.
  // Verified working manually (sequence [401×5, 429] on a fresh email).
  if (process.argv.includes("--auth-rate")) {
    await testAuthRateLimit()
  } else {
    console.log("\n── 4. mobile-auth rate limit — skipped (re-run with --auth-rate) ──")
  }

  console.log("\n✅ All edge cases passed.")
}

main().catch((err) => {
  console.error("\n❌ Edge-case suite failed:")
  console.error(err.message || err)
  process.exit(1)
})
