import { describe, expect, it } from "vitest"
import { isCondolencePost } from "@/lib/social/condolence-post-signal"

/**
 * Тексты ниже — настоящие родительские публикации с прода (2026-08-03), те самые
 * тринадцать, что раздавали релевантность своим комментариям. Гейт обязан
 * поймать ровно одну — пост-дань памяти, из-за которого в находки попали 275
 * соболезнований, — и не тронуть ни одну из настоящих жалоб.
 */
const CONDOLENCE_PARENT =
  "Allah bütün şəhidlərimizə rəhmət eləsin @Əlimyandı Əmlak✔️ @Lüks Mənzil "
  + "#şəhid #arazmarket #şəhidimiz #arazsupermarket #xeber"

const COMPLAINT_PARENTS: Array<[label: string, text: string]> = [
  ["iPhone donma problemi", "Sosial şəbəkələrdə yayılan video geniş müzakirələrə səbəb olub. Videoda bir vətəndaş “Baku Electronics” mağazasından aldığı iPhone 17 Pro modelində donma problemi olduğunu iddia edir."],
  ["məhsul 2 gün işlədi", "\"Baku Electronics”dən alınan məhsul cəmi 2 gün işləyəndən sonra xarab olub. Bu barədə sosial şəbəkədə Gülnarə Osmanlı məlumat paylaşıb."],
  ["antiinhisar yoxlaması", "Prezident yanında Antiinhisar və İstehlak Bazarına Nəzarət Dövlət Agentliyi “Veysəloğlu” şirkətlər qrupuna daxil olan “Araz Supermarket” MMC-də qanun pozuntusu aşkar edib."],
  ["çörək stenddə kiflənir", "Araz marketdə təzə çörək tapa bilən var ümumiyyətlə? 29 iyul çəkilib foto, 5 gün qalmış çörək niyə satışdan çıxarılmır? Kiflənməlidir stenddə?"],
  ["soyuducu soyutmur", "Salam. Samsung soyuducumla bağlı problem var. İşıq artıb-azaldıqdan sonra soyuducudan işləyirmiş kimi səs gəlir, amma soyutmur."],
  ["sarkazm про продавца", "Araz Supermarket meyvə-tərəvəzin baş satıcısı.🤣"],
  ["aptek yoxlaması", "Səhiyyə Nazirliyi Analitik Ekspertiza Mərkəzi tərəfindən “Zeytun” apteklər şəbəkəsinə məxsus aptekdə keçirilən yoxlama zamanı ciddi nöqsanlar aşkarlanıb."],
  ["qiymət fərqi şikayəti", "\"Araz\" supermarketlər şəbəkəsi növbəti dəfə qiymət fərqi iddiaları ilə gündəmə gəlib. Klinik.media-ya daxil olan şikayətə görə, şəbəkənin Əhmədli filialında..."],
]

describe("isCondolencePost", () => {
  it("catches the tribute post that flooded the feed with 275 condolences", () => {
    expect(isCondolencePost(CONDOLENCE_PARENT)).toBe(true)
  })

  it.each(COMPLAINT_PARENTS)("leaves the real complaint parent untouched: %s", (_label, text) => {
    expect(isCondolencePost(text)).toBe(false)
  })

  it.each([
    ["азербайджанское соболезнование", "Allah rəhmət eləsin, məkanı cənnət olsun"],
    ["без диакритики", "Allah rehmet elesin"],
    ["дань шехиду хештегом", "Bu gün #şəhid Rauf-u anırıq"],
    ["ruhu şad olsun", "Ruhu şad olsun, çox gözəl insan idi"],
    ["turkish vefat", "Dün vefat etti, başınız sağ olsun"],
    ["русское соболезнование", "Приносим соболезнования семье, светлая память"],
    ["english RIP", "RIP, rest in peace brother"],
  ])("recognises the wording of grief: %s", (_label, text) => {
    expect(isCondolencePost(text)).toBe(true)
  })

  it.each([
    ["пустой текст", ""],
    ["null", null],
    ["undefined", undefined],
    ["жалоба со словом «проблема»", "Bu mağazada həmişə problem var, məhsul xarab"],
    // «Rəhmətlik» в бытовой речи — не соболезнование поста, но и не жалоба;
    // важно, что формула соболезнования требует глагол рядом.
    ["слово rəhmət без формулы", "Rəhmət qapısı yaxınlığındakı filial bağlıdır"],
  ])("does not fire on %s", (_label, text) => {
    expect(isCondolencePost(text)).toBe(false)
  })
})
