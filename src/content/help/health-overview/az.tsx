"use client"

/**
 * Healthcare (Sağlamlıq Buludu) — landing/overview help article (Azerbaijani).
 * Şərti "industries" birgə məqaləsindən ayrılıb: yalnız Sağlamlıq Buludunun
 * giriş səhifəsini (/health) əhatə edir — başlıq, dörd statistika kartı, axtarış
 * və status filtri, xəstə cədvəli, "Daha çox yüklə". Xəstə kartı, ziyarətlər və
 * müalicə planları AYRI səhifələrdir və bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function healthoverviewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Klinika administratoru və ya qəbul/registratura işçisisiniz"
        goal="Sağlamlıq Buludunun giriş səhifəsindən xəstə bazasına baxmaq, lazımi xəstəni tapmaq və onun kartına keçmək"
      >
        Səhifəyə yan menyudan <HelpKey>Sağlamlıq Buludu</HelpKey> bölməsi ilə çatırsınız. Bu, sənaye
        həlli olan «Health Cloud»un giriş səhifəsidir və açıldıqda dərhal təşkilatınızın xəstə
        siyahısını göstərir. Bütün xəstələr, ziyarət və plan sayları yalnız sizin təşkilatınıza
        aiddir — başqa tenant-ın məlumatını görmürsünüz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda ürək-nəbz ikonası ilə <HelpKey>Sağlamlıq Buludu</HelpKey> başlığı, altında «Tibb
          müəssisələri üçün xəstə idarəetməsi, klinik ziyarətlər və müalicə planları» izahı, sağ
          yuxarıda isə <HelpKey>Yeni Xəstə</HelpKey> düyməsi var. Başlığın altında dörd statistika
          kartı durur, sonra axtarış-filtr zolağı, ən altda isə xəstələrin cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Xəstələr">İlk yüklənən siyahıdakı xəstələrin sayı.</HelpDef>
          <HelpDef term="Aktiv">Statusu «Aktiv» olan xəstələrin sayı.</HelpDef>
          <HelpDef term="Ziyarətlər (30g)">Son ziyarətlər üzrə təxmini say (klinik ziyarət qeydlərindən gəlir).</HelpDef>
          <HelpDef term="Aktiv Planlar">Aktiv vəziyyətdəki müalicə planlarının təxmini sayı.</HelpDef>
          <HelpDef term="TN">Tibbi nömrə (MRN) — hər xəstənin unikal qeydiyyat nömrəsi, cədvəldə monospace şriftlə.</HelpDef>
          <HelpDef term="Status">Xəstənin vəziyyəti: rəngli nişanla Aktiv (yaşıl), Qeyri-aktiv (boz) və ya Vəfat etmiş (qırmızı).</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>TN</strong>, <strong>Xəstə</strong> (ad, altında varsa email),{" "}
          <strong>Status</strong> nişanı, <strong>Telefon</strong> (yoxdursa «—») və{" "}
          <strong>Qeydiyyat Tarixi</strong>. Hər sətrə klikləyəndə həmin xəstənin kartına keçirsiniz.
          Daha çox xəstə varsa, cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: xəstə axtar və kartına keç">
        <HelpStep n={1}>
          <p>
            Səhifə açılanda xəstə cədvəli avtomatik yüklənir. Lazımi xəstəni tapmaq üçün filtr
            zolağındakı axtarış sahəsinə yazın — placeholder «TN və ya email ilə axtarın…» göstərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırdıqdan təxminən yarım saniyə sonra cədvəl avtomatik yenilənir (axtarış
            gecikmə ilə işləyir) və yalnız TN-i və ya email-i uyğun gələn xəstələr qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstəsəniz status açılan siyahısından dəyərlərdən birini seçin:{" "}
            <HelpKey>Bütün statuslar</HelpKey>, <HelpKey>Aktiv</HelpKey>, <HelpKey>Qeyri-aktiv</HelpKey>{" "}
            və ya <HelpKey>Vəfat etmiş</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal seçilmiş statusa görə süzülür. Sağdakı təzələmə (dairəvi ox) düyməsi isə
            cari siyahını yenidən serverdən çəkir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tapdığınız xəstənin cədvəldəki sətrinə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə həmin xəstənin kartına keçir (ünvan <code>/health/&lt;id&gt;</code>). Orada ümumi
            baxış, ziyarətlər, müalicə planları və tibbi qeyd bölmələri açılır — bunlar ayrı
            səhifədir, bu giriş səhifəsinin bir hissəsi deyil.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Axtardığınız xəstə ilk siyahıda görünmürsə, cədvəlin altındakı{" "}
            <HelpKey>Daha çox yüklə</HelpKey> düyməsi ilə növbəti dəstə xəstəni gətirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yalnız daha çox nəticə qaldıqda görünür. Basanda mövcud sətirlərin altına yeni
            xəstələr əlavə olunur; yüklənmə gedərkən düymə müvəqqəti deaktiv olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni xəstə əlavə et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni Xəstə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu düymə yeni xəstə qeydiyyatı axınını başladır. Səhifədə ən görkəmli əməliyyat düyməsi
            budur — başlığın sağ tərəfində, üstündə artı (+) işarəsi ilə durur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Ümumi Xəstələr</strong> kartı ilk yüklənən dəstəni sayır, ona görə bütün baza çox
          böyükdürsə bu rəqəm tam siyahı yox, cari görünən nəticələri əks etdirir. Dəqiq say lazımdırsa,
          əvvəlcə statusa görə süzün və ya <HelpKey>Daha çox yüklə</HelpKey> ilə bütün siyahını açın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün xəstə məlumatları təşkilatınızla məhdudlaşır — siyahı, statistika və axtarış yalnız
          öz tenant-ınızın xəstələrini göstərir, başqa təşkilatın xəstələri heç vaxt görünmür.
          Xəstə kartına klik etmək də yalnız öz təşkilatınızın qeydlərini açır.
        </p>
      </HelpCallout>
    </div>
  )
}
