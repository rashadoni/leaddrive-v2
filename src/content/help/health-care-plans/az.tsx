"use client"

/**
 * Healthcare → Müalicə Planları — help article (Azerbaijani).
 * Səhiyyə şaquli modulunun ümumi məqaləsindən ayrılıb: yalnız
 * Səhiyyə → Müalicə Planları səhifəsini əhatə edir (status filtri,
 * statistika kartları, plan cədvəli, daha çox yüklə). Bu səhifə
 * YALNIZ oxumaq üçündür — burada plan yaratma/redaktə forması YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function healthcareplansHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Klinika koordinatoru, tibb bacısı və ya səhiyyə əməliyyat administratorusunuz"
        goal="Bütün xəstələr üzrə müalicə planlarının siyahısını gözdən keçirmək, statusa görə süzgəcdən keçirmək və hansı planların aktiv, tamamlanmış və ya qaralama olduğunu görmək"
      >
        Səhifəyə <HelpKey>Səhiyyə</HelpKey> → <HelpKey>Müalicə Planları</HelpKey> yolu ilə çatırsınız.
        Bu səhifə <strong>yalnız oxumaq üçündür</strong> — planların icmalını göstərir, lakin burada
        plan yaratmaq və ya redaktə etmək üçün düymə yoxdur. Bütün planlar yalnız sizin təşkilatınıza
        (tenant) aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda firuzəyi <HelpKey>FileCheck</HelpKey> ikonası, yanında <strong>Müalicə Planları</strong>{" "}
          başlığı və altında «Bütün xəstələr üzrə aktiv və arxiv müalicə planları.» izahı var. Onun
          altında dörd statistika kartı sıralanır: <strong>Ümumi Plan</strong>, <strong>Aktiv</strong>,{" "}
          <strong>Tamamlanmış</strong> və <strong>Qaralama</strong>. Daha aşağıda bir status süzgəci,
          yeniləmə düyməsi və planların cədvəli durur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Plan">Hazırda cədvələ yüklənmiş planların sayı.</HelpDef>
          <HelpDef term="Aktiv">Yüklənmiş planlar arasında «Aktiv» statuslu olanların sayı.</HelpDef>
          <HelpDef term="Tamamlanmış">Yüklənmiş planlar arasında «Tamamlandı» statuslu olanların sayı.</HelpDef>
          <HelpDef term="Qaralama">Yüklənmiş planlar arasında «Qaralama» statuslu olanların sayı.</HelpDef>
          <HelpDef term="Plan Adı">Planın adı — cədvəlin birinci sütunu, sıralana bilir.</HelpDef>
          <HelpDef term="Status">Planın həyat dövründəki vəziyyəti, rəngli nişan kimi: Qaralama, Aktiv, Dayandırıldı, Tamamlandı və ya Ləğv edildi.</HelpDef>
          <HelpDef term="Başlama Tarixi">Planın başladığı tarix; boşdursa «—» göstərilir. Sıralana bilir.</HelpDef>
          <HelpDef term="Bitmə Tarixi">Planın bitmə tarixi; təyin edilməyibsə «—» göstərilir.</HelpDef>
          <HelpDef term="Aktivləşdi">Planın «Aktiv» statusuna keçdiyi tarix; yoxdursa «—» göstərilir.</HelpDef>
        </dl>
        <p>
          Status nişanları rənglərlə fərqlənir: <strong>Qaralama</strong> boz, <strong>Aktiv</strong>{" "}
          yaşıl, <strong>Dayandırıldı</strong> kəhrəba, <strong>Tamamlandı</strong> mavi və{" "}
          <strong>Ləğv edildi</strong> qırmızı. Cədvəldə hər planın adı, statusu, başlama və bitmə
          tarixləri, eləcə də aktivləşmə tarixi göstərilir.
        </p>
        <HelpCallout kind="tip">
          <p>
            Statistika kartlarındakı saylar <strong>bütün baza üzrə deyil, yalnız cari yüklənmiş
            siyahıya görə</strong> hesablanır. <HelpKey>Daha çox yüklə</HelpKey> ilə əlavə planlar
            çəkdikdə kartlar yenidən hesablanmır — onlar ilk yüklənən dəstəni əks etdirir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: planları statusa görə süzgəcdən keçir">
        <HelpStep n={1}>
          <p>
            Cədvəlin üstündəki status açılan siyahısını açın. Standart olaraq orada{" "}
            <HelpKey>Bütün statuslar</HelpKey> seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda <strong>Bütün statuslar</strong> və beş status variantı görünür: Qaralama,
            Aktiv, Dayandırıldı, Tamamlandı, Ləğv edildi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstədiyiniz statusu seçin (məsələn, <HelpKey>Aktiv</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yenidən yüklənir və yalnız seçilmiş statusa uyğun planları göstərir. Siyahı sıfırdan
            çəkildiyi üçün statistika kartlarındakı saylar da bu süzgəcin nəticəsinə görə yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün planlara qayıtmaq üçün açılan siyahıdan yenidən <HelpKey>Bütün statuslar</HelpKey>{" "}
            seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl status məhdudiyyəti olmadan yenidən doldurulur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahını yenilə və daha çox plan yüklə">
        <HelpStep n={1}>
          <p>
            Status siyahısının yanındakı dairəvi ox (<HelpKey>Yenilə</HelpKey>) ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl ən son məlumatla yenidən yüklənir və saylar sıfırdan yenidən hesablanır. Bu düymədə
            yalnız ikon var, mətn yoxdur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cədvəldə görünəndən daha çox plan varsa, ən aşağıda <HelpKey>Daha çox yüklə</HelpKey>{" "}
            düyməsi çıxır. Növbəti dəstəni gətirmək üçün onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti planlar cari siyahının sonuna əlavə olunur (cədvəl sıfırlanmır). Yükləmə gedərkən
            düymə qısa müddət deaktiv olur. Daha çox plan qalmadıqda düymə görünmür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Cədvəl planları başlama tarixinə görə (ən yenidən ən köhnəyə) sıralayır. <strong>Plan Adı</strong>,{" "}
          <strong>Status</strong> və <strong>Başlama Tarixi</strong> sütun başlıqları sıralana biləndir —
          başqa nizamla baxmaq üçün onlara klikləyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifədə plan <strong>yaratmaq və ya redaktə etmək imkanı yoxdur</strong> — yalnız
          mövcud planların icmalıdır. Statuslar (qaralama → aktiv → dayandırıldı/tamamlandı/ləğv edildi)
          başqa axın vasitəsilə dəyişdirilir; bu ekran sadəcə nəticəni əks etdirir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün planlar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın müalicə planlarını
          görürsünüz. Müalicə planları xəstə sağlamlıq məlumatıdır (PHI): planın izahı (description)
          bazada təşkilata bağlı şəkildə <strong>şifrələnir</strong> və bu səhifədə göstərilmir, hər
          oxuma isə uyğunluq (compliance) jurnalına yazılır.
        </p>
      </HelpCallout>
    </div>
  )
}
