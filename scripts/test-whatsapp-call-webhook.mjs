#!/usr/bin/env node

import { createHmac } from "crypto"
import { readFileSync } from "fs"

const DEFAULT_CALLER_PHONE = "994501234567"
const DEFAULT_BUSINESS_PHONE = "994123456789"
const DEFAULT_DELAY_MS = 1500
const DEFAULT_VERIFY_TIMEOUT_MS = 15000
const DEFAULT_VERIFY_INTERVAL_MS = 1000

const SAMPLE_SDP_OFFER = [
  "v=0",
  "o=- 4611731400430051337 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=msid-semantic: WMS",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=ice-ufrag:test",
  "a=ice-pwd:testtesttesttesttesttest",
  "a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00",
  "a=setup:actpass",
  "a=mid:0",
  "a=sendrecv",
  "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2",
  "",
].join("\r\n")

function parseArgs(argv) {
  const args = {}
  for (const raw of argv) {
    if (raw === "--execute") {
      args.execute = true
      continue
    }
    if (raw === "--verify") {
      args.verify = true
      continue
    }
    if (raw === "--preflight") {
      args.preflight = true
      continue
    }
    if (raw === "--help" || raw === "-h") {
      args.help = true
      continue
    }
    const match = raw.match(/^--([^=]+)=(.*)$/)
    if (match) args[match[1]] = match[2]
  }
  return args
}

function usage() {
  console.log(`
Usage:
  node scripts/test-whatsapp-call-webhook.mjs \\
    --base-url=https://crm.example.com \\
    --tenant=leaddrive \\
    --phone-number-id=<meta-phone-number-id> \\
    --app-secret=<meta-app-secret> \\
    --caller-phone=994501234567 \\
    --business-phone=994123456789 \\
    --scenario=inbound-connect \\
    --execute

Scenarios:
  inbound-connect  Create one inbound WhatsApp call in CRM as ringing.
  inbound-ended    Create inbound call, then send terminate for the same call id.

Options:
  --base-url=<origin>                 Required. Remote hosts require exact confirmation.
  --tenant=<tenant-slug>              Required for tenant-routed production tests.
  --phone-number-id=<id>              Defaults to WHATSAPP_PHONE_NUMBER_ID / WA_PHONE_NUMBER_ID.
  --app-secret=<secret>               Defaults to WHATSAPP_APP_SECRET / WA_APP_SECRET.
  --call-id=wacid.test.<timestamp>    Stable id lets you terminate/update the same test call.
  --caller-phone=<digits>             Defaults to ${DEFAULT_CALLER_PHONE}.
  --business-phone=<digits>           Defaults to ${DEFAULT_BUSINESS_PHONE}.
  --caller-name="Test Caller"         Defaults to "WhatsApp Calling Test".
  --sdp-file=/path/to/offer.sdp       Use a real Meta SDP offer when testing the Answer button.
  --delay-ms=1500                     Delay between connect and terminate in inbound-ended.
  --verify                            After POST, verify CallLog + temporary SDP session via CRM API.
  --preflight                         Safe readiness check: health, signed webhook handshake, optional CRM channel config.
  --auth-cookie='name=value; ...'      CRM admin cookie for --verify/--preflight. Defaults to WA_TEST_AUTH_COOKIE.
  --bearer-token=<token>               Alternative Authorization bearer for --verify/--preflight.
  --verify-timeout-ms=15000            How long to wait for CallLog/session after webhook POST.
  --verify-interval-ms=1000            Polling interval for --verify.
  --execute                           Required to send. Without it, prints the payload only.

Notes:
  The built-in SDP is only enough to verify webhook -> CallLog -> Inbox rendering.
  To test browser answer/accept media, pass a real SDP offer from Meta with --sdp-file.
  Prefer env vars for secrets/cookies so they do not appear in shell history.
`)
}

function requireValue(name, value) {
  if (!value) {
    console.error(`[wa-call-test] Missing --${name}`)
    process.exit(2)
  }
  return value
}

function requireTargetBaseUrl(value) {
  const raw = requireValue("base-url", value).trim().replace(/\/+$/, "")
  let target
  try {
    target = new URL(raw)
  } catch {
    throw new Error("--base-url must be an absolute http(s) origin")
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
  if (
    !["http:", "https:"].includes(target.protocol)
    || target.username
    || target.password
    || target.pathname !== "/"
    || target.search
    || target.hash
  ) {
    throw new Error("--base-url must be an http(s) origin without credentials, path, query, or fragment")
  }
  if (localHostnames.has(target.hostname) && process.env.NODE_ENV === "production") {
    throw new Error("Local WhatsApp test targets are blocked when NODE_ENV=production")
  }
  if (!localHostnames.has(target.hostname)) {
    if (target.protocol !== "https:") throw new Error("Remote WhatsApp test targets must use HTTPS")
    if (process.env.CONFIRM_REMOTE_WA_TEST !== target.hostname) {
      throw new Error(`Set CONFIRM_REMOTE_WA_TEST=${target.hostname} to target this remote host`)
    }
  }
  return target.origin
}

function cleanPhone(value) {
  return String(value || "").replace(/[^\d]/g, "")
}

function nowUnix() {
  return Math.floor(Date.now() / 1000).toString()
}

function signature(rawBody, appSecret) {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex")
}

function targetUrl(baseUrl, tenant) {
  const base = String(baseUrl).replace(/\/+$/, "")
  const url = new URL(`${base}/api/v1/webhooks/whatsapp`)
  if (tenant) url.searchParams.set("t", tenant)
  return url.toString()
}

function crmApiUrl(baseUrl, path) {
  const base = String(baseUrl).replace(/\/+$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

function authHeaders({ cookie, bearerToken }) {
  const headers = { Accept: "application/json" }
  if (cookie) headers.Cookie = cookie
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`
  return headers
}

async function getJson(url, { headers }) {
  const res = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { res, text, json }
}

async function checkHealth(baseUrl) {
  const url = crmApiUrl(baseUrl, "/api/v1/ping")
  const { res, text, json } = await getJson(url, { headers: { Accept: "application/json" } })
  if (!res.ok || json?.ok !== true) {
    throw new Error(`Health check failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  console.log("[wa-call-test] Preflight health ok")
}

function preflightPayload({ phoneNumberId, businessPhone }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "wa-call-preflight",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: businessPhone,
                phone_number_id: phoneNumberId,
              },
            },
          },
        ],
      },
    ],
  }
}

async function checkSignedWebhookHandshake({ url, appSecret, phoneNumberId, businessPhone }) {
  const payload = preflightPayload({ phoneNumberId, businessPhone })
  const rawBody = JSON.stringify(payload)
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature(rawBody, appSecret),
    },
    body: rawBody,
  })
  const body = await res.text()
  if (!res.ok) {
    throw new Error(`Signed webhook preflight failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  console.log(`[wa-call-test] Preflight signed webhook ok: HTTP ${res.status}`)
}

function channelLabel(channel) {
  return channel?.configName || channel?.displayName || channel?.id || "WhatsApp channel"
}

async function checkCrmChannelConfig({ baseUrl, headers, phoneNumberId }) {
  if (!headers.Cookie && !headers.Authorization) {
    console.log("[wa-call-test] Preflight CRM channel check skipped: provide --auth-cookie, --bearer-token, WA_TEST_AUTH_COOKIE or WA_TEST_BEARER_TOKEN.")
    return
  }

  const listUrl = crmApiUrl(baseUrl, "/api/v1/channels")
  const { res, text, json } = await getJson(listUrl, { headers })
  if (!res.ok || !Array.isArray(json?.data)) {
    throw new Error(`CRM channel preflight failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }

  const whatsappChannels = json.data.filter((channel) => channel?.channelType === "whatsapp")
  if (!whatsappChannels.length) {
    throw new Error("CRM channel preflight failed: no WhatsApp channel exists for the authenticated tenant")
  }

  const expectedPhone = cleanPhone(phoneNumberId)
  const inspected = []
  for (const channel of whatsappChannels) {
    const detailUrl = crmApiUrl(baseUrl, `/api/v1/channels/${encodeURIComponent(channel.id)}`)
    const detail = await getJson(detailUrl, { headers })
    const row = detail.json?.data || {}
    const actualPhone = cleanPhone(row.phoneNumberId || row.phoneNumber)
    inspected.push({
      id: channel.id,
      label: channelLabel(channel),
      phoneMatches: actualPhone === expectedPhone,
      isActive: channel.isActive === true,
      hasAccessToken: channel.hasAccessToken === true,
      hasPhoneNumberId: channel.hasPhoneNumberId === true,
      hasBusinessAccountId: channel.hasBusinessAccountId === true,
      hasVerifyToken: channel.hasVerifyToken === true,
      hasAppSecret: channel.hasAppSecret === true,
    })
  }

  const match = inspected.find((channel) => channel.phoneMatches)
  if (!match) {
    throw new Error(`CRM channel preflight failed: no WhatsApp channel matches phone_number_id=${phoneNumberId}`)
  }

  const missing = []
  if (!match.isActive) missing.push("active channel")
  if (!match.hasAccessToken) missing.push("Access Token")
  if (!match.hasPhoneNumberId) missing.push("Phone Number ID")
  if (!match.hasBusinessAccountId) missing.push("WABA / Business Account ID")
  if (!match.hasVerifyToken) missing.push("Webhook Verify Token")
  if (!match.hasAppSecret) missing.push("App Secret")
  if (missing.length) {
    throw new Error(`CRM channel preflight failed for ${match.label}: missing ${missing.join(", ")}`)
  }

  console.log(`[wa-call-test] Preflight CRM channel ok: ${match.label} (${match.id})`)
}

function callMatches(call, callId) {
  return call && call.callSid === callId && call.provider === "whatsapp"
}

function statusMatches(actual, expectedStatuses) {
  if (!expectedStatuses?.length) return true
  return expectedStatuses.includes(String(actual || ""))
}

async function waitForCallLog({
  baseUrl,
  headers,
  callId,
  timeoutMs,
  intervalMs,
  expectedStatuses,
}) {
  const deadline = Date.now() + timeoutMs
  let last = "not attempted"
  const url = crmApiUrl(
    baseUrl,
    `/api/v1/calls?provider=whatsapp&callSid=${encodeURIComponent(callId)}&limit=1`,
  )

  while (Date.now() <= deadline) {
    const { res, text, json } = await getJson(url, { headers })
    if (!res.ok) {
      throw new Error(`CallLog verification failed: HTTP ${res.status} ${text.slice(0, 200)}`)
    }

    const call = Array.isArray(json?.data) ? json.data.find((item) => callMatches(item, callId)) : null
    if (call && statusMatches(call.status, expectedStatuses)) {
      console.log(`[wa-call-test] Verified CallLog id=${call.id} status=${call.status}`)
      return call
    }
    last = call
      ? `status=${call.status}, expected=${expectedStatuses.join("|")}`
      : "CallLog not found yet"
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for CallLog ${callId}: ${last}`)
}

async function verifySessionAvailable({ baseUrl, headers, callLogId, callId }) {
  const url = crmApiUrl(baseUrl, `/api/v1/calls/whatsapp/${encodeURIComponent(callLogId)}/session`)
  const { res, text, json } = await getJson(url, { headers })
  if (!res.ok || !json?.data) {
    throw new Error(`Session verification failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  if (json.data.callSid !== callId || json.data.sdpType !== "offer" || !json.data.sdp) {
    throw new Error(`Session verification returned unexpected payload for ${callId}`)
  }
  console.log(`[wa-call-test] Verified temporary SDP session expiresAt=${json.data.expiresAt}`)
}

async function verifySessionGone({ baseUrl, headers, callLogId }) {
  const url = crmApiUrl(baseUrl, `/api/v1/calls/whatsapp/${encodeURIComponent(callLogId)}/session`)
  const { res } = await getJson(url, { headers })
  if (res.status !== 404) {
    throw new Error(`Expected temporary SDP session cleanup to return HTTP 404, got ${res.status}`)
  }
  console.log("[wa-call-test] Verified temporary SDP session cleanup")
}

function callPayload({
  phoneNumberId,
  businessPhone,
  callerPhone,
  callerName,
  callId,
  event,
  timestamp,
  sdp,
}) {
  const call = {
    id: callId,
    event,
    direction: "USER_INITIATED",
    from: callerPhone,
    to: businessPhone,
    timestamp,
  }
  if (event === "connect") {
    call.session = {
      sdp_type: "offer",
      sdp,
    }
  } else if (event === "terminate") {
    call.status = ["completed"]
    call.end_time = timestamp
    call.duration = "1"
  }

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "wa-call-test",
        changes: [
          {
            field: "calls",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: businessPhone,
                phone_number_id: phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: callerName },
                  wa_id: callerPhone,
                },
              ],
              calls: [call],
            },
          },
        ],
      },
    ],
  }
}

async function postWebhook({ url, appSecret, payload, execute }) {
  const rawBody = JSON.stringify(payload)
  if (!execute) {
    console.log(`[wa-call-test] Dry run. Target: ${url}`)
    console.log(rawBody)
    return { status: 0, body: "dry-run" }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature(rawBody, appSecret),
    },
    body: rawBody,
  })
  const body = await res.text()
  console.log(`[wa-call-test] POST ${url} -> HTTP ${res.status}`)
  console.log(body)
  if (!res.ok) throw new Error(`Webhook POST failed with HTTP ${res.status}`)
  return { status: res.status, body }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  usage()
  process.exit(0)
}

const scenario = args.scenario || "inbound-connect"
if (!["inbound-connect", "inbound-ended"].includes(scenario)) {
  console.error(`[wa-call-test] Unsupported --scenario=${scenario}`)
  process.exit(2)
}

const tenant = requireValue("tenant", args.tenant || process.env.WA_TEST_TENANT)
const phoneNumberId = requireValue(
  "phone-number-id",
  args["phone-number-id"] || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WA_PHONE_NUMBER_ID,
)
const appSecret = requireValue(
  "app-secret",
  args["app-secret"] || process.env.WHATSAPP_APP_SECRET || process.env.WA_APP_SECRET,
)
const baseUrl = requireTargetBaseUrl(args["base-url"] || process.env.WA_TEST_BASE_URL)
const callerPhone = cleanPhone(args["caller-phone"] || process.env.WA_TEST_CALLER_PHONE || DEFAULT_CALLER_PHONE)
const businessPhone = cleanPhone(args["business-phone"] || process.env.WA_TEST_BUSINESS_PHONE || DEFAULT_BUSINESS_PHONE)
const callerName = args["caller-name"] || "WhatsApp Calling Test"
const callId = args["call-id"] || `wacid.test.${Date.now()}`
const delayMs = Number(args["delay-ms"] || DEFAULT_DELAY_MS)
const verifyTimeoutMs = Number(args["verify-timeout-ms"] || process.env.WA_TEST_VERIFY_TIMEOUT_MS || DEFAULT_VERIFY_TIMEOUT_MS)
const verifyIntervalMs = Number(args["verify-interval-ms"] || process.env.WA_TEST_VERIFY_INTERVAL_MS || DEFAULT_VERIFY_INTERVAL_MS)
const sdp = args["sdp-file"] ? readFileSync(args["sdp-file"], "utf8") : SAMPLE_SDP_OFFER
const url = targetUrl(baseUrl, tenant)
const shouldVerify = !!args.verify
const shouldPreflight = !!args.preflight
const crmHeaders = authHeaders({
  cookie: args["auth-cookie"] || process.env.WA_TEST_AUTH_COOKIE,
  bearerToken: args["bearer-token"] || process.env.WA_TEST_BEARER_TOKEN,
})

if (shouldVerify && !args.execute) {
  console.error("[wa-call-test] --verify requires --execute because dry-run does not create a CRM call.")
  process.exit(2)
}
if (shouldVerify && !crmHeaders.Cookie && !crmHeaders.Authorization) {
  console.error("[wa-call-test] --verify requires --auth-cookie, --bearer-token, WA_TEST_AUTH_COOKIE or WA_TEST_BEARER_TOKEN.")
  process.exit(2)
}

if (shouldPreflight) {
  await checkHealth(baseUrl)
  await checkSignedWebhookHandshake({ url, appSecret, phoneNumberId, businessPhone })
  await checkCrmChannelConfig({ baseUrl, headers: crmHeaders, phoneNumberId })
  if (!args.execute) {
    console.log("[wa-call-test] Preflight complete. Add --execute to create a synthetic CallLog test event.")
    process.exit(0)
  }
}

const basePayload = {
  phoneNumberId,
  businessPhone,
  callerPhone,
  callerName,
  callId,
  sdp,
}

await postWebhook({
  url,
  appSecret,
  execute: !!args.execute,
  payload: callPayload({
    ...basePayload,
    event: "connect",
    timestamp: nowUnix(),
  }),
})

let verifiedCall = null
if (shouldVerify) {
  verifiedCall = await waitForCallLog({
    baseUrl,
    headers: crmHeaders,
    callId,
    timeoutMs: Number.isFinite(verifyTimeoutMs) ? Math.max(1000, verifyTimeoutMs) : DEFAULT_VERIFY_TIMEOUT_MS,
    intervalMs: Number.isFinite(verifyIntervalMs) ? Math.max(250, verifyIntervalMs) : DEFAULT_VERIFY_INTERVAL_MS,
    expectedStatuses: ["ringing"],
  })
  await verifySessionAvailable({
    baseUrl,
    headers: crmHeaders,
    callLogId: verifiedCall.id,
    callId,
  })
}

if (scenario === "inbound-ended") {
  if (args.execute) await sleep(Number.isFinite(delayMs) ? Math.max(0, delayMs) : DEFAULT_DELAY_MS)
  await postWebhook({
    url,
    appSecret,
    execute: !!args.execute,
    payload: callPayload({
      ...basePayload,
      event: "terminate",
      timestamp: nowUnix(),
    }),
  })

  if (shouldVerify) {
    const endedCall = await waitForCallLog({
      baseUrl,
      headers: crmHeaders,
      callId,
      timeoutMs: Number.isFinite(verifyTimeoutMs) ? Math.max(1000, verifyTimeoutMs) : DEFAULT_VERIFY_TIMEOUT_MS,
      intervalMs: Number.isFinite(verifyIntervalMs) ? Math.max(250, verifyIntervalMs) : DEFAULT_VERIFY_INTERVAL_MS,
      expectedStatuses: ["completed", "failed"],
    })
    await verifySessionGone({
      baseUrl,
      headers: crmHeaders,
      callLogId: endedCall.id,
    })
  }
}

console.log(`[wa-call-test] call-id=${callId}`)
