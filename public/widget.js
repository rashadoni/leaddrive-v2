/* LeadDrive Web Chat Widget loader
   Usage:
     <script src="https://app.leaddrivecrm.org/widget.js" data-key="YOUR_PUBLIC_KEY" async></script>
*/
(function () {
  if (window.__ldChatLoaded) {
    console.warn("[leaddrive-widget] already loaded, skipping")
    return
  }
  window.__ldChatLoaded = true
  console.log("[leaddrive-widget] IIFE started")

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script")
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i]
      if (s.src && s.src.indexOf("widget.js") !== -1) return s
    }
    return null
  })()
  if (!script) {
    console.warn("[leaddrive-widget] couldn't find own script tag")
    return
  }

  var key = script.getAttribute("data-key")
  if (!key) {
    console.warn("[leaddrive-widget] missing data-key attribute")
    return
  }
  console.log("[leaddrive-widget] key=", key)

  var origin = new URL(script.src).origin
  var position = script.getAttribute("data-position") || "bottom-right"
  var primaryColor = script.getAttribute("data-color") || "#0176D3"
  var lang = script.getAttribute("data-lang") || ""

  fetch(origin + "/api/v1/public/web-chat/config?key=" + encodeURIComponent(key))
    .then(function (r) { return r.json() })
    .then(function (res) {
      console.log("[leaddrive-widget] config response", res)
      if (!res || !res.success) return
      var cfg = res.data
      renderLauncher(cfg)
    })
    .catch(function (err) { console.warn("[leaddrive-widget] fetch failed", err) })

  function renderLauncher(cfg) {
    var color = cfg.primaryColor || primaryColor
    var side = (cfg.position || position) === "bottom-left" ? "left" : "right"

    var btn = document.createElement("button")
    btn.setAttribute("aria-label", cfg.title || "Chat")
    btn.style.cssText = [
      "position:fixed",
      "bottom:20px",
      side + ":20px",
      "width:56px",
      "height:56px",
      "border-radius:50%",
      "border:none",
      "cursor:pointer",
      "z-index:2147483646",
      "box-shadow:0 6px 20px rgba(0,0,0,.2)",
      "background:" + color,
      "color:#fff",
      "display:flex",
      "align-items:center",
      "justify-content:center",
    ].join(";")
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'

    var iframe = null
    var open = false

    btn.addEventListener("click", function () {
      if (!iframe) {
        iframe = document.createElement("iframe")
        iframe.src = origin + "/embed/chat/" + encodeURIComponent(key) + (lang ? "?lang=" + encodeURIComponent(lang) : "")
        iframe.style.cssText = [
          "position:fixed",
          "bottom:90px",
          side + ":20px",
          "width:360px",
          "height:560px",
          "max-height:80vh",
          "border:none",
          "border-radius:16px",
          "box-shadow:0 12px 40px rgba(0,0,0,.25)",
          "z-index:2147483647",
          "background:#fff",
        ].join(";")
        iframe.allow = "clipboard-write"
        document.body.appendChild(iframe)
        open = true
      } else {
        open = !open
        iframe.style.display = open ? "block" : "none"
      }
    })

    if (cfg.showLauncher !== false) {
      document.body.appendChild(btn)
    }
  }
})()
