/*
 * LeadDrive e-Qaimə — on LeadDrive's own pages.
 *
 * Marks the page so Finance → «E-qaimə» knows the extension is here, tells the
 * background which LeadDrive address this person works at, and passes on the
 * tab's «Refresh from e-Taxes».
 */
"use strict"

document.documentElement.setAttribute("data-leaddrive-eqaime", chrome.runtime.getManifest().version)
chrome.runtime.sendMessage({ type: "leaddrive-origin" }).catch(() => {})

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.source !== "leaddrive-crm" || data.type !== "eqaime-open-portal") return
  chrome.runtime.sendMessage({ type: "open-portal" }).catch(() => {})
})
