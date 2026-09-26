# Meta App Review submission — LeadDrive CRM

App ID: **2414060595720618**
Reviewer-facing name: **LeadDrive CRM**
Operator: **"FANUM" MMC (VÖEN 1704197981)**

This document reflects the implementation audited on 2026-09-20. Do not paste
permissions from one login surface into the review for another.

## Public URLs

Use these canonical public URLs. They redirect to the matching English CRM
document and work without authentication:

- Privacy Policy: 'https://www.leaddrivecrm.org/legal/privacy'
- Terms of Service: 'https://www.leaddrivecrm.org/legal/terms'
- Data Deletion: 'https://www.leaddrivecrm.org/legal/data-deletion'

## Permission matrix

### Facebook Login

The Facebook connect action calls '/api/v1/social/oauth/facebook/start'.

| Permission | Implemented use |
|---|---|
| 'public_profile' | Identify the connecting Meta user during OAuth. |
| 'pages_show_list' | List Pages administered by the connecting tenant user. |
| 'pages_read_engagement' | Read Page post and engagement metadata. |
| 'pages_read_user_content' | Read visitor posts and comments shown in Social Monitoring. |
| 'business_management' | Resolve the tenant's Business/Page assets. |
| 'pages_manage_metadata' | Subscribe the selected Page to supported webhooks. |
| 'pages_messaging' | Receive and reply to Messenger conversations in the CRM inbox. |
| 'instagram_basic' | Resolve an Instagram professional account linked to a selected Page. |
| 'instagram_manage_comments' | Read and reply to comments for the linked Instagram account. |
| 'instagram_manage_messages' | Legacy Facebook-Login path for linked-account Instagram messaging. Request only if this path remains in the submitted use case. |

### Instagram Login

The Instagram catalog action calls
'/api/v1/social/oauth/instagram/start', authorizes at 'api.instagram.com', and
requests exactly:

| Permission | Implemented use |
|---|---|
| 'instagram_business_basic' | Identify the tenant's Instagram professional account. |
| 'instagram_business_manage_messages' | Receive and send Instagram Direct messages in the CRM inbox. |

This is the flow that must be recorded for a review request containing
'instagram_business_*'. A Facebook consent screen is not evidence for those
permissions.

### WhatsApp Business Platform

Current status: **not ready for shared-app onboarding**.

The current UI asks each tenant to enter an access token, Phone Number ID,
WhatsApp Business Account ID, verify token and app secret. The repository has
webhook receive/send support, but no Meta Embedded Signup or WhatsApp OAuth
flow through App ID '2414060595720618'. Therefore:

- do not claim that another tenant can connect WhatsApp through this app yet;
- do not submit a recording of manual token entry as OAuth/Embedded Signup;
- implement and test Embedded Signup before requesting the corresponding
  WhatsApp advanced access/use case.

## Reviewer use-case text

LeadDrive CRM is a multi-tenant SaaS CRM. A customer administrator connects
only Facebook Pages and Instagram professional accounts that they are
authorised to manage. LeadDrive receives supported comments and direct
messages, displays them in that tenant's inbox, and lets an authorised CRM
operator send a reply. The data is isolated by organisation. LeadDrive does
not sell Meta data, create advertising audiences from it, or send a message
without an operator action or tenant-configured automation.

LeadDrive may classify sentiment or draft a response with configured AI
providers. Those transfers and the applicable retention/deletion behaviour are
disclosed in the public Privacy Policy.

## Permission evidence to record

Record separate, short clips when Meta presents separate permission review
fields:

1. Start from 'Settings → Channels' in the 'leaddrive' tenant at
   'https://app.leaddrivecrm.org'.
2. Click the provider card and show the matching Meta/Instagram consent
   surface.
3. Return to LeadDrive and show the connected asset.
4. From a second test account, send a direct message to the connected asset.
5. Open the new conversation in LeadDrive Inbox.
6. Send a clearly test-labelled reply from LeadDrive.
7. Show the reply on the sender side.
8. Convert the conversation into a lead, assign the synthetic sales user, and
   show the resulting linked lead.

For comment permissions, use a separate test post/comment and show the comment
appearing in Social Monitoring followed by an operator reply. Do not use a
comment demonstration as evidence for a messaging permission.

## Reviewer test account

LeadDrive uses dynamic tenant hosts of the form
'https://{tenant-slug}.leaddrivecrm.org'. Current examples include
'zeytun.leaddrivecrm.org', 'fanumsec.leaddrivecrm.org' and
'brandprotection.leaddrivecrm.org'; 'app.leaddrivecrm.org' is the shared app
entry point and is not a tenant slug. New customer subdomains are provisioned
without adding a hostname allowlist to the application.

Use the existing internal 'leaddrive' tenant-poligon through
'https://app.leaddrivecrm.org' with the dedicated
'meta-review@leaddrivecrm.org' reviewer user. Before recording, verify that every visible
conversation and account is a test fixture and that no customer data appears.
Store the credentials only in the approved password manager and paste
them into Meta's reviewer-instructions field. The Meta test user must have
access to test-only Pages/professional accounts and be assigned the necessary
App Role while the app is in development mode.

The deterministic setup and recording checklist are in
'docs/meta-app-review-demo-runbook.md'.

## Pre-submission gate

- [ ] Business verification completed for "FANUM" MMC.
- [ ] Domain ownership verified for 'leaddrivecrm.org'.
- [ ] App ID in every screenshot and configuration is '2414060595720618'.
- [ ] All three legal URLs return HTTP 200 without authentication.
- [ ] Instagram card opens Instagram Login and the consent request contains
      'instagram_business_basic' and 'instagram_business_manage_messages'.
- [ ] Facebook review requests contain only permissions exercised in the
      submitted Facebook recording.
- [ ] The 'leaddrive' reviewer workspace and Meta test assets show only
      synthetic review data; no customer records are visible.
- [ ] Inbound message and outbound reply are visible in each messaging clip.
- [ ] The same synthetic conversation is converted to a lead and the linked
      lead is visible.
- [ ] WhatsApp Embedded Signup is implemented before claiming shared-app
      WhatsApp onboarding.

## Accuracy notes

- OAuth tokens in 'SocialAccount.accessToken' are AES-256-GCM encrypted.
  Some channel credential fields are access-restricted and masked but are not
  all application-field-encrypted; do not tell reviewers that every token is
  encrypted at the application layer.
- Disconnecting a Meta channel stops it and clears locally stored channel
  credentials. Existing CRM conversation history is handled under the
  published retention/deletion policy. The tenant should also remove
  LeadDrive from Meta Business Integrations to revoke provider-side access.
