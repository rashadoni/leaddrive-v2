# Meta App Review demo runbook

Use test data only. This runbook prepares the reviewer account and a silent
screen recording; it does not authorise a production deploy or invent access
to Meta assets.

## Required assets

- LeadDrive tenant: 'Meta Review Demo' at
  'https://metareview.leaddrivecrm.org'
- LeadDrive reviewer user: a dedicated email stored in the password manager
- Facebook test Page: 'LeadDrive Review Page'
- Instagram professional test account: 'leaddrive_review_test'
- A second Meta/Instagram test user that can send inbound messages
- App ID: '2414060595720618'

Do not use 'zeytun', 'fanumsec' or 'brandprotection' for this recording: they
are current tenant namespaces, not disposable Meta fixtures. Never commit
passwords, access tokens, app secrets, phone numbers belonging to
real people, or the final reviewer credentials.

## Seed data

Keep the CRM tenant otherwise empty. Optional synthetic records may use:

- Contact: 'Meta Review Sender'
- Company: 'Example Review Company'
- Message: 'TEST — Meta App Review inbound message'
- Reply: 'TEST — reply sent from LeadDrive CRM'

The inbound message used in the recording must actually arrive through the
provider webhook. A database fixture is useful for UI rehearsal but is not
valid evidence for Meta.

## Preflight

1. Confirm the legal URLs return 200 in a logged-out browser.
2. Confirm the reviewer credentials work in a private browser window.
3. Confirm the test user has the required app role while the app is in
   development mode.
4. Confirm the Page/Instagram account is test-only and has messaging enabled.
5. Clear old test conversations so the new inbound event is unambiguous.
6. Disable desktop notifications and hide browser bookmarks/password-manager
   popovers before recording.

## 90-second Instagram recording

1. Sign in at 'https://metareview.leaddrivecrm.org'.
2. Open 'Settings → Channels'; click **Instagram**.
3. Complete Instagram Login and approve the requested
   'instagram_business_basic' and
   'instagram_business_manage_messages' permissions.
4. Return to the channel catalog and show the connected account.
5. From the second test account, send
   'TEST — Meta App Review inbound message'.
6. Open LeadDrive Inbox and show that exact new conversation.
7. Reply 'TEST — reply sent from LeadDrive CRM'.
8. Show the delivered reply in the sender account.

Record Facebook separately using its Facebook Login card and Messenger test
Page. Record comment permissions separately in Social Monitoring.

## Recording rules

- 1920×1080 or 1440×900, browser zoom 100%.
- Silent recording is acceptable; do not generate local synthetic narration.
- Keep each permission clip under two minutes.
- Do not show DevTools, environment variables, access tokens, production
  customer names, or unrelated inbox threads.
- Start on the LeadDrive screen and keep the full URL visible when returning
  from consent.

## Completion evidence

Save the unedited master outside Git and record in the session log:

- file name and SHA-256;
- date/time and app mode;
- provider/test asset names;
- permissions visibly exercised;
- confirmation that the data was synthetic.

## Current blocker

WhatsApp cannot use this scenario yet because the application has no Embedded
Signup/shared-app OAuth implementation. Manual WABA credential entry is not a
substitute for that recording.
