import { channelConnectionState, type ChannelConnectionInput } from "@/lib/channels/live-connection"
import { metaConnectionReason, metaSubscriptionPendingLabels } from "@/lib/channels/connection-reason"

/**
 * What the screen may claim after a Meta (Facebook / Instagram Login) round trip.
 *
 * The banner used to be decided by the URL alone (`?connected=…&pages=…&ig=…`), i.e. by what Meta said
 * happened, never by what LeadDrive actually stored. That is how a green "Channel connected" came to sit
 * above "Not delivering — Meta refused the subscription", and how it survived a missing channel row and a
 * switched-off one. So the verdict reads the row the callback NAMED (lib/social/oauth-return) through the
 * same predicate every other screen uses (lib/channels/live-connection) — and claims nothing it cannot see:
 *
 *   - Meta reported nothing for this channel type            → warning (no lookup can rescue that)
 *   - the channel list is not in hand yet, or failed to load → pending (no verdict either way)
 *   - rows of the type exist but none was named              → neutral (several Pages wired at once —
 *                                                              any one could be another customer's)
 *   - the named row delivers                                 → success
 *   - otherwise                                              → warning, in the words the form and the
 *                                                              catalog use for that row's state.
 *
 * Shared by the channel catalog (where the callback lands since 2026-10-03) and the connect page (still
 * reachable by URL), so the two cannot drift into describing one connection two ways.
 */
export type MetaOAuthBannerTone = "success" | "pending" | "neutral" | "warning"
export type MetaOAuthBannerLocale = "en" | "ru" | "az"

export const META_OAUTH_BANNER_COPY = {
  en: {
    oauthSuccessTitle: "Channel connected",
    oauthSuccessDesc: "Meta returned {pages} Facebook Page(s) and {ig} Instagram account(s). Send one message to the account to confirm it reaches Inbox.",
    oauthPartialTitle: "This channel is still not connected",
    oauthNoInstagramDesc: "Meta returned {pages} Facebook Page(s) and no Instagram account. Instagram Direct is delivered through the Facebook Page that an Instagram BUSINESS account is linked to, so until that link exists nothing can reach Inbox here. Link the Instagram business account to the Page in Meta Business settings, then run Connect with Meta again.",
    oauthNoPageDesc: "Meta finished the login but returned no Facebook Page for this channel, so no message can arrive yet. Run Connect with Meta again and tick the Page you want to use.",
    oauthNotDeliveringTitle: "Connected, but not delivering yet",
    oauthNoChannelRowDesc: "Meta finished the login, but this workspace still holds no channel for it, so there is nothing for an inbound message to arrive in. Run Connect with Meta again; if it keeps ending here, the callback could not save the channel.",
    oauthCheckingTitle: "Checking what actually got wired",
    oauthCheckingDesc: "Meta has reported back. LeadDrive is reading the saved channel before it calls anything connected.",
    oauthUnverifiedDesc: "Meta has reported back, but LeadDrive could not read this workspace's channels, so it cannot confirm that the connection works. Reload the page, and open the channel catalog if it fails again.",
    oauthUnidentifiedTitle: "Meta finished the connection",
    oauthUnidentifiedDesc: "Meta returned {pages} Facebook Page(s) and {ig} Instagram account(s). This page cannot tell which saved channel came from this connection, so it opens none of them — check each one in the channel list.",
  },
  ru: {
    oauthSuccessTitle: "Канал подключён",
    oauthSuccessDesc: "Meta вернула страниц Facebook: {pages}, аккаунтов Instagram: {ig}. Отправьте одно сообщение на аккаунт, чтобы убедиться, что оно доходит в Inbox.",
    oauthPartialTitle: "Этот канал всё ещё не подключён",
    oauthNoInstagramDesc: "Meta вернула страниц Facebook: {pages}, аккаунтов Instagram — ни одного. Instagram Direct доставляется через страницу Facebook, к которой привязан БИЗНЕС-аккаунт Instagram, поэтому пока такой привязки нет, сюда ничего не придёт. Привяжите бизнес-аккаунт Instagram к странице в настройках Meta Business и запустите «Подключить через Meta» ещё раз.",
    oauthNoPageDesc: "Meta завершила вход, но не вернула для этого канала ни одной страницы Facebook, поэтому сообщения приходить не будут. Запустите «Подключить через Meta» ещё раз и отметьте нужную страницу.",
    oauthNotDeliveringTitle: "Подключено, но пока не доставляет",
    oauthNoChannelRowDesc: "Meta завершила вход, но в этом рабочем пространстве до сих пор нет канала для него — входящему сообщению просто некуда прийти. Запустите «Подключить через Meta» ещё раз; если всё повторится, значит callback не смог сохранить канал.",
    oauthCheckingTitle: "Проверяем, что подключилось на самом деле",
    oauthCheckingDesc: "Meta ответила. LeadDrive читает сохранённый канал, прежде чем называть что-либо подключённым.",
    oauthUnverifiedDesc: "Meta ответила, но LeadDrive не смог прочитать каналы этого рабочего пространства и не может подтвердить, что подключение работает. Обновите страницу, а если снова не выйдет — откройте каталог каналов.",
    oauthUnidentifiedTitle: "Meta завершила подключение",
    oauthUnidentifiedDesc: "Meta вернула страниц Facebook: {pages}, аккаунтов Instagram: {ig}. Эта страница не может определить, какой сохранённый канал относится к этому подключению, поэтому не открывает ни один — проверьте каждый в списке каналов.",
  },
  az: {
    oauthSuccessTitle: "Kanal qoşuldu",
    oauthSuccessDesc: "Meta {pages} Facebook səhifəsi və {ig} Instagram hesabı qaytardı. Inbox-a çatdığını yoxlamaq üçün hesaba bir mesaj göndərin.",
    oauthPartialTitle: "Bu kanal hələ də qoşulmayıb",
    oauthNoInstagramDesc: "Meta {pages} Facebook səhifəsi qaytardı, Instagram hesabı isə qaytarmadı. Instagram Direct mesajları Instagram BİZNES hesabı bağlanmış Facebook səhifəsi vasitəsilə çatdırılır, ona görə həmin bağlantı olmayana qədər bura heç nə gələ bilməz. Meta Business tənzimləmələrində Instagram biznes hesabını səhifəyə bağlayın və «Meta ilə qoş» addımını yenidən işə salın.",
    oauthNoPageDesc: "Meta girişi tamamladı, amma bu kanal üçün heç bir Facebook səhifəsi qaytarmadı, ona görə mesaj gələ bilməz. «Meta ilə qoş» addımını yenidən işə salın və istifadə edəcəyiniz səhifəni seçin.",
    oauthNotDeliveringTitle: "Qoşulub, amma hələ çatdırmır",
    oauthNoChannelRowDesc: "Meta girişi tamamladı, amma bu iş sahəsində hələ də bunun üçün kanal yoxdur — gələn mesajın düşəcəyi yer yoxdur. «Meta ilə qoş» addımını yenidən işə salın; təkrarlanarsa, deməli callback kanalı saxlaya bilməyib.",
    oauthCheckingTitle: "Əslində nəyin qoşulduğunu yoxlayırıq",
    oauthCheckingDesc: "Meta cavab verdi. LeadDrive nəyisə qoşulmuş adlandırmazdan əvvəl saxlanılmış kanalı oxuyur.",
    oauthUnverifiedDesc: "Meta cavab verdi, amma LeadDrive bu iş sahəsinin kanallarını oxuya bilmədi və qoşulmanın işlədiyini təsdiqləyə bilmir. Səhifəni yeniləyin, yenə alınmasa kanal kataloqunu açın.",
    oauthUnidentifiedTitle: "Meta qoşulmanı tamamladı",
    oauthUnidentifiedDesc: "Meta {pages} Facebook səhifəsi və {ig} Instagram hesabı qaytardı. Bu səhifə hansı saxlanılmış kanalın bu qoşulmaya aid olduğunu müəyyən edə bilmir, ona görə heç birini açmır — hər birini kanallar siyahısında yoxlayın.",
  },
} as const

/** `?pages=` / `?ig=` as a count: anything that is not a positive integer counts as none. */
export function positiveCountParam(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export type MetaOAuthBannerInput = {
  locale: MetaOAuthBannerLocale
  /** The channel type the return is about (the card it was started from). */
  channelType: "facebook" | "instagram"
  pages: string | null
  ig: string | null
  /** The row the callback named, already checked against this session's list and `channelType`; or null. */
  row: ChannelConnectionInput | null
  /** True while the channel list is not in hand (no session org yet, still loading, or it failed). */
  listUnknown: boolean
  /** True when the channel list failed to load (not merely still loading). */
  listFailed: boolean
  /** True when the workspace holds rows of `channelType` although none was named. */
  rowsOfTypeExist: boolean
  /** The next-intl `settings.channelClaimedElsewhere.*` copy — the one state whose words live there. */
  claimedElsewhere: { title: string; reason: string }
}

export function metaOAuthReturnBanner(input: MetaOAuthBannerInput): { tone: MetaOAuthBannerTone; title: string; desc: string } {
  const c = META_OAUTH_BANNER_COPY[input.locale]
  const pageCount = positiveCountParam(input.pages)
  const igCount = positiveCountParam(input.ig)
  const wiredForThisChannel = input.channelType === "instagram" ? igCount > 0 : pageCount > 0
  const rowState = input.row ? channelConnectionState(input.row) : null
  const rowUnknown = !input.row && input.listUnknown
  const rowUnidentified = !input.row && !rowUnknown && input.rowsOfTypeExist
  const counts = (text: string) => text.replace("{pages}", String(pageCount)).replace("{ig}", String(igCount))

  const tone: MetaOAuthBannerTone =
    !wiredForThisChannel ? "warning"
      : rowUnknown ? "pending"
        : rowUnidentified ? "neutral"
          : rowState === "live" ? "success"
            : "warning"

  const title =
    tone === "pending" ? c.oauthCheckingTitle
      : tone === "neutral" ? c.oauthUnidentifiedTitle
        : tone === "success" ? c.oauthSuccessTitle
          // A stored, wired Page that is switched off or unsubscribed IS connected — it just does not
          // deliver. Calling that "still not connected" would send the user back through an OAuth that has
          // nothing left to fix.
          : wiredForThisChannel && rowState === "claimedElsewhere" ? input.claimedElsewhere.title
            // A staged (App Review) connect that did exactly what it is built to do: store the Page and ask
            // Meta for nothing.
            : wiredForThisChannel && rowState === "subscriptionPending" ? metaSubscriptionPendingLabels(input.locale).title
              : wiredForThisChannel && (rowState === "paused" || rowState === "needsReconnect") ? c.oauthNotDeliveringTitle
                : c.oauthPartialTitle

  const desc =
    tone === "pending" ? (input.listFailed ? c.oauthUnverifiedDesc : c.oauthCheckingDesc)
      : tone === "neutral" ? counts(c.oauthUnidentifiedDesc)
        : tone === "success" ? counts(c.oauthSuccessDesc)
          : !wiredForThisChannel
            ? (input.channelType === "instagram" ? counts(c.oauthNoInstagramDesc) : c.oauthNoPageDesc)
            // Word-for-word the sentence the form prints for this state, so the two cannot drift. The tenant
            // learns that another workspace won the routing, never which one.
            : rowState === "claimedElsewhere" ? input.claimedElsewhere.reason
              : rowState && rowState !== "live" ? metaConnectionReason(input.locale, rowState)
                : c.oauthNoChannelRowDesc

  return { tone, title, desc }
}
