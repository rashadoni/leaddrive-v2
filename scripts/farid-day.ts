import { passwordPolicyError } from "./password-policy.mjs"

export {} // module — keeps top-level consts out of the shared global scope

/**
 * Farid's working day — MTM mobile-flow demo.
 *
 * Simulates a real field agent's mobile app via pure HTTP:
 *   1. login (POST /api/v1/mtm/mobile/auth) → JWT
 *   2. GPS pings while driving (POST /api/v1/mtm/mobile/location)
 *   3. check-in at customer (POST /api/v1/mtm/visits + Bearer JWT)
 *   4. write an order (POST /api/v1/mtm/orders)
 *   5. check-out (PUT /api/v1/mtm/visits/[id])
 *
 * No SDK / no Prisma. Just fetch — proves the API is mobile-ready end-to-end.
 *
 * Usage:
 *   MTM_DEMO_AGENT_PASSWORD=... npx tsx scripts/farid-day.ts
 *
 * Env overrides:
 *   MTM_DEMO_EMAIL          — agent email (default farid@leaddrive.com)
 *   MTM_DEMO_AGENT_PASSWORD — required agent password from seed-mtm.ts
 *   MTM_DEMO_ORG_SLUG       — tenant slug (default leaddrive)
 *   BASE_URL                — local server origin (default http://localhost:3000)
 */

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "")
const EMAIL = process.env.MTM_DEMO_EMAIL || "farid@leaddrive.com"
const PASSWORD = process.env.MTM_DEMO_AGENT_PASSWORD || ""
// F-35: tenant disambiguation. Without this, the same email in N orgs gives
// a non-deterministic login. `farid-day.ts` is bound to the `leaddrive` org
// by default — override with ORG_SLUG=... env when testing other tenants.
const ORG_SLUG = process.env.MTM_DEMO_ORG_SLUG || "leaddrive"

function assertLocalSafety() {
  let target
  try {
    target = new URL(BASE_URL)
  } catch {
    throw new Error("BASE_URL must be an absolute local http(s) URL")
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
  if (
    process.env.NODE_ENV === "production"
    || !["http:", "https:"].includes(target.protocol)
    || !localHostnames.has(target.hostname)
    || target.username
    || target.password
  ) {
    throw new Error("scripts/farid-day.ts only runs in non-production against localhost")
  }
  const policyError = passwordPolicyError(PASSWORD)
  if (policyError) throw new Error(`MTM_DEMO_AGENT_PASSWORD: ${policyError}`)
}

// Customer GPS targets — must match scripts/seed-mtm.ts (Baku).
// Farid visits 3 of the 10 seeded customers today.
const TARGETS = [
  {
    code: "MTM-A01",
    name: "Əczaçı Plus — Nəsimi",
    lat: 40.3953,
    lng: 49.8822,
    notes: "Магазин открыт, остатки низкие. Завтра пополнение по контракту.",
    order: [
      { name: "Парацетамол 500мг x10", price: 2.5, qty: 50 },
      { name: "Цитрамон x10", price: 1.8, qty: 30 },
    ],
  },
  {
    code: "MTM-A02",
    name: "Zeytun Market — 28 May",
    lat: 40.3722,
    lng: 49.8485,
    notes: "Встреча прошла хорошо. Менеджер согласен на новые позиции.",
    order: [{ name: "Аспирин 500мг x10", price: 3.0, qty: 40 }],
  },
  {
    code: "MTM-A03",
    name: "Grand Pharmacy — Xətai",
    lat: 40.3882,
    lng: 49.875,
    notes: "Заказ не делали — все позиции в наличии. Зайду через две недели.",
    order: null,
  },
]

// Office origin for the initial morning ping.
const OFFICE = { lat: 40.4093, lng: 49.8671 }

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

async function apiJson(token: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}\n${JSON.stringify(json, null, 2)}`)
  }
  return json
}

let pingCount = 0
async function ping(token: string, lat: number, lng: number, label: string) {
  await apiJson(token, "POST", "/api/v1/mtm/mobile/location", {
    latitude: lat,
    longitude: lng,
    accuracy: 8,
    speed: 25,
  })
  pingCount++
  console.log(`  📡 ${label} — ${lat.toFixed(4)}, ${lng.toFixed(4)}`)
}

async function driveTo(token: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }, steps = 3) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await ping(token, lerp(from.lat, to.lat, t), lerp(from.lng, to.lng, t), `driving (${i}/${steps})`)
    await sleep(400)
  }
}

async function main() {
  assertLocalSafety()
  console.log(`🚀 Simulating Farid's day → ${BASE_URL}`)
  console.log(`   login: ${EMAIL}\n`)

  // 1. Login (tenant-scoped via organizationSlug — F-35)
  const authRes = await apiJson(null, "POST", "/api/v1/mtm/mobile/auth", {
    email: EMAIL,
    password: PASSWORD,
    organizationSlug: ORG_SLUG,
  })
  const token: string = authRes.data.token
  const agentId: string = authRes.data.agent.id
  console.log(`✅ Logged in as ${authRes.data.agent.name} (${agentId})`)
  console.log(`   org: ${authRes.data.agent.organizationName}\n`)

  let prev = OFFICE
  const summary = { visits: 0, orders: 0, locationPings: 0 }

  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i]
    console.log(`\n──────── Stop #${i + 1}: ${t.name} (${t.code}) ────────`)

    // 2. Drive to the customer
    await driveTo(token, prev, { lat: t.lat, lng: t.lng })

    // 3. Resolve customer cuid by the seed-stable `code`. The mobile JWT
    //    flows through getOrgId() so this hits the same multi-tenant scope.
    const custList = await apiJson(token, "GET", `/api/v1/mtm/customers?search=${encodeURIComponent(t.code)}&limit=5`)
    const customer = (custList.data.customers as Array<{ id: string; code: string }>).find((c) => c.code === t.code)
    if (!customer) {
      throw new Error(`Customer ${t.code} not found in DB. Run seed-mtm.ts first.`)
    }

    // 4. Check-in (Authorization: Bearer JWT — getOrgId() falls back to mobile auth)
    const visit = await apiJson(token, "POST", "/api/v1/mtm/visits", {
      agentId,
      customerId: customer.id,
      latitude: t.lat,
      longitude: t.lng,
      notes: t.notes,
    })
    summary.visits++
    console.log(`  📍 Checked in (${visit.data.id}) — "${t.notes.slice(0, 40)}..."`)

    // Hang around for a "moment"
    await sleep(300)

    // 4. Maybe write an order
    if (t.order) {
      const order = await apiJson(token, "POST", "/api/v1/mtm/orders", {
        agentId,
        customerId: customer.id,
        visitId: visit.data.id,
        items: t.order,
        notes: `Заказ по визиту в ${t.name}`,
      })
      summary.orders++
      console.log(`  🛒 Order ${order.data.orderNumber} — $${order.data.totalAmount}`)
    } else {
      console.log("  🛒 (no order this stop)")
    }

    // 5. Check-out
    await apiJson(token, "PUT", `/api/v1/mtm/visits/${visit.data.id}`, {
      agentId,
      status: "CHECKED_OUT",
      latitude: t.lat,
      longitude: t.lng,
    })
    console.log("  🚪 Checked out")

    prev = { lat: t.lat, lng: t.lng }
  }

  // 6. Drive back to office, one final ping
  await driveTo(token, prev, OFFICE, 2)

  summary.locationPings = pingCount

  console.log("\n══════════════════════════════════════════════")
  console.log("🎉 Farid's day complete")
  console.log(`   ${JSON.stringify(summary)}`)
  console.log("══════════════════════════════════════════════")
  console.log("\nNext: login as admin → /mtm/map, /mtm/visits, /mtm/orders, /mtm/activity")
}

main().catch((err) => {
  console.error("❌ Demo failed:")
  console.error(err.message)
  process.exit(1)
})
