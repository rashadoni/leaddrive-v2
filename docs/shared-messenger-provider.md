# Approved shared Messenger app

The Channels → Facebook connect may use a dedicated approved shared Messenger
provider. This is separate from the legacy `FACEBOOK_*` app used by Social
Monitoring and its existing webhook. Tenant-owned and explicitly pinned app
configurations retain precedence.

Configure all four canonical server environment values together:

- `FACEBOOK_MESSENGER_APP_ID`
- `FACEBOOK_MESSENGER_APP_SECRET`
- `FACEBOOK_MESSENGER_LOGIN_CONFIG_ID`
- `FACEBOOK_MESSENGER_VERIFY_TOKEN`

The login configuration must belong to that app and grant `pages_show_list`,
`pages_messaging`, and `pages_manage_metadata`. The existing
`FACEBOOK_REDIRECT_URI` must be registered on it. A partial provider configuration
fails closed; it never silently sends the customer through the legacy app.

Register the approved app's Page webhook at:
`https://app.leaddrivecrm.org/api/v1/webhooks/facebook?provider=messenger`
with the provider verify token and the existing `messages` and
`messaging_postbacks` subscriptions. Do not add `t`: this provider serves multiple
organizations and the existing Page ownership routing identifies the recipient.
The shared signature cannot be combined with a tenant override. The old
no-query webhook and tenant-owned `?t=` callbacks keep their original secrets.

The signed OAuth state binds the shared app identity. Its callback subscribes
live inbox channels, requests no linked Instagram fields, and leaves Social
Monitoring accounts and tokens untouched. Instagram Login keeps its own flow.

Operational rollout: validate the approved app/configuration, prepare the new
values in the root-owned 0600 canonical env without printing them, deploy the
reviewed main SHA through the normal pipeline, verify the new webhook handshake,
then update the app webhook and check the returned confirmation. Existing
`FACEBOOK_*` and `INSTAGRAM_*` values are not replaced. Read the admin preflight
and inspect the actual Meta consent screen before calling customer OAuth tested.
Do not grant access or send test messages without the account owner's authority.
