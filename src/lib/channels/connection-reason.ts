import type { ChannelConnectionState } from "./live-connection"

/**
 * WHY a Meta channel is not delivering — one sentence per state, per locale, written once.
 *
 * Two elements of the SAME screen describe the same row: the OAuth return banner at the top of
 * `settings/channels/connect/[channel]` and the connection line inside `ChannelConfigForm` below it.
 * When each kept its own wording, they could (and did) disagree — a green "Channel connected" sat
 * directly above "Not delivering, Meta refused the subscription". Sharing the sentence makes that
 * particular contradiction impossible to reintroduce by editing one file: there is only one file.
 *
 * The wording is Meta-specific on purpose (it names the Page and the Meta subscription), and both
 * call sites are Meta-only surfaces. A non-Meta screen must not borrow these strings.
 *
 * `subscriptionPending` (a staged App Review row whose subscription was never requested) is the one state
 * whose whole vocabulary lives here — the sentence below plus its title and badge
 * (`metaSubscriptionPendingLabels`). It appears right after a staged connect on four surfaces at once (the
 * return banner, the form, the catalog card and the "other channels" list), and before it had words of its
 * own every one of them said "Meta refused the subscription" — which nobody had asked Meta for.
 */

export type ChannelReasonLocale = "en" | "ru" | "az"

/**
 * Every state except `live` — a live row needs no explanation, it needs a confirmation.
 *
 * `claimedElsewhere` is not in this table: its wording lives in `messages/*.json` under
 * `settings.channelClaimedElsewhere` (checked by scripts/check-translations.js), and all three screens read
 * that one key — so it keeps the same one-sentence-one-place property through next-intl instead.
 */
export type ChannelBrokenState = Exclude<ChannelConnectionState, "live" | "claimedElsewhere">

const META_CONNECTION_REASON: Record<ChannelReasonLocale, Record<ChannelBrokenState, string>> = {
  en: {
    draft: "Not connected. This channel is saved, but Meta has never returned a Page — nothing will arrive in Inbox until Connect with Meta finishes.",
    paused: "Not delivering. The Page and its token are stored, but this channel is switched off, and inbound messages only reach channels that are on. Switch it back on below and save.",
    needsReconnect: "Not delivering. Meta refused the message subscription for this Page — usually a missing messaging permission — so DMs never reach Inbox. Run Connect with Meta again and approve every permission it asks for.",
    subscriptionPending: "Delivery not confirmed. This channel is connected for App Review only: a staged connect deliberately does not request Meta's message subscription, so LeadDrive has never asked Meta to deliver this Page's DMs. Subscribe this Page explicitly before relying on it — for an Instagram account, subscribe its linked Facebook Page.",
  },
  ru: {
    draft: "Не подключено. Канал сохранён, но Meta ещё ни разу не вернула страницу — пока «Подключить через Meta» не завершено, в Inbox ничего не придёт.",
    paused: "Не доставляет. Страница и её токен сохранены, но канал выключен, а входящие приходят только во включённые каналы. Включите его ниже и сохраните.",
    needsReconnect: "Не доставляет. Meta отказала в подписке на сообщения этой страницы — обычно из-за не выданного разрешения на переписку — поэтому входящие не доходят до Inbox. Запустите «Подключить через Meta» ещё раз и подтвердите все запрошенные разрешения.",
    subscriptionPending: "Доставка не подтверждена. Канал подключён только для App Review: такое подключение намеренно не запрашивает у Meta подписку на сообщения, поэтому LeadDrive ни разу не просил Meta доставлять сюда сообщения этой страницы. Прежде чем на него полагаться, подпишите эту страницу явно — для аккаунта Instagram подпишите связанную с ним страницу Facebook.",
  },
  az: {
    draft: "Qoşulmayıb. Kanal saxlanılıb, amma Meta heç vaxt səhifə qaytarmayıb — «Meta ilə qoş» tamamlanmayana qədər Inbox-a heç nə gəlməyəcək.",
    paused: "Çatdırmır. Səhifə və onun tokeni saxlanılıb, amma bu kanal söndürülüb, gələn mesajlar isə yalnız yanılı kanallara gəlir. Aşağıda kanalı yenidən yandırın və saxlayın.",
    needsReconnect: "Çatdırmır. Meta bu səhifə üçün mesaj abunəliyini rədd edib — adətən yazışma icazəsi verilmədiyinə görə — ona görə DM-lər Inbox-a çatmır. «Meta ilə qoş» addımını yenidən işə salın və istənilən bütün icazələri təsdiqləyin.",
    subscriptionPending: "Çatdırılma təsdiqlənməyib. Kanal yalnız App Review üçün qoşulub: belə qoşulma Meta-dan mesaj abunəliyini qəsdən istəmir, ona görə LeadDrive bu səhifənin mesajlarını bura çatdırmağı Meta-dan heç vaxt istəməyib. Kanala etibar etməzdən əvvəl bu səhifənin mesaj abunəliyini ayrıca aktivləşdirin — Instagram hesabı üçün bunu ona bağlı Facebook səhifəsində edin.",
  },
}

/**
 * The short words for `subscriptionPending`: `title` heads the return banner and is the card's status line,
 * `badge` sits on the card and on the "other channels" row. Neither may read as a working connection —
 * every surface that prints them does so in its not-delivering (amber) style, never as "Connected".
 *
 * None of them says "not delivering" as a fact, and that is deliberate. What LeadDrive knows is that IT
 * never asked Meta for the subscription; it cannot see one made by hand outside the product. On 2026-09-21
 * the review Page's staged row still carried both markers while three real Messenger DMs landed in it —
 * the Page had been subscribed from Meta's side for the pages_messaging screencast. "No DM reaches Inbox"
 * would have been false on exactly the screen being recorded. So: what was not requested, and that
 * delivery is unconfirmed until the Page is subscribed through LeadDrive.
 */
const META_SUBSCRIPTION_PENDING_LABELS: Record<ChannelReasonLocale, { title: string; badge: string }> = {
  en: { title: "Connected for App Review — message subscription not requested yet", badge: "App Review only" },
  ru: { title: "Подключено для App Review — подписка на сообщения ещё не запрошена", badge: "Только для App Review" },
  az: { title: "App Review üçün qoşulub — mesaj abunəliyi hələ istənilməyib", badge: "Yalnız App Review üçün" },
}

/** The sentence for a non-live state. Unknown locales fall back to English, never to silence. */
export function metaConnectionReason(locale: string, state: ChannelBrokenState): string {
  const table = META_CONNECTION_REASON[locale as ChannelReasonLocale] || META_CONNECTION_REASON.en
  return table[state]
}

/** Title and badge for `subscriptionPending`, with the same English fallback as the sentence. */
export function metaSubscriptionPendingLabels(locale: string): { title: string; badge: string } {
  return META_SUBSCRIPTION_PENDING_LABELS[locale as ChannelReasonLocale] || META_SUBSCRIPTION_PENDING_LABELS.en
}
