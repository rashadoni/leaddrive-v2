# Meta App Review demo runbook

Use test data only. This runbook prepares the reviewer account and a silent
screen recording; it does not authorise a production deploy or invent access
to Meta assets.

## Required assets

- LeadDrive tenant: existing 'leaddrive' tenant at
  'https://app.leaddrivecrm.org'
- LeadDrive reviewer user: 'meta-review@leaddrivecrm.org'; its password is
  generated server-side and retrieved from the root-only credential store
- Facebook test Page: 'LeadDrive Review Page'
- Instagram professional test account: 'leaddrive_review_test'
- A second Meta/Instagram test user that can send inbound messages
- App ID: '2414060595720618'
- Separate Instagram Login App ID: obtain it from the Instagram API setup in
  Meta and save it only in the new Instagram configuration row. Do not assume
  that it equals the Facebook App ID.

Do not use 'zeytun', 'fanumsec' or 'brandprotection' for this recording. The
'leaddrive' organization is the internal tenant-poligon for this purpose, not
a customer workspace. Use its dedicated reviewer user and verify before each
take that no real customer record is visible. Never commit
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
5. In **Settings → Channels**, choose **New connection**. Create new Facebook
   and Instagram configuration rows; do not edit or disconnect the existing
   live rows. Save the Facebook app ID '2414060595720618' in the Facebook row
   and the separate Instagram Login App ID in the Instagram row. Enter secrets
   only in the masked production form.
6. Confirm the new app uses these exact public endpoints:

   - Facebook OAuth callback:
     'https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback'
   - Instagram Login callback:
     'https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback'
   - Facebook Messenger webhook:
     'https://app.leaddrivecrm.org/api/v1/webhooks/facebook?t=leaddrive'
   - Instagram Login webhook:
     'https://app.leaddrivecrm.org/api/v1/webhooks/instagram?t=leaddrive'

7. Confirm a synthetic user with the CRM `sales` role is available as the lead
   assignee. The conversion endpoint deliberately rejects non-sales assignees.
8. Clear old test conversations so the new inbound event is unambiguous.
9. Disable desktop notifications and hide browser bookmarks/password-manager
   popovers before recording.

## 90-second Instagram recording

1. Sign in at 'https://app.leaddrivecrm.org' as the dedicated reviewer user.
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
9. Return to that conversation, choose **Create lead**, assign the synthetic
   sales user, and save.
10. Open the created lead and show that its contact/conversation are linked.

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
- created synthetic lead ID and its assigned synthetic sales user;
- confirmation that the data was synthetic.

## Current blocker

WhatsApp cannot use this scenario yet because the application has no Embedded
Signup/shared-app OAuth implementation. Manual WABA credential entry is not a
substitute for that recording.

The recording is also blocked until the separate Meta-settings session saves
the new Facebook and Instagram Login application credentials and supplies the
test-only Page, Instagram professional account, and sender user. Do not record
the historical accounts already present in the `leaddrive` tenant.
