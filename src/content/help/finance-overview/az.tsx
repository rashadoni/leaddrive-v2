"use client"

/**
 * Finance — Maliyyə icmalı (Overview tab) help article (Azerbaijani).
 * Köhnə birgə "budgeting" məqaləsindən ayrılıb: yalnız
 * Maliyyə → İcmal tabını əhatə edir (il/dövr seçimi, Excel ixracı,
 * xəbərdarlıqlar, 6 KPI kartı, trend/struktur/yaş qrafikləri,
 * maliyyə xülasəsi). Debitor/Kreditor/Fondlar/Ödənişlər tabları
 * AYRI səhifələrdir və bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function FinanceoverviewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Maliyyəçi, biznes sahibi və ya rəhbərsiniz"
        goal="Bir ekranda şirkətin gəlir, xərc, mənfəət, nağd qalıq, debitor və kreditor mənzərəsini görmək və problemli yerləri tez tutmaq"
      >
        Səhifəyə soldakı menyudan <HelpKey>Maliyyə</HelpKey> bölməsini açıb{" "}
        <HelpKey>İcmal</HelpKey> tabında qalmaqla çatırsınız (səhifə həmişə bu tabla açılır). Bütün
        rəqəmlər yalnız sizin təşkilatınızın məlumatından hesablanır. İcmal yalnız oxunan tablodur —
        burada heç nə yaratmırsınız, sadəcə baxır, dövr seçir və ixrac edirsiniz; faktiki faktura,
        ödəniş və fondlar qonşu tablardadır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Maliyyə</HelpKey> adı, yanında tur təkrarı və kömək düymələri var.
          Altında beş tab durur: <HelpKey>İcmal</HelpKey>, <HelpKey>Debitor (A/R)</HelpKey>,{" "}
          <HelpKey>Kreditor (A/P)</HelpKey>, <HelpKey>Fondlar</HelpKey> və{" "}
          <HelpKey>Ödənişlər</HelpKey>. Bu məqalə yalnız <strong>İcmal</strong> tabını izah edir.
          İcmal tabının yuxarısında <strong>Maliyyə icmalı</strong> başlığı və seçilmiş dövr (məs.
          «2026 ili üçün əsas göstəricilər» və ya tarix aralığı) yazılır; sağda dövr idarəetmələri və{" "}
          <HelpKey>Excel ixrac</HelpKey> düyməsi var. Altda — varsa — xəbərdarlıqlar zolağı, sonra altı
          KPI kartı, sonra qrafiklər və maliyyə xülasəsi gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Gəlir">Seçilmiş dövr üzrə daxil olan gəlir; kartda fakt rəqəmi, altında «Plan» və plana nisbətən faiz fərqi göstərilir.</HelpDef>
          <HelpDef term="Xərclər">Dövr üzrə xərclər; planı aşmaq pis sayılır, ona görə fərq əksinə rənglənir (plandan az = yaşıl).</HelpDef>
          <HelpDef term="Xalis mənfəət">Gəlir mənfi xərc; müsbətdə yaşıl, mənfidə qırmızı.</HelpDef>
          <HelpDef term="Nağd qalıq">Cari nağd qalıq; mənfidirsə qırmızı göstərilir.</HelpDef>
          <HelpDef term="Debitor (A/R)">Sizə borclu məbləğ; gecikmiş faktura varsa kartın altında sayı yazılır.</HelpDef>
          <HelpDef term="Kreditor (A/P)">Sizin borclu olduğunuz məbləğ; gecikmiş ödəniş varsa sayı göstərilir.</HelpDef>
          <HelpDef term="Plan / fakt">Plan — büdcəyə qoyulmuş hədəf; fakt — real baş verən. Kartdakı faiz bu ikisinin fərqidir.</HelpDef>
          <HelpDef term="Debitor yaşı">Sizə borcun nə qədər köhnə olduğunu göstərən bölgü: Cari, 1-30 gün, 31-60 gün, 61-90 gün və 90+.</HelpDef>
          <HelpDef term="Netto mövqe">Debitor mənfi Kreditor — kimə nə qədər borclu olduğunuzun ümumi balansı.</HelpDef>
        </dl>
        <p>
          Hər KPI kartının yuxarı kənarında rəngli zolaq, başlıq, böyük rəqəm və valyuta nişanı olur;
          Gəlir və Xərclər kartlarında əlavə olaraq plan və yuxarı/aşağı ox ilə faiz fərqi görünür.
          Aşağıda iki sıra qrafik durur: birinci sırada solda enli <strong>Gəlir və xərc trendi</strong>{" "}
          (sütun + xətt), sağda dairəvi <strong>Xərc strukturu</strong>; ikinci sırada solda{" "}
          <strong>Debitor yaşı</strong> üfüqi sütun qrafiki, sağda isə bütün rəqəmlərin sətir-sətir
          toplandığı <strong>Maliyyə xülasəsi</strong> kartı.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: dövrü seç və göstəriciləri oxu">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı il açılan siyahısından il seçin (keçən il, cari il və gələn il variantları
            verilir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıq altındakı izah «&lt;seçilmiş il&gt; ili üçün əsas göstəricilər»ə dəyişir və bütün KPI
            kartları, qrafiklər və xülasə həmin ilin rəqəmləri ilə yenidən yüklənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret tarix aralığı istəyirsinizsə, il açılan siyahısının yanında <HelpKey>və ya</HelpKey>{" "}
            yazısından sonrakı iki tarix sahəsini doldurun — birinci «başlanğıc», ikinci «son» tarix.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər iki tarix dolanda başlıq altındakı izah «&lt;başlanğıc&gt; – &lt;son&gt;» aralığına
            keçir, il açılan siyahısı boz (deaktiv) olur və göstəricilər seçilmiş aralıq üzrə hesablanır.
            İkinci tarix birincidən əvvəl seçilə bilməz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tarix aralığını ləğv edib ilə qayıtmaq üçün yanında peyda olan <HelpKey>Dövrü sıfırla</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər iki tarix sahəsi boşalır, il açılan siyahısı yenidən aktivləşir və göstəricilər həmin ilə
            qayıdır. <HelpKey>Dövrü sıfırla</HelpKey> düyməsi yalnız aralıq seçilmiş olanda görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Altı KPI kartını oxuyun: hər kartda böyük fakt rəqəmi, valyuta nişanı, lazım olduqda «Plan»
            sətri və faiz fərqi var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Faiz fərqi yaşıl yuxarı ox (yaxşı), qırmızı aşağı ox (pis) və ya boz tire (fərq yoxdur) ilə
            işarələnir. Xərclər kartında məntiq əksdir — plandan az xərc yaşıl, çox xərc qırmızıdır.
            Debitor və Kreditor kartlarında gecikmiş sənəd varsa, kartın altında «&lt;say&gt; gecikmiş»
            qeydi çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: xəbərdarlıqları yoxla">
        <HelpStep n={1}>
          <p>
            KPI kartlarının üstündəki <HelpKey>Xəbərdarlıqlar</HelpKey> zolağına baxın (problem yoxdursa
            bu zolaq ümumiyyətlə görünmür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər xəbərdarlıq rəngli zolaq kimi çıxır: qırmızı (kritik), narıncı (xəbərdarlıq) və ya mavi
            (məlumat) — yanında uyğun ikona. Mətnlər tipik olaraq gecikmiş fakturalar, mənfi nağd qalıq,
            büdcə artıqlaması, gecikmiş ödənişlər və ya fond təminatı barədə olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Xəbərdarlıqda <HelpKey>Aç</HelpKey> keçidi varsa onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sizi həmin problemin aid olduğu səhifəyə (məs. gecikmiş fakturalar üçün Debitor tabına)
            keçirir ki, oradan birbaşa hərəkət edə biləsiniz. Hər xəbərdarlıqda bu keçid olmaya da bilər.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qrafikləri və xülasəni oxu">
        <HelpStep n={1}>
          <p>
            Sol enli <HelpKey>Gəlir və xərc trendi</HelpKey> qrafikinə baxın — aylar üzrə gəlir (yaşıl
            sütun), xərc (qırmızı sütun) və xalis (mavi xətt).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sütun və ya xətt üzərinə kursoru aparanda kiçik pəncərə açılır və həmin ayın gəlir, xərc və
            xalis məbləğini valyuta ilə göstərir. Ay adları seçdiyiniz dilə uyğun yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağdakı <HelpKey>Xərc strukturu</HelpKey> dairəvi qrafikinə baxın — xərclərin kateqoriyalar
            üzrə bölgüsü.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dairənin altında hər kateqoriya rəngli nöqtə, ad və faizlə sadalanır; ən böyük artıq
            kateqoriyalar «Digər» altında toplanır. Xərc məlumatı yoxdursa, «Xərc məlumatı yoxdur» yazısı
            çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Debitor yaşı</HelpKey> üfüqi sütun qrafikinə baxın — sizə borcun nə qədər köhnə
            olduğu (Cari, 1-30, 31-60, 61-90, 90+ gün).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər yaş zolağı ayrı rənglə göstərilir; sütun üzərinə kursoru aparanda məbləğ valyuta ilə
            çıxır. Açıq debitor yoxdursa, «Debitor yaşı məlumatı yoxdur» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Sağdakı <HelpKey>Maliyyə xülasəsi</HelpKey> kartını oxuyun — bütün əsas rəqəmlərin sətir-sətir
            siyahısı.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Gəlir (plan/fakt), Xərclər (plan/fakt), Xalis mənfəət, Nağd qalıq, Debitor, Kreditor və{" "}
            <strong>Netto mövqe (A/R – A/P)</strong> sətir-sətir məbləğlərlə düzülür; əsas sətirlər qalın
            şriftlə fərqlənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: hesabatı Excel-ə ixrac et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Excel ixrac</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cari görünüşün — seçdiyiniz il və ya tarix aralığının — maliyyə hesabatı Excel faylı kimi
            endirilir. Düyməyə basanda hər hansı dövr seçimi onsuz da nəzərə alınır, ona görə əvvəlcə
            istədiyiniz ili/aralığı seçin, sonra ixrac edin.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          İl seçimi ilə tarix aralığı bir-birini əvəz edir: aralıq doldurulanda il açılan siyahısı
          deaktiv olur. Konkret rüb və ya ay üçün dəqiq mənzərə istəyirsinizsə tarix aralığından
          istifadə edin; bütün il üzrə müqayisə üçün isə il açılan siyahısı daha rahatdır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          İcmal tabı yalnız mövcud məlumatı oxuyur — burada faktura, ödəniş və ya büdcə{" "}
          <strong>dəyişdirilmir</strong>. «Plan» rəqəmləri büdcədən, «fakt» rəqəmləri real
          faktura/ödənişlərdən gəlir, ona görə kartlar boş və ya sıfır görünürsə, problem İcmalda yox,
          mənbə məlumatın (büdcə, fakturalar, ödənişlər) doldurulmamasındadır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün maliyyə göstəriciləri yalnız sizin təşkilatınızla məhdudlaşır — başqa təşkilatın
          rəqəmlərini görmürsünüz. Excel ixracı da eyni qaydada yalnız öz tenant-ınızın məlumatını
          ehtiva edir.
        </p>
      </HelpCallout>
    </div>
  )
}
