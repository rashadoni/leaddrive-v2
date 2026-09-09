# Automatic WEB news + optional Google Alerts

## Primary collection path

- Every active monitoring scenario that includes `web` automatically receives
  a managed WEB source. Creating, editing, pausing, resuming, or deleting the
  scenario synchronizes that source in the same database transaction.
- Scheduled collection and the manual **Run** button use the same free
  `AZERBAIJAN_NEWS_DIRECT` route. No Apify, Bright Data, or other paid provider
  is part of this route.
- The route currently discovers candidates from:
  - Report.az publisher search;
  - Baku.ws publisher search;
  - APA.AZ RSS;
  - Banker.az RSS;
  - Qafqazinfo RSS;
  - Modern.az RSS.
- Feed entries are discovery hints, not accepted results. LeadDrive opens the
  publisher page and requires valid `NewsArticle`, `ReportageNewsArticle`, or
  `AnalysisNewsArticle` JSON-LD before ingestion.
- Scheduled runs use an incremental watermark and a default 48-hour window.
  An explicit full/manual run is capped at 90 days. A 2024 article cannot be
  admitted as a current result.
- Canonical publisher URLs deduplicate repeated scheduled runs and overlap
  between publisher feeds, publisher search, and Google Alerts.

## Optional Google Alerts transport

- Google Alerts email is acquisition transport only. It never creates a CRM
  ticket, Inbox conversation, or email log.
- The Social Monitoring feed shows the publisher, headline, article date,
  snippet, image, matched monitoring term, and original publisher URL.
- A result is accepted only when the publisher page:
  - is served over HTTPS;
  - belongs to an Azerbaijan `.az` host (or an explicit
    `GOOGLE_ALERTS_AZ_HOST_ALLOWLIST` entry);
  - declares `NewsArticle`, `ReportageNewsArticle`, or
    `AnalysisNewsArticle` JSON-LD;
  - has a valid publication date no older than 90 days;
  - directly contains a term from an active WEB monitoring scenario.
- Canonical publisher URLs provide cross-alert deduplication. Google tracking
  parameters and the email wrapper are not persisted as the visible URL.
- Legacy WEB rows that are not `ARTICLE` remain in audit storage but are hidden
  from the Social Monitoring feed.

## Security boundary

- Each tenant receives a signed
  `google-alerts+{organizationId}.{hmac}@{EMAIL_REPLY_DOMAIN}` address.
- The inbound route requires the existing Cloudflare worker secret.
- The message header sender must be `googlealerts-noreply@google.com` and the
  receiving authentication result must report `dkim=pass` for `google.com`.
- Article fetches reject credentials in URLs, private/reserved IP addresses,
  redirects outside approved Azerbaijan hosts, non-HTML responses, responses
  over 3 MB, and requests taking longer than 12 seconds.

## Optional Google Alerts setup

1. Deploy the application and `workers/email-inbound.js` together. The worker
   adds the original `From` and `Authentication-Results` headers required by
   the application gate.
2. Ensure Cloudflare Email Routing subaddressing is enabled for
   `EMAIL_REPLY_DOMAIN` and the catch-all route reaches the inbound worker.
3. In Social Monitoring settings, copy the protected Google Alerts intake
   address.
4. Use a dedicated Gmail account for Google Alerts and forward its alert
   messages to that address. Gmail sends a one-time forwarding confirmation;
   the Worker forwards only that authenticated Google setup message to the
   configured administrative `FALLBACK_INBOX`, where the owner clicks the
   confirmation link.
5. Send one real alert for a term in an active WEB scenario. Confirm it appears
   as a normal WEB news card and does not appear in CRM Inbox.

## Google account limitation

Google does not provide an official Google Alerts management API. This release
does not create, edit, or delete alerts inside the Google account. The settings
card shows the current scenario terms so an operator can keep optional alerts
aligned. This does not block automatic LeadDrive collection: scenario-managed
publisher search and feeds remain the primary path.
