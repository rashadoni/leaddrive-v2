/**
 * LeadDrive web tracking snippet (C1). Embed on the tenant's site:
 *
 *   <script src="https://app.leaddrivecrm.org/ldtrack.js" data-key="ldt_..." async></script>
 *
 * Optional attributes:
 *   data-endpoint="https://.../api/v1/public/web-tracking"
 *                                    FULL ingest URL override (no path is appended).
 *                                    Default: script origin + /api/v1/public/web-tracking.
 *   data-requires-consent            GDPR mode: no cookie and no network until
 *                                    window.ldTrack('consent') is called (persisted in localStorage)
 *
 * API: window.ldTrack('event', name, props?)  — custom event
 *      window.ldTrack('identify', email)       — bind this visitor to a contact
 *                                                by email (call on form submit);
 *                                                also accepts { email: "..." }
 *      window.ldTrack('consent')              — grant consent in consent mode
 *
 * A visitor landing from a tracked email/SMS/ad click carries a signed `_ldi`
 * token in the URL; the snippet auto-detects it, identifies by token, and
 * strips it from the address bar (C2 identity stitching).
 *
 * Links to LeadDrive-hosted forms (<app origin>/f/...) are decorated on click
 * with the visitor id (`_ldv` param) so a form submission on the app domain —
 * where this site's first-party cookie is invisible — can still stitch the
 * submitter's browsing history to the contact the form resolves.
 *
 * Plain ES5, no dependencies. Batches events and flushes via sendBeacon
 * (text/plain — no CORS preflight) with a fetch fallback.
 */
(function () {
  "use strict";
  if (window.__ldtrackLoaded) return;
  window.__ldtrackLoaded = true;

  var script = document.currentScript;
  if (!script) return;
  var KEY = script.getAttribute("data-key");
  if (!KEY) return;
  // The app origin (where hosted forms and the default API live) is where
  // this script was loaded from.
  var APP_ORIGIN = (function () {
    try { return new URL(script.src).origin; } catch (e) { return null; }
  })();
  // data-endpoint is the FULL ingest URL; only the default appends the path.
  var ENDPOINT = script.getAttribute("data-endpoint") || ((APP_ORIGIN || "") + "/api/v1/public/web-tracking");
  // Identify endpoint sits beside the ingest endpoint (append "/identify"),
  // so a custom data-endpoint override moves both together.
  var IDENTIFY_ENDPOINT = ENDPOINT + "/identify";
  var NEEDS_CONSENT = script.hasAttribute("data-requires-consent");
  var COOKIE = "_ldv";
  var CONSENT_LS = "_ldv_consent";
  var FLUSH_MS = 5000;
  var MAX_BATCH = 20;
  var MAX_BUFFER = 50;

  var queue = [];
  var timer = null;
  var consented = !NEEDS_CONSENT;
  try { if (localStorage.getItem(CONSENT_LS) === "1") consented = true; } catch (e) {}

  function rndId() {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var id = "";
    var buf = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < buf.length; i++) id += chars[buf[i] % chars.length];
    return id;
  }

  function getCookie() {
    var m = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([A-Za-z0-9_-]{8,64})"));
    return m ? m[1] : null;
  }

  function ensureVisitorId() {
    if (!consented) return null; // no cookie before consent
    var id = getCookie();
    if (!id) {
      id = rndId();
      // First-party, 400 days, Lax — survives navigation, never sent cross-site.
      document.cookie =
        COOKIE + "=" + id + "; Max-Age=" + 400 * 24 * 3600 + "; Path=/; SameSite=Lax" +
        (location.protocol === "https:" ? "; Secure" : "");
    }
    return id;
  }

  // Shared transport: sendBeacon (text/plain keeps it a "simple request" —
  // no preflight, survives unload) with a fetch fallback.
  function sendPayload(endpoint, payload, preferBeacon) {
    var sent = false;
    if ((preferBeacon || preferBeacon === undefined) && navigator.sendBeacon) {
      sent = navigator.sendBeacon(endpoint, new Blob([payload], { type: "text/plain" }));
    }
    if (!sent) {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    }
  }

  // Pop up to MAX_BATCH queued events into a serialized ingest payload
  // (null when there is nothing to send / no consent yet).
  function takeBatch() {
    if (!consented || queue.length === 0) return null;
    var visitorId = ensureVisitorId();
    if (!visitorId) return null;
    var events = queue.splice(0, MAX_BATCH);
    var payload = JSON.stringify({ key: KEY, visitorId: visitorId, events: events });
    if (queue.length > 0) schedule();
    return payload;
  }

  function flush(useBeacon) {
    var payload = takeBatch();
    if (payload) sendPayload(ENDPOINT, payload, useBeacon);
  }

  // Like flush(), but returns a promise that settles when the server has
  // ACCEPTED the batch — identify() serializes on it so the session row
  // exists before the stitch request lands.
  function flushAwait() {
    var payload = takeBatch();
    if (!payload) return Promise.resolve();
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload,
      keepalive: true,
    }).catch(function () {});
  }

  // C2: bind this visitor to a contact. `fields` is { email } and/or { token }.
  // Needs a visitorId, so it is gated on consent exactly like flush().
  function identify(fields) {
    if (!consented) return;
    var visitorId = ensureVisitorId();
    if (!visitorId) return;
    var body = { key: KEY, visitorId: visitorId, url: location.href.slice(0, 2000) };
    if (fields.email) body.email = String(fields.email).slice(0, 320);
    if (fields.token) body.token = String(fields.token).slice(0, 512);
    if (!body.email && !body.token) return;
    // Land the buffered pageviews BEFORE the identify request so the stitch
    // sees the visitor's session (identify is not latency-critical; the
    // server additionally self-heals the reverse order with a bound stub
    // session and a re-claim pass).
    flushAwait().then(function () {
      sendPayload(IDENTIFY_ENDPOINT, JSON.stringify(body));
    });
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      flush(false);
    }, FLUSH_MS);
  }

  function push(evt) {
    if (queue.length >= MAX_BUFFER) queue.shift(); // consent-mode buffer stays bounded
    queue.push(evt);
    if (consented) schedule();
  }

  function pageview() {
    push({
      type: "pageview",
      url: location.href.slice(0, 2000),
      referrer: (document.referrer || "").slice(0, 2000) || undefined,
    });
  }

  window.ldTrack = function (cmd, name, props) {
    if (cmd === "consent") {
      if (!consented) {
        consented = true;
        try { localStorage.setItem(CONSENT_LS, "1"); } catch (e) {}
        flush(false); // release everything buffered pre-consent
        maybeIdentifyPendingToken(); // an email-click `_ldi` deferred until consent
      }
      return;
    }
    if (cmd === "identify") {
      // Accept ldTrack('identify', 'a@b.com') or ldTrack('identify', { email }).
      var email = typeof name === "string" ? name : name && name.email;
      if (email) identify({ email: email });
      return;
    }
    if (cmd === "event" && typeof name === "string" && name) {
      push({
        type: "event",
        name: name.slice(0, 100),
        url: location.href.slice(0, 2000),
        metadata: props && typeof props === "object" ? props : undefined,
      });
    }
  };

  // C2: a tracked email/SMS/ad click lands with a signed `_ldi` token. Strip
  // it from the URL IMMEDIATELY (even before consent) so it is not buffered
  // into pageview URLs, re-sent on SPA navigation, copied into a shared link,
  // or leaked via Referer while a consent banner sits unanswered. The token
  // itself is held in memory and used once consent allows an identify call.
  var pendingIdentityToken = (function () {
    try {
      var u = new URL(location.href);
      var token = u.searchParams.get("_ldi");
      if (token) {
        u.searchParams.delete("_ldi");
        var clean = u.pathname + (u.searchParams.toString() ? "?" + u.searchParams.toString() : "") + u.hash;
        history.replaceState(history.state, "", clean);
      }
      return token;
    } catch (e) { return null; }
  })();
  function maybeIdentifyPendingToken() {
    if (!consented || !pendingIdentityToken) return;
    var token = pendingIdentityToken;
    pendingIdentityToken = null;
    identify({ token: token });
  }

  // C2 cross-domain linker: hosted forms live on the app origin, where this
  // site's `_ldv` cookie is invisible. Decorate form links with the visitor id
  // before navigation reads the href: mousedown fires ahead of ANY navigation
  // intent (left/middle click, context-menu "open in new tab"), click covers
  // keyboard activation. Re-triggers just re-set the same param. Anonymous id
  // only — carries no PII.
  function decorateFormLink(e) {
    if (!consented || !APP_ORIGIN) return;
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    try {
      var u = new URL(a.href);
      if (u.origin !== APP_ORIGIN || u.pathname.indexOf("/f/") !== 0) return;
      var visitorId = ensureVisitorId();
      if (!visitorId) return;
      u.searchParams.set(COOKIE, visitorId);
      a.href = u.toString();
    } catch (err) {}
  }
  document.addEventListener("mousedown", decorateFormLink, true);
  document.addEventListener("click", decorateFormLink, true); // keyboard Enter

  // Auto pageview now (URL already token-stripped) + identify from the
  // pending click token, + pageviews on SPA navigations.
  pageview();
  maybeIdentifyPendingToken();
  var lastHref = location.href;
  function onNav() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      pageview();
    }
  }
  ["pushState", "replaceState"].forEach(function (fn) {
    var orig = history[fn];
    if (!orig) return;
    history[fn] = function () {
      var r = orig.apply(this, arguments);
      onNav();
      return r;
    };
  });
  window.addEventListener("popstate", onNav);

  // Final flush when the page goes away.
  window.addEventListener("pagehide", function () { flush(true); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush(true);
  });
})();
