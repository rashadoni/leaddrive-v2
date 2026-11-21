"use client"

/**
 * Deal detail (record) — help article (Azerbaijani).
 * Bir sövdələşmənin səhifəsi: /deals/[id].
 * The page as redesigned on 2026-11-21: header and stage track, four tiles,
 * «What to do now» with planned tasks, four sections opened on demand,
 * Da Vinci as a side panel.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function dealdetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona={"Satış nümayəndəsi və ya satış menecerisiniz"}
        goal={"Sövdələşməni açmaq, onunla nə etmək lazım olduğunu dərhal görmək, bunu elə yerində etmək və onu mərhələlər üzrə aparmaq"}
      >
        Bu səhifəyə <HelpKey>Satış hunisi</HelpKey> siyahısında və ya lövhəsində sövdələşməyə klikləyərək gəlirsiniz. Səhifə yuxarıdan aşağı oxunur: bu hansı sövdələşmədir və hansı mərhələdədir, dörd əsas rəqəm, indi nə etmək lazımdır, aşağıda isə lazım olana qədər bağlı qalan təfərrüatlar.
      </HelpScenario>

      <HelpSection title={"Səhifədə nə var"}>
        <p>Yuxarıda <strong>başlıq</strong>: sövdələşmənin adı, rəngli mərhələ rozeti, şirkət, kontakt və teqlər. Sağda <HelpKey>Əlaqə saxla</HelpKey>, <HelpKey>Qeyd əlavə et</HelpKey>, <HelpKey>Da Vinci</HelpKey>, <HelpKey>Redaktə et</HelpKey> düymələri və zibil qutusu. Başlığın altında <strong>mərhələ zolağı</strong>: keçilmiş mərhələlər işarə ilə, cari mərhələ rənglənib, <HelpKey>İtirildi</HelpKey> isə sağda ayrıca durur, çünki bu növbəti addım yox, nəticədir.</p>
        <p>Sonra <strong>dörd plitə</strong> (məbləğ, ödəniş, məsul şəxs, növbəti addım), <strong>İndi nə etmək lazımdır</strong> bloku və dörd bölmədən ibarət sıra gəlir: <HelpKey>Müştəri</HelpKey>, <HelpKey>Satış</HelpKey>, <HelpKey>Pul və təchizat</HelpKey>, <HelpKey>Tarixçə</HelpKey>. Kursoru istənilən plitənin, bölmənin və ya mərhələnin üzərinə gətirin: bunun nə olduğu və klikin nə edəcəyi barədə ipucu görünəcək.</p>
        <dl className="rounded-md border p-3">
          <HelpDef term={"Plitə"}>Sövdələşmənin bir rəqəmi. Plitəyə klik onunla işlənilən yerə aparır: məbləğ məhsulları, ödəniş hesab-fakturaları, məsul şəxs əməkdaş seçimini, növbəti addım planlaşdırmanı açır.</HelpDef>
          <HelpDef term={"İndi nə etmək lazımdır"}>Sövdələşmədə nəyin düz olmadığı və növbəti mərhələnin nə tələb etdiyi: ödənilməmiş hesab-fakturalar, məsul şəxs yoxdur, kontakt yoxdur, növbəti mərhələnin qaydaları. Hər addım elə burada edilir.</HelpDef>
          <HelpDef term={"Planlaşdırılıb"}>Sövdələşmə üzrə tarixli tapşırıqlar. Ən yaxını «Növbəti addım» plitəsində göstərilir; tapşırıq «Tapşırıqlar» bölməsində də görünür və həmin gün xatırlatma gəlir.</HelpDef>
          <HelpDef term={"Bölmə"}>Sövdələşmənin lazım olana qədər bağlı qalan təfərrüatları. Bağlı bölmə içində nə olduğunu deyir; klik onu yerində açır, içində öz hissələri var.</HelpDef>
          <HelpDef term={"Da Vinci"}>Sağda proqnoz, risklər, məsləhətlər və müştəriyə nə təklif etmək barədə panel. Düymə ilə açılır, səhifədə yer tutmur.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title={"Addım-addım: indi lazım olanı etmək"}>
        <HelpStep n={1}>
          <p><strong>İndi nə etmək lazımdır</strong> blokunda yuxarıdakı addımı tapın. Gecikmiş hesab-faktura birinci durur və qırmızı ilə seçilib. <HelpKey>Ödənişi qeyd et</HelpKey> düyməsini basın.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>Addımın altında borc məbləği və bugünkü tarixlə forma açılır. Borcdan çox yazmaq olmur: səhifə bunu deyir və heç nə göndərmir. Yadda saxladıqdan sonra «Ödəniş» plitəsi, borc və addım yenidən hesablanır.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Məsul şəxs addımında <HelpKey>Təyin et</HelpKey> basın və əməkdaşı seçin. Kontakt addımında <HelpKey>Əlavə et</HelpKey> basın və müştərinin adamını seçin.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>Addım işarələnir, sağdakı sayğac artır. Hər şey ediləndə siyahı bir sətrə yığılır; onu <HelpKey>Addımları göstər</HelpKey> düyməsi ilə açmaq olar.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p><HelpKey>Planlaşdır</HelpKey> basın, nə etmək lazım olduğunu yazın və günü seçin.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>Tapşırıq «Planlaşdırılıb» sətrində və «Növbəti addım» plitəsində görünür. <HelpKey>Edildi</HelpKey> düyməsi onu bağlayır, zibil qutusu plandan çıxarır.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title={"Addım-addım: sövdələşməni başqa mərhələyə keçirmək"}>
        <HelpStep n={1}>
          <p>Zolaqda lazım olan mərhələyə klikləyin.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>Adi mərhələlər arasında sövdələşmə dərhal keçir, çıxan mesajda isə <HelpKey>Geri qaytar</HelpKey> var. Mərhələnin yerinə yetirilməmiş qaydaları varsa, sövdələşmə yerində qalır və zolağın altında nəyin çatmadığı yazılır. Həmin qaydalar əvvəlcədən «İndi nə etmək lazımdır» blokunda görünür.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Qazanmaq üçün <HelpKey>Qazanıldı</HelpKey> mərhələsini basın.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>Səhifə əvvəlcə təsdiq soruşur: qazanma şirkətin buna qurduqlarını işə salır, məsələn bildirişləri və müştəri sorğusunu.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>İtirmək üçün <HelpKey>İtirildi</HelpKey> basın, səbəbi seçin və <HelpKey>İtirilmiş kimi qeyd et</HelpKey> basın.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>Səbəb olmadan sövdələşmə qeyd olunmur. Səbəb sövdələşmədə saxlanılır və itirilmiş sövdələşmələr hesabatına düşür. İtirilmiş sövdələşməni <HelpKey>İşə qaytar</HelpKey> düyməsi ilə qaytarmaq olar.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title={"Addım-addım: müştəri ilə əlaqə saxlamaq və fəaliyyəti yazmaq"}>
        <HelpStep n={1}>
          <p>Başlıqda <HelpKey>Əlaqə saxla</HelpKey> basın.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>Zolağın altında kontaktla panel açılır: CRM telefonu ilə zəng, məktub və hazır mətnli WhatsApp. WhatsApp həmin mətnlə açılır, göndərməyi isə orada edirsiniz. Kontakt yoxdursa, panel onu əlavə etməyi təklif edir.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p><HelpKey>Qeyd əlavə et</HelpKey> basın.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>«Tarixçə» bölməsinin <HelpKey>Lent</HelpKey> hissəsi açılır: yuxarıda kontakta məktub göndərmə, aşağıda qeyd, zəng və görüşün yazıldığı lent.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title={"Addım-addım: təfərrüatları açmaq"}>
        <HelpStep n={1}>
          <p>Bölməyə klikləyin. <HelpKey>Müştəri</HelpKey> bölməsində şirkət və kontakt, komanda və rollar, rəqiblər var. <HelpKey>Satış</HelpKey> bölməsində məhsullar, təkliflər, şərtlər və MEDDPICC var. <HelpKey>Pul və təchizat</HelpKey> bölməsində hesab-fakturalar, sövdələşmə üçün alışlar və müştəri təsdiqləri var. <HelpKey>Tarixçə</HelpKey> bölməsində lent, mərhələlər və fayllar var.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>Bölmə sıranın altında tam enində açılır. Yuxarıda bölmənin hissələri sayğaclarla, sağda <HelpKey>Yığ</HelpKey> düyməsi durur. İçəridə heç nə səhifədən ayrı sürüşmür.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>«Tarixçə» bölməsində <HelpKey>Mərhələlər</HelpKey> hissəsini açın.</p>
          <HelpCallout kind="see" label={"Ekranda görəcəksiniz"}>Cədvəl sövdələşmənin hər mərhələdə neçə gün qaldığını göstərir. Jurnalda keçid yoxdursa, yalnız cari mərhələ göstərilir və səhifə bunu yazır.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>Teqlər elə başlıqda dəyişdirilir: <HelpKey>+ Teq əlavə et</HelpKey> sahəsinə söz yazın və Enter basın. Sövdələşmənin əsas sahələrini <HelpKey>Redaktə et</HelpKey> düyməsi dəyişir.</p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>«Qazanıldı» və «İtirildi» mərhələlərinə keçirməzdən əvvəl səhifə həmişə soruşur. Sövdələşmənin silinməsini geri qaytarmaq olmur.</p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>Sövdələşmə və onunla bağlı hər şey təşkilatınızla məhdudlaşır. Əməliyyat düymələri yalnız hüququ olanlara görünür: hesab-faktura hüququ olmadan ödəniş yazılmır, tapşırıq hüququ olmadan planlaşdırma yoxdur, «Təchizat» hissəsi isə yalnız bu modulu olan təşkilatda var.</p>
      </HelpCallout>
    </div>
  )
}
