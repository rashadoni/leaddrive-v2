"use client"

/**
 * Public Sector (Dövlət sektoru) — landing/overview help article (Azerbaijani).
 * Ümumi "industries" məqaləsindən ayrılıb: yalnız Dövlət sektoru
 * vertikalının giriş səhifəsini (Vətəndaşlar reyestri + statistika
 * kartları + filtrlər + cədvəl) əhatə edir. Səhifə həm də qonşu
 * bölmələrin (İşlər, Lisenziyalar) sayğaclarını çəkir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function publicsectoroverviewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dövlət qurumu və ya bələdiyyə işçisisiniz (qeydiyyat və ya xidmət operatoru)"
        goal="Dövlət sektoru vertikalının giriş səhifəsini açıb vətəndaş reyestrini gözdən keçirmək, axtarış və status filtri ilə düzgün vətəndaşı tapmaq"
      >
        Bu, <strong>Dövlət sektoru</strong> sənaye buludunun (Industry Cloud) giriş səhifəsidir.
        Açılan kimi <HelpKey>Vətəndaşlar</HelpKey> reyestrini göstərir. Bütün vətəndaşlar, işlər və
        lisenziyalar yalnız sizin təşkilatınıza aiddir — başqa təşkilatın məlumatını görmürsünüz.
        Yuxarıdakı statistika kartları və siyahı eyni məlumat mənbəyindən oxunur, ona görə axtarış və
        ya filtr dəyişdikcə nəticələr dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Sol yuxarıda landmark (dövlət binası) ikonası, yanında səhifə başlığı{" "}
          <HelpKey>Vətəndaşlar</HelpKey> və altında «Dövlət sektoru üçün vətəndaş reyestri və xidmət
          qeydləri» izahı durur. Sağ yuxarıda <HelpKey>Yeni Vətəndaş</HelpKey> düyməsi (üstəgəl
          ikonalı) var. Onların altında dörd statistika kartı, sonra filtr zolağı və ən altda
          vətəndaşlar cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Vətəndaş">Hazırda yüklənmiş vətəndaş sətirlərinin sayı.</HelpDef>
          <HelpDef term="Aktiv">Yüklənmiş sətirlər arasında statusu «Aktiv» olanların sayı.</HelpDef>
          <HelpDef term="İşlər">İşlər bölməsindən gələn iş sayğacı (müavinətlər, şikayətlər, apellyasiyalar və s.).</HelpDef>
          <HelpDef term="Lisenziyalar">Lisenziyalar bölməsindən gələn lisenziya sayğacı (sürücülük vəsiqələri, biznes icazələri və s.).</HelpDef>
          <HelpDef term="Vətəndaş">Reyestrdəki bir nəfər — vətəndaş ID, ad, status, yurisdiksiya və yaradılma tarixi ilə.</HelpDef>
          <HelpDef term="Status">Vətəndaşın vəziyyəti: Aktiv, Qeyri-aktiv və ya Vəfat etmiş.</HelpDef>
          <HelpDef term="Yurisdiksiya">Vətəndaşın bağlı olduğu inzibati bölgə (varsa); yoxdursa «—» göstərilir.</HelpDef>
        </dl>
        <p>
          Cədvəldə beş sütun var: <strong>Vətəndaş ID</strong> (mono şriftlə), <strong>Ad</strong>{" "}
          (varsa altında e-poçt), <strong>Status</strong> (rəngli nişan), <strong>Yurisdiksiya</strong>{" "}
          və <strong>Yaradıldı</strong>. ID, ad, status və tarix sütunlarının başlığına basıb
          sıralaya bilərsiniz. Heç bir sətir yoxdursa, cədvəlin yerində «Məlumat yoxdur» yazısı çıxır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: vətəndaşı axtar və tap">
        <HelpStep n={1}>
          <p>
            Səhifə açılan kimi reyestr öz-özünə yüklənir. Konkret birini tapmaq üçün filtr
            zolağındakı axtarış xanasına vətəndaş ID və ya e-poçt yazın — placeholder «ID və ya
            email ilə axtarın…» mətnini göstərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırdıqdan təxminən yarım saniyə sonra siyahı avtomatik yenilənir və yalnız
            uyğun vətəndaşlar qalır. <strong>Ümumi Vətəndaş</strong> kartındakı say da yüklənmiş
            nəticələrə görə dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Status üzrə daraltmaq üçün axtarış xanasının yanındakı açılan siyahıdan bir status seçin:{" "}
            <HelpKey>Aktiv</HelpKey>, <HelpKey>Qeyri-aktiv</HelpKey> və ya <HelpKey>Vəfat etmiş</HelpKey>.
            Bütün vətəndaşlara qayıtmaq üçün <HelpKey>Bütün statuslar</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl seçilmiş statusa uyğun sətirlərlə yenilənir. Hər sətirdəki status nişanı rənglə
            fərqlənir — aktiv yaşıl, qeyri-aktiv boz, vəfat etmiş qırmızı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Filtrin yanındakı yenilə (dairəvi ox ikonalı) düyməni basıb siyahını yenidən serverdən
            çəkə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı baştan yüklənir və cari axtarış/status seçiminə uyğun ən son məlumatı göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Reyestr böyükdürsə, cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünür —
            onu basıb növbəti vətəndaş dəstəsini əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə basıldıqda yeni sətirlər mövcud siyahının sonuna əlavə olunur (siyahı sıfırlanmır).
            Daha yüklənəcək sətir qalmadıqda düymə yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: statistika kartlarını oxu və qonşu bölmələrə keç">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı dörd karta nəzər salın: <strong>Ümumi Vətəndaş</strong>,{" "}
            <strong>Aktiv</strong>, <strong>İşlər</strong> və <strong>Lisenziyalar</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartın yuxarısında etiket və ikona, altında isə böyük rəqəm durur.{" "}
            <strong>İşlər</strong> və <strong>Lisenziyalar</strong> sayğacları bu səhifə açılarkən
            ayrı-ayrılıqda öz bölmələrindən çəkilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İş yükü və ya lisenziyalarla işləmək üçün sol menyudan həmin bölmələrə — İşlər və
            Lisenziyalar səhifələrinə keçin (kart yalnız sayı göstərir, ayrıca səhifələr bütün
            əməliyyatları saxlayır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan bölmə öz başlığı, statistika kartları və cədvəli ilə gəlir — məsələn İşlər
            səhifəsində iş nömrəsi, mövzu, prioritet və son tarix sütunları olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Cədvəlin öz daxili axtarış xanası və səhifə ölçüsü düymələri (20 / 50 / 100 / Hamısı) var —
          bunlar artıq yüklənmiş sətirlər üzərində iş görür. Yuxarıdakı filtr zolağı isə serverdən nə
          çəkiləcəyini idarə edir. Geniş axtarış üçün əvvəlcə yuxarıdakı zolağı, sonra cədvəlin daxili
          axtarışını istifadə edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Ümumi Vətəndaş</strong> və <strong>Aktiv</strong> kartlarındakı saylar bütün
          reyestrin deyil, hazırda <strong>yüklənmiş</strong> sətirlərin əsasında hesablanır. Bütün
          vətəndaşları görmək üçün <HelpKey>Daha çox yüklə</HelpKey> ilə qalan sətirləri çəkin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün vətəndaşlar, işlər və lisenziyalar təşkilatınızla məhdudlaşır — sorğular yalnız sizin
          tenant-ınızın məlumatını qaytarır və başqa təşkilatın reyestrini görə bilmirsiniz.
        </p>
      </HelpCallout>
    </div>
  )
}
