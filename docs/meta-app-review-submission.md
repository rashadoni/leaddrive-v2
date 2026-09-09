# Meta App Review submission — LeadDrive CRM

App ID: **1276226757359622**
Reviewer-facing name: **LeadDrive CRM**
Business Verification: pending

---

## Permissions to request

| Permission | Used for | Justification |
|---|---|---|
| `pages_show_list` | Auto-granted | List Pages a connecting tenant admins so they can pick which to monitor |
| `pages_read_engagement` | Auto-granted | Read post + comment metadata on the tenant's own Pages for the unified inbox |
| `pages_read_user_content` | **Review needed** | Pull user comments and tagged posts so a CRM operator can reply, escalate to a ticket, or convert into a lead |
| `business_management` | Auto-granted | Resolve which Business Portfolio a Page belongs to during OAuth |
| `instagram_basic` | Auto-granted | Identify the Instagram Business account linked to each connected Page |
| `instagram_manage_comments` | **Review needed** | Read comments on tenant's Instagram media + replies so the same inbox covers IG, and let operators reply directly |
| `pages_messaging` | **Review needed** | FB Page Messenger DMs in the unified inbox — see **Messaging extension** below |
| `instagram_manage_messages` | **Review needed** | Instagram Direct DMs in the unified inbox — see **Messaging extension** below |

**Inbox-DM extension** (`pages_messaging` + `instagram_manage_messages`) is now **ACTIVE and needs its
own Advanced Access** — see the **Messaging extension** section below. (Without it: FB subscribe fails
`(#200) pages_messaging`; IG fails `(#3) capability`.)

---

## Use case description (paste into App Review form)

LeadDrive CRM is a SaaS CRM for B2B service companies. Our customers (tenants)
connect their own Facebook Pages and linked Instagram Business accounts so they
can manage social interactions in one inbox alongside email, web chat, and
support tickets.

After a tenant signs in with Facebook through our app, they pick which Pages
they admin. We then:

1. Periodically poll comments on each connected Page's recent posts and pull
   posts/media that tag the Page or the linked Instagram account.
2. Show every comment + tagged post in the tenant's Social Monitoring inbox.
3. Run AI sentiment classification (positive / neutral / negative) so the
   operator can prioritize negative reactions.
4. Let the operator (a) reply to a comment from the inbox, (b) one-click
   convert it into a CRM Lead, Ticket, or Task, or (c) ignore it.
5. When negative comments spike, send a push notification to admins.

We do **not** scrape pages the tenant doesn't admin, do **not** post on the
tenant's behalf without explicit operator action, and do **not** use the data
for advertising lookalikes.

---

## How permissions are exercised (for the screencast)

Recording must be 60-120 seconds, no audio required. Show:

1. **Tenant onboarding** (~10s)
   - `https://app.leaddrivecrm.org/social-monitoring`
   - Empty checklist visible. Click *Connect Facebook Page*.
2. **OAuth flow** (~15s)
   - Facebook prompt appears. Tester approves the listed permissions.
   - Browser returns to `/social-monitoring?connected=facebook&pages=N&ig=M`.
3. **Polling fetches comments** (~15s)
   - Click *Refresh all*. Inbox populates with comments and tagged posts.
4. **Reply** (~15s) — exercises `pages_read_user_content` /
   `instagram_manage_comments`
   - Open a comment, click *Reply*, type a short reply, hit *Send reply*.
   - Mention status flips to *replied*.
5. **Convert to Lead** (~10s)
   - Click *→ Lead*. Confirmation. Click the *Lead ↗* link to show the new
     Lead in `/leads/<id>`.
6. **Sentiment + spike** (~10s) — optional bonus
   - Show the Analytics panel with the negative-mention chart.

Tester account:
- Use the developer's own Facebook (already added in App Roles → Testers)
- Or any Facebook user added under App Roles → Testers before submission

---

## Messaging extension — `pages_messaging` + `instagram_manage_messages`

> The **inbox DM** capability (FB Messenger + IG Direct in the unified inbox), separate from the
> comment/mention monitoring above — it needs its OWN Advanced Access. **Verify exact permission names +
> dashboard paths in App Review; Meta renames them** (Facebook-Login path = `instagram_manage_messages`;
> the newer Instagram-Login API = `instagram_business_manage_messages`).

| Permission | Status | Justification |
|---|---|---|
| `pages_messaging` | **Review needed** | Receive + send Facebook Page Messenger DMs in the tenant's inbox; subscribe the Page to the `messages` webhook |
| `instagram_manage_messages` | **Review needed** | Receive + send Instagram Direct messages for the tenant's linked IG Business account in the same inbox |

### The capability must be ENABLED before it works at all
`(#3) Application does not have the capability` — seen even for the app admin's OWN IG in Dev mode —
means the IG-messaging capability isn't added to the app yet, **not** merely "not approved". Add the
Instagram messaging use case (runbook **A2**) FIRST. Then: Dev mode works for app roles (testers/admins)
on their own linked accounts; **real client accounts need Advanced Access (this review).**
`pages_messaging` behaves the same — works for testers in Dev, needs Advanced Access for clients (that's
why a non-tester client's FB subscribe returns `(#200)` until App Review lands).

### Use case description (paste into each messaging permission's request form)
In addition to comment monitoring, LeadDrive lets a tenant manage their Facebook Page Messenger and
Instagram Direct conversations in the same unified inbox. After a tenant connects their Page (and the
linked Instagram Business account), we: (1) subscribe the Page to the `messages` webhook so new direct
messages arrive in real time; (2) optionally import existing conversation history via the Conversations
API; (3) display every DM thread in the operator's inbox; (4) let the operator reply directly from the
inbox. We only access direct messages for Pages / IG accounts the tenant admins, and never send a
message without an explicit operator action.

### Screencast for the messaging permissions (60-120s, no audio)
1. **Connect** (~15s) — `app.leaddrivecrm.org/social-monitoring` → *Connect Facebook Page* → approve
   `pages_messaging` + `instagram_manage_messages` in the OAuth dialog → return to `?connected=facebook`.
2. **Receive a DM** (~20s) — from a SECOND account, send a Messenger DM to the connected Page (and an IG
   Direct to the linked IG). Open `/inbox` → the thread appears under channel *Facebook* / *Instagram*.
3. **Reply** (~15s) — open the thread, type a reply, *Send* → show it delivered on the sender's side.
4. **Import history** (~10s, optional) — *Import conversations* → existing threads populate the inbox.

> Tester setup: developer's own FB/IG under App Roles → Testers, with the Page linked to a **Professional**
> (Business/Creator) IG account — IG messaging review is rejected if the IG isn't Professional + linked.

---

## Required fields elsewhere in App Settings

- **Privacy Policy URL** → `https://leaddrivecrm.org/legal/privacy`
- **Terms of Service URL** → `https://leaddrivecrm.org/legal/terms`
- **Data Deletion Instructions URL** → `https://leaddrivecrm.org/legal/data-deletion`
- **App Icon** → 1024×1024 LeadDrive logo PNG
- **App Category** → Business and Pages
- **Business Use** → Yes (managing tenant social accounts as a B2B SaaS)

---

## Pre-submission checklist

- [ ] Business Portfolio verified (legal docs uploaded in Meta Business Suite)
- [ ] Domain `leaddrivecrm.org` verified in Business Settings → Brand Safety
- [ ] Privacy + Terms + Data Deletion pages live and reachable
- [ ] App Icon uploaded
- [ ] Tester(s) added under App Roles → Testers
- [ ] Screencast recorded for each requested permission and uploaded
- [ ] Use case text pasted into each permission's request form
- [ ] **(Messaging)** Instagram messaging use case added to the app first (else `(#3)` even for testers)
- [ ] **(Messaging)** IG account is Professional (Business/Creator) + linked to the Page
- [ ] **(Messaging)** Screencast shows a real DM arriving in `/inbox` + an operator reply delivered

---

## Reviewer notes — anti-rejection tips

- Keep the screencast under 2 minutes; reviewers skip long ones.
- Show one explicit operator action per permission (reply = read+manage_comments).
- Don't show the developer dashboard — only `app.leaddrivecrm.org` end-user UI.
- If asked about user data flow: data stays per-tenant (`organizationId` filter
  on every query); tokens are AES-256-GCM encrypted at rest.
- Spelling: keep "Facebook Page" capitalized; reviewers reject sloppy copy.
