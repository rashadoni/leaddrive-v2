"use client"

/**
 * MTM Analitika — kömək (azərbaycanca). Rəhbər üçün ekran: komandanın dövr üzrə nəticəsi və kim geridə qalır.
 * Owner 2026-09-26: «аналитика нужна для менеджеров».
 */
import {
  HelpScenario,
  HelpSection,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmanalyticsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Siz sahə komandasının rəhbərisiniz"
        goal="Bir dəqiqəyə komandanın vizit planını necə icra etdiyini və kimin geridə qaldığını görmək"
      >
        <HelpKey>MTM</HelpKey> → <HelpKey>Analitika</HelpKey> açın. Susmaya görə <HelpKey>Bu ay</HelpKey> bu günə qədər göstərilir. Digər dövrlər: <HelpKey>Bu həftə</HelpKey>, <HelpKey>Keçən həftə</HelpKey>, <HelpKey>30 gün</HelpKey>.
      </HelpScenario>

      <HelpSection title="Yuxarıda üç rəqəm">
        <dl className="rounded-md border p-3">
          <HelpDef term="Vizit planı">Dərc olunmuş marşrutların planlaşdırılmış nöqtələrindən neçəsinə agentlər baş çəkib. Qaralamalar və ləğv olunmuş marşrutlar sayılmır.</HelpDef>
          <HelpDef term="Vizitlər">Dövr ərzində neçə vizit tamamlanıb.</HelpDef>
          <HelpDef term="GPS qeydi ilə">Tamamlanmış vizitlərdən neçəsində giriş və çıxış koordinatları var.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Kim geridə qalır">
        <p>«Agentlər üzrə» cədvəli icrası ən aşağı olanlardan başlayır: qırmızı — 80%-dən az, kəhrəba — 80–94%, yaşıl — 95%-dən. Dövrdə planı olmayan agentlər sonda gəlir. Ada klikləyin — «Agent dövr üzrə» açılacaq: günlər üzrə kimlə görüşüb və nə qədər qalıb.</p>
      </HelpSection>

      <HelpSection title="Günlər üzrə">
        <p>Hər gün üçün bir sütun: hündürlüyü yerinə yetirilmiş nöqtələrin payıdır. «45 nöqtədən 27» görmək üçün sütunun üzərinə gəlin.</p>
      </HelpSection>

      <HelpSection title="Rəqəmlər necə hesablanır">
        <p>Səhifənin aşağısında bükülmüş «Rəqəmlər necə hesablanır» bloku var. Orada eyni rəqəmlər hər nöqtəyə və hər vizitə qədər açılır, şöbə, vizit növü və brend filtrləri, CSV ixracı və səbəbli düzəlişlər var. Yuxarıdakı rəqəmlər eyni faktlardan hesablanır, ona görə həmişə üst-üstə düşür.</p>
        <HelpCallout kind="warning">Dövr üçün məlumat çox olarsa, yuxarıda xəbərdarlıq çıxacaq: bir hissəsi göstərilir. Daha qısa dövr seçin.</HelpCallout>
      </HelpSection>
    </div>
  )
}
