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
 */

export type ChannelReasonLocale = "en" | "ru" | "az"

/** Every state except `live` — a live row needs no explanation, it needs a confirmation. */
export type ChannelBrokenState = Exclude<ChannelConnectionState, "live">

const META_CONNECTION_REASON: Record<ChannelReasonLocale, Record<ChannelBrokenState, string>> = {
  en: {
    draft: "Not connected. This channel is saved, but Meta has never returned a Page — nothing will arrive in Inbox until Connect with Meta finishes.",
    paused: "Not delivering. The Page and its token are stored, but this channel is switched off, and inbound messages only reach channels that are on. Switch it back on below and save.",
    needsReconnect: "Not delivering. Meta refused the message subscription for this Page — usually a missing messaging permission — so DMs never reach Inbox. Run Connect with Meta again and approve every permission it asks for.",
  },
  ru: {
    draft: "Не подключено. Канал сохранён, но Meta ещё ни разу не вернула страницу — пока «Подключить через Meta» не завершено, в Inbox ничего не придёт.",
    paused: "Не доставляет. Страница и её токен сохранены, но канал выключен, а входящие приходят только во включённые каналы. Включите его ниже и сохраните.",
    needsReconnect: "Не доставляет. Meta отказала в подписке на сообщения этой страницы — обычно из-за не выданного разрешения на переписку — поэтому входящие не доходят до Inbox. Запустите «Подключить через Meta» ещё раз и подтвердите все запрошенные разрешения.",
  },
  az: {
    draft: "Qoşulmayıb. Kanal saxlanılıb, amma Meta heç vaxt səhifə qaytarmayıb — «Meta ilə qoş» tamamlanmayana qədər Inbox-a heç nə gəlməyəcək.",
    paused: "Çatdırmır. Səhifə və onun tokeni saxlanılıb, amma bu kanal söndürülüb, gələn mesajlar isə yalnız yanılı kanallara gəlir. Aşağıda kanalı yenidən yandırın və saxlayın.",
    needsReconnect: "Çatdırmır. Meta bu səhifə üçün mesaj abunəliyini rədd edib — adətən yazışma icazəsi verilmədiyinə görə — ona görə DM-lər Inbox-a çatmır. «Meta ilə qoş» addımını yenidən işə salın və istənilən bütün icazələri təsdiqləyin.",
  },
}

/** The sentence for a non-live state. Unknown locales fall back to English, never to silence. */
export function metaConnectionReason(locale: string, state: ChannelBrokenState): string {
  const table = META_CONNECTION_REASON[locale as ChannelReasonLocale] || META_CONNECTION_REASON.en
  return table[state]
}
