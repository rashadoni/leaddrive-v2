# App Review: social monitoring permissions on the approved app

Fourth submission for Meta app **2414060595720618** ("CRM"). It asks for the three permissions that
let LeadDrive read what customers write on a business's own Facebook Page and Instagram account:

| Permission | What it is for here |
|---|---|
| `pages_read_engagement` | read the Page's own posts, so a comment can be shown with the post it belongs to |
| `pages_read_user_content` | read visitor comments and visitor posts on that Page — the mentions themselves |
| `instagram_manage_comments` | read comments on the business's Instagram media, and posts where it is @mentioned or tagged |

`business_management` is deliberately **not** in this submission. Nothing in this codebase calls the
Business Manager API (`src/lib/social/meta-granted-assets.ts` says so explicitly); production keeps
requesting it only so that Pages owned by a business portfolio appear in `/me/accounts`. Asking Meta
for a permission whose use cannot be demonstrated is how a submission gets rejected.

## Why this submission exists

Social monitoring still runs on the OLD app `1276226757359622`, in a different business portfolio,
while every messaging surface — WhatsApp, Messenger, Instagram Direct — already runs on the approved
app. One customer, one connection, one app is the goal (owner, 2026-10-27); this is the last piece.

## Recording the screencast

Facebook refuses a whole dialog that contains a permission the app has not enabled, so the
permissions had to be enabled in the app's use cases first (done 2026-11-11, including adding the
"Manage everything on your Page" use case — it is the only one that carries `pages_read_user_content`).

The consent screen must be the approved app's, asking for exactly these permissions. That is what
`?app=<channelConfigId>&stage=monitoring` on `/api/v1/social/oauth/facebook/start` produces: the
staged path pinned to a channel row holding the approved app's credentials, requesting the reading
set rather than the Messenger set, and ignoring any Facebook Login for Business configuration (a
configuration carries its own fixed permission list — the Messenger one — and filming the wrong
consent screen is what the first two submissions were rejected over).

Shot list, in Meta's order (policy 1.6 — the whole journey, no cuts):

1. Facebook signed out → the login screen → signing in (the owner types his own password).
2. The consent screen of app 2414060595720618, large enough to read every permission.
3. Choosing the Page and the Instagram account.
4. Back in LeadDrive: Social Monitoring showing the comments and mentions collected from them.
5. Opening one mention: the post it belongs to, the author, the time, and the reply.

## Usage descriptions

**pages_read_engagement** — A business connects its own Facebook Page to LeadDrive CRM with Facebook
Login. LeadDrive then reads the Page's own posts so that every comment it shows a user can be
displayed next to the post it was written under: the Social Monitoring screen lists a mention with
the post's text and time, and the user clicks through to the original. Without it the app can show a
comment but not what it is about, which is the whole context a support agent needs.

**pages_read_user_content** — The same connected Page: LeadDrive reads comments and posts written by
visitors on it, and visitor posts the Page is tagged in. These are the mentions the product exists
to collect. Each one becomes a row in Social Monitoring with the author, text, time and a link back
to Facebook, and the business can turn it into a support ticket or a lead inside the CRM. Nothing is
read from Pages the person has not connected.

**instagram_manage_comments** — The business's Instagram professional account, linked to the same
Page: LeadDrive reads comments on its media and the posts and stories where the account is
@mentioned or tagged, and shows them in the same Social Monitoring list as the Facebook ones, so one
screen holds everything said about the business. Replies are sent from that screen with the same
permission.
