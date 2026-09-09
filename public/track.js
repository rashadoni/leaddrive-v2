/*!
 * LeadDrive first-party web-tracking pixel (C5 Account Engagement, Phase 4).
 *
 * Embed on your marketing site:
 *   <script>window.__ldTrack = { orgId: "<YOUR_ORG_ID>" };</script>
 *   <script src="https://app.leaddrivecrm.org/track.js" async></script>
 *
 * Set window.__ldTrack.email to the visitor's email when known (e.g. injected
 * from a tracked email-campaign link or a logged-in session). Anonymous views
 * are accepted but only attributed to an account once the visitor is identified.
 * Optional: window.__ldTrack.endpoint to point at a custom tenant domain.
 *
 * Dependency-free, fire-and-forget, never throws into the host page.
 */
(function () {
  try {
    var cfg = window.__ldTrack || {};
    if (!cfg.orgId) return;

    var origin = cfg.endpoint;
    if (!origin) {
      try {
        var s = document.currentScript;
        origin = s && s.src ? new URL(s.src).origin : window.location.origin;
      } catch (e) {
        origin = window.location.origin;
      }
    }
    var endpoint = origin.replace(/\/$/, "") + "/api/v1/public/track";

    var payload = {
      orgId: cfg.orgId,
      url: window.location.href,
      event: "page_view"
    };
    if (document.referrer) payload.referrer = document.referrer;
    if (cfg.email) payload.visitorEmail = cfg.email;

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "omit",
      mode: "cors"
    }).catch(function () {});
  } catch (e) {
    /* never break the host page */
  }
})();
