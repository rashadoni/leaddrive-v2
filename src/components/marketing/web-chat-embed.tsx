"use client"

import { useEffect } from "react"

/**
 * Injects the LeadDrive Web Chat loader AFTER React hydration so the DOM
 * nodes the loader appends to <body> aren't stripped by the reconciler.
 *
 * The loader itself (served from app.leaddrivecrm.org/widget.js) reads its
 * own <script> tag's data-key / data-lang to know which tenant and language
 * to show, then fetches the widget config over CORS and renders a floating
 * bubble + iframe.
 */
const WEB_CHAT_PUBLIC_KEY = "wc_f37a218a9541147136"
const WIDGET_LOADER_URL = "https://app.leaddrivecrm.org/widget.js"

export function WebChatEmbed() {
  useEffect(() => {
    // Guard against double-injection on client-side route changes
    if (document.querySelector('script[data-leaddrive-web-chat]')) return

    const s = document.createElement("script")
    s.src = WIDGET_LOADER_URL
    s.async = true
    s.setAttribute("data-key", WEB_CHAT_PUBLIC_KEY)
    s.setAttribute("data-lang", "az")
    s.setAttribute("data-leaddrive-web-chat", "1")
    document.body.appendChild(s)
  }, [])

  return null
}
