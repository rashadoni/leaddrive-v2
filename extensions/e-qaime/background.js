/*
 * LeadDrive e-Qaimə — background.
 *
 * The only part that talks to LeadDrive. It carries invoices the portal page
 * handed it to LeadDrive's /api/finance/e-qaime, with the LeadDrive session the
 * person already has in this Chrome. It never sees the portal's pass: that
 * stays in the portal's tab (etaxes.js).
 */
"use strict"

const PORTAL_HOME = "https://new.e-taxes.gov.az/etaxes/"
const DEFAULT_ORIGIN = "https://app.leaddrivecrm.org"
/** «Refresh from e-Taxes» in LeadDrive asks for a reading; it waits this long for the sign-in. */
const AUTO_SYNC_TTL_MS = 15 * 60 * 1000

function allowedOrigin(origin) {
  try {
    const url = new URL(origin)
    if (url.origin !== origin) return false
    if (url.protocol === "https:" && (url.hostname === "leaddrivecrm.org" || url.hostname.endsWith(".leaddrivecrm.org"))) return true
    return url.protocol === "http:" && url.hostname === "localhost" && url.port === "3000"
  } catch {
    return false
  }
}

async function leaddriveOrigin() {
  const { leaddriveOrigin } = await chrome.storage.local.get("leaddriveOrigin")
  return allowedOrigin(leaddriveOrigin) ? leaddriveOrigin : DEFAULT_ORIGIN
}

/** One request to LeadDrive's e-qaimə API, answered as { ok, status, json, origin }. */
async function leaddrive(path, init = {}) {
  const origin = await leaddriveOrigin()
  try {
    const response = await fetch(origin + "/api/finance/e-qaime" + path, { credentials: "include", cache: "no-store", ...init })
    let json = null
    try { json = await response.json() } catch { /* not JSON: a sign-in page */ }
    return { ok: response.ok && json !== null, status: response.status, json, origin }
  } catch (error) {
    return { ok: false, status: 0, json: null, origin, error: String(error && error.message || error) }
  }
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function openPortal() {
  await chrome.storage.local.set({ autoSyncUntil: Date.now() + AUTO_SYNC_TTL_MS })
  const tabs = await chrome.tabs.query({ url: "https://new.e-taxes.gov.az/*" })
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true })
    await chrome.windows.update(tabs[0].windowId, { focused: true })
    chrome.tabs.sendMessage(tabs[0].id, { type: "auto-sync" }).catch(() => {})
  } else {
    await chrome.tabs.create({ url: PORTAL_HOME })
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const fromPortal = sender.tab && sender.url && sender.url.startsWith("https://new.e-taxes.gov.az/")
  const fromLeadDrive = sender.tab && sender.origin && allowedOrigin(sender.origin)

  if (fromLeadDrive && message && message.type === "leaddrive-origin") {
    chrome.storage.local.set({ leaddriveOrigin: sender.origin })
    return false
  }
  if (fromLeadDrive && message && message.type === "open-portal") {
    chrome.storage.local.set({ leaddriveOrigin: sender.origin })
    openPortal().then(() => reply({ ok: true }), (error) => reply({ ok: false, error: String(error) }))
    return true
  }
  if (!fromPortal || !message) return false

  const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  let pending = null
  switch (message.type) {
    case "ld-session": pending = leaddrive("/session"); break
    case "ld-known": pending = leaddrive("/known", json(message.body)); break
    case "ld-import": pending = leaddrive("/import", json(message.body)); break
    case "ld-pdf":
      pending = leaddrive("/" + encodeURIComponent(message.id) + "/pdf", {
        method: "PUT",
        headers: { "content-type": "application/pdf" },
        body: base64ToBytes(message.base64),
      })
      break
    case "ld-open-tab":
      pending = leaddriveOrigin().then((origin) => chrome.tabs.create({ url: origin + "/finance?tab=e-qaime" })).then(() => ({ ok: true }))
      break
    case "take-auto-sync":
      pending = chrome.storage.local.get("autoSyncUntil").then(({ autoSyncUntil }) => {
        chrome.storage.local.remove("autoSyncUntil")
        return { ok: true, json: { autoSync: Number(autoSyncUntil) > Date.now() } }
      })
      break
    default:
      return false
  }
  pending.then(reply, (error) => reply({ ok: false, status: 0, json: null, error: String(error) }))
  return true
})

// The toolbar icon: on the portal it opens the panel, elsewhere it opens the portal.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab && tab.url && tab.url.startsWith("https://new.e-taxes.gov.az/")) {
    chrome.tabs.sendMessage(tab.id, { type: "toggle-panel" }).catch(() => {})
  } else {
    await chrome.tabs.create({ url: PORTAL_HOME })
  }
})
