/**
 * What the prospect agrees to before his own Facebook Page is connected to the
 * demo (docs/DEMO_CENTER.md, «Live social connections»). Pure on purpose: the
 * demo page shows these words and the server records their version, so both
 * read them from here and nothing else comes with them.
 *
 * Every sentence has to stay true of the code:
 *   - the Page is released at 23:59 in Baku at the latest, and earlier by
 *     «Ayır», «Bitir» or the end of the session (demoSocialReleaseReason);
 *   - only the one person who first wrote with the code is shown and answered
 *     (demo-social-inbound.ts); everyone else's events are dropped unstored;
 *   - we never revoke the person's Meta authorization (demo-social-release.ts):
 *     it stays with him until he removes LeadDrive in Business Integrations.
 */

export const DEMO_SOCIAL_CONSENT_TEXT =
  "Facebook səhifəmi bu demoya qoşuram: ən gec bu gün saat 23:59-a qədər (Bakı vaxtı), «Ayır» düyməsi və ya demonun bitməsi onu daha tez ayırır. " +
  "Demoda yalnız səhifəyə demo kodu ilə ilk yazan bir nəfərin mesajları göstərilir və onlara AI agent cavab verir; səhifəyə yazan başqa adamların mesajları saxlanmır və onlara cavab verilmir. " +
  "Facebook-da LeadDrive-a verdiyim icazə demodan sonra da məndə qalır — onu Meta-da «Business Integrations» bölməsindən silə bilərəm."

/** Recorded in SOCIAL_CONNECTED's metadata; bump it whenever the text above changes. */
export const DEMO_SOCIAL_CONSENT_VERSION = "2026-10-19"

/** Where a person removes LeadDrive from his Facebook account (Meta's own settings page). */
export const META_BUSINESS_INTEGRATIONS_URL = "https://www.facebook.com/settings?tab=business_tools"
