"use client"

/**
 * Energy & Utilities → Sayğac Nöqtələri — help article (Azerbaijani).
 *
 * "energy-detail" ümumi şaquli məqaləsindən ayrılıb: yalnız
 * Energetika → Sayğac Nöqtələri səhifəsini əhatə edir
 * (sayğac inventarı siyahısı, statistika kartları, status filtri,
 * seriya nömrəsi axtarışı, "Daha çox yüklə" səhifələmə).
 *
 * DİQQƏT: Bu səhifə YALNIZ-OXUMA inventardır — burada sayğac
 * yaratma/redaktə/silmə UI-ı YOXDUR. Yeni sayğac nöqtələri API
 * vasitəsilə (provisioning) yaranır, bu ekranda deyil.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energymeteringHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Kommunal əməliyyat və ya sahə xidməti administratorusunuz"
        goal="Təşkilatınızın sayğac parkını gözdən keçirmək — hansı sayğacların aktiv, ayrılmış və ya quraşdırma gözlədiyini tapmaq və konkret bir sayğac nömrəsini axtarmaq"
      >
        Səhifəyə <HelpKey>Energetika</HelpKey> bölməsinin <HelpKey>Sayğac Nöqtələri</HelpKey> alt-səhifəsi
        ilə çatırsınız. Bütün sayğaclar yalnız sizin təşkilatınız üçündür. Bu səhifə{" "}
        <strong>yalnız oxuma</strong> inventarıdır — burada sayğac yaratma, redaktə və ya silmə düyməsi
        yoxdur; siyahını gözdən keçirə, filtrləyə və axtara bilərsiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda alov ikonası ilə birlikdə <HelpKey>Sayğac Nöqtələri</HelpKey> adı və altında
          «Kommunal sayğac inventarı — aktiv, ayrılmış və quraşdırılma gözləyənlər» izahı var. Altda
          dörd statistika kartı, sonra axtarış və filtr zolağı, daha aşağıda isə sayğac cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi sayğaclar">
            Cədvələ yüklənmiş sayğacların sayı. Diqqət: bu say o anda yüklənmiş partiyaya əsaslanır
            (ilk açılışda 50 sətir), bütün təşkilat üzrə ümumi rəqəm deyil.
          </HelpDef>
          <HelpDef term="Aktiv">Hazırda «Aktiv» statusunda olan sayğaclar.</HelpDef>
          <HelpDef term="Ayrıldı">«Ayrıldı» (disconnected) statusunda olan sayğaclar.</HelpDef>
          <HelpDef term="Status">
            Sayğacın həyat dövrü: <strong>Quraşdırma gözlənilir</strong>, <strong>Aktiv</strong>,{" "}
            <strong>Ayrıldı</strong> və ya <strong>Silinib</strong>. Cədvəldə rəngli nişan kimi görünür.
          </HelpDef>
          <HelpDef term="Seriya №">Sayğacın fiziki seriya nömrəsi (mono şriftlə göstərilir).</HelpDef>
          <HelpDef term="Resurs">
            Sayğacın ölçdüyü kommunal növ — Elektrik, Qaz və ya Su.
          </HelpDef>
          <HelpDef term="Quraşdırma tarixi">Sayğacın quraşdırıldığı tarix; boşdursa «—» göstərilir.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>Seriya №</strong>, <strong>Status</strong>, <strong>Resurs</strong>{" "}
          və <strong>Quraşdırma tarixi</strong>. Status sütununda hər sayğac öz rənginə görə nişanlanır:
          gözləyən mavi, aktiv yaşıl, ayrılmış sarı, silinmiş boz.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: statusa görə süz">
        <HelpStep n={1}>
          <p>
            Axtarış zolağındakı status açılan siyahısını açın — standart olaraq{" "}
            <HelpKey>Bütün statuslar</HelpKey> seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda «Bütün statuslar» ardınca dörd seçim görünür:{" "}
            <strong>Quraşdırma gözlənilir</strong>, <strong>Aktiv</strong>, <strong>Ayrıldı</strong> və{" "}
            <strong>Silinib</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Bir statusu seçin (məsələn, <HelpKey>Aktiv</HelpKey>).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal yenidən yüklənir və yalnız seçilmiş statusdakı sayğacları göstərir.
            Statistika kartları da yenidən hesablanmış partiyaya görə yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Filtri sıfırlamaq üçün yenidən <HelpKey>Bütün statuslar</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl bütün statuslardan ən yeni sayğaclarla yenidən dolur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sayğac nömrəsi ilə axtar">
        <HelpStep n={1}>
          <p>
            Sol tərəfdəki, lupa ikonalı axtarış qutusuna klikləyin. Yer tutucusu{" "}
            <HelpKey>Hesab nömrəsi ilə axtar…</HelpKey> yazır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qutu fokuslanır və yazmağa hazır olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtarış mətnini yazın. Axtarış sayğacın <strong>seriya nömrəsi</strong> üzrə işləyir və ən
            azı <strong>2 simvol</strong> tələb edir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırdıqdan təxminən yarım saniyə sonra cədvəl avtomatik yenilənir (hər hərfdə
            deyil — kiçik gecikmə ilə) və seriya nömrəsi yazdığınız mətni ehtiva edən sayğacları
            göstərir. Uyğunluq böyük/kiçik hərfə həssas deyil.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Axtarışı təmizləmək üçün qutudakı mətni silin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yenidən bütün sayğacları (filtr varsa, ona uyğun olanları) göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Yer tutucu «Hesab nömrəsi ilə axtar…» yazsa da, axtarış əslində sayğacın{" "}
            <strong>seriya nömrəsi</strong> üzrə uyğunluq tapır, hesab (müştəri) nömrəsi üzrə yox. Hesab
            nömrəsinə görə axtarış bu qutudan etibarlı nəticə verməyəcək.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: yenilə və daha çox sayğac yüklə">
        <HelpStep n={1}>
          <p>
            Cari görünüşü yeniləmək üçün filtr zolağının sağındakı yeniləmə (dairəvi ox) düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl serverdən yenidən yüklənir və mövcud filtr/axtarışa uyğun ən yeni siyahını göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyahıda göstəriləndən çox sayğac varsa, cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey>{" "}
            düyməsi görünür. Növbəti partiyanı gətirmək üçün onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti sayğaclar mövcud siyahının altına əlavə olunur (sıfırdan əvəzlənmir). Daha sətir
            qalmadıqda düymə yox olur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Statistika kartları (<strong>Ümumi sayğaclar</strong>, <strong>Aktiv</strong>,{" "}
            <strong>Ayrıldı</strong>) yalnız ilk yüklənmiş partiya üçün hesablanır və{" "}
            <HelpKey>Daha çox yüklə</HelpKey> ilə əlavə yükləyəndə dəyişmir. Buna görə kartları bütün
            təşkilatın dəqiq cəmi kimi deyil, cari ekranın xülasəsi kimi qəbul edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Bütün sayğac nöqtələri təşkilatınızla məhdudlaşır — başqa tenant-ların inventarını görmürsünüz.
          Sayğac qeydləri PII-yə yaxın məlumat (xidmət yerinin koordinatları) daşıyır, ona görə bu
          siyahıya hər giriş audit jurnalına yazılır. Səhifəni açmaq üçün <em>oxuma</em> icazəsi
          lazımdır; siyahı yalnız-oxumadır, ona görə burada heç nəyi təsadüfən silə bilməzsiniz.
        </p>
      </HelpCallout>
    </div>
  )
}
