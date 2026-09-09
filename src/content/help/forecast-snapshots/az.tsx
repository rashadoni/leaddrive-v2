"use client"

/**
 * Forecast Snapshots — help article (Azerbaijani).
 * Köhnə birləşik "forecast" məqaləsindən ayrılıb: yalnız
 * /forecast/snapshots səhifəsinin mövzusu — proqnozu dondurub
 * dövrün sonunda faktla müqayisə etmək.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function forecastsnapshotsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri və ya rəhbərisən"
        goal="Bugünkü proqnozu dondur ki, dövr bağlananda nə qədər haqlı olduğunu ölçə biləsən"
      >
        Səhifə avtomatik açılır və təşkilatının bütün açıq sövdələrini oxuyur.
        Anlıq görüntü çəkmək hamı üçün mümkündür; əvvəlcədən bir şey qurmaq
        lazım deyil. Bütün rəqəmlər yalnız öz tenant-ının sövdələrindən gəlir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <strong>Proqnoz anlıq görüntüləri</strong> başlığı (qrafik
          ikonu ilə) və qısa izah var. Sağ küncdə <HelpKey>Anlıq görüntü çək</HelpKey>{" "}
          düyməsi dayanır. Aşağıda bir cədvəl bütün çəkilmiş anlıq görüntüləri
          sadalayır, ən yenisi yuxarıda. Cədvəlin altında üç sətirlik izahat hər
          sütunun necə hesablandığını açıqlayır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Yaradılıb">
            Anlıq görüntünün çəkildiyi tarix və vaxt.
          </HelpDef>
          <HelpDef term="Dövr">
            Anlıq görüntünün əhatə etdiyi vaxt aralığı, başlanğıc → son
            formatında.
          </HelpDef>
          <HelpDef term="Təsdiqlənmiş">
            Ehtimalı ≥90% olan mərhələlərdəki sövdələrin cəmi (məs. WON,
            COMMITTED). Altında həmin sövdələrin sayı yazılır.
          </HelpDef>
          <HelpDef term="Ən yaxşı ssenari">
            Ehtimalı ≥70% olan mərhələlərdəki sövdələr (təsdiqlənmiş daxil).
            Altında sövdə sayı yazılır.
          </HelpDef>
          <HelpDef term="Proqnoz">
            Bütün açıq sövdələrin ehtimal-çəkili cəmi — qalın şriftlə, əsas
            rəqəm budur.
          </HelpDef>
          <HelpDef term="Sövdələr">
            Anlıq görüntüyə daxil olan ümumi sövdə sayı.
          </HelpDef>
        </dl>
        <p>
          Hər sətrin sonunda kiçik <strong>zibil qutusu</strong> ikonu var — o
          anlıq görüntünü silir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: anlıq görüntü çək">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Anlıq görüntü çək</HelpKey> düyməsini bas. O,
            bütün təşkilatı cari dövr üçün qeyd edir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddət <strong>Yaradılır…</strong> yazısına və fırlanan
            ikona keçir. Bitəndə yaşıl uğur lövhəsi çıxır:{" "}
            <em>«Anlıq görüntü çəkildi: N sövdə təhlil edildi, proqnoz X»</em> —
            yəni neçə sövdənin hesablandığını və alınan proqnoz məbləğini dərhal
            görürsən.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cədvələ bax — yeni anlıq görüntü ən yuxarı sətir kimi görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətirdə yaradılma tarixi-vaxtı, əhatə olunan dövr, təsdiqlənmiş, ən
            yaxşı ssenari və proqnoz məbləğləri, həmçinin ümumi sövdə sayı
            görünür. Təsdiqlənmiş və ən yaxşı ssenari xanalarının altında həmin
            kateqoriyaya düşən sövdə sayı kiçik mətnlə yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Səhifə ilk dəfə açılanda və ya hələ heç bir anlıq görüntü yoxdursa,
            cədvəl boş vəziyyət göstərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəlin ortasında <em>«Anlıq görüntü hələ yoxdur.»</em> mesajı və
            altında «cari satış boru xətti vəziyyətini qeyd etmək üçün anlıq
            görüntü çək» tövsiyəsi görünür. Yüklənmə zamanı isə fırlanan ikon və{" "}
            <strong>Yüklənir…</strong> yazısı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: anlıq görüntünü sil">
        <HelpStep n={1}>
          <p>
            Silmək istədiyin sətrin sonundakı <HelpKey>Sil</HelpKey> (zibil
            qutusu) ikonunu bas.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer təsdiq pəncərəsi açılır:{" "}
            <em>«Bu proqnoz anlıq görüntüsünü silmək? Bu geri qaytarıla
            bilməz.»</em>
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Təsdiqi qəbul et.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətir cədvəldən yox olur və siyahı yenilənir. Əgər nəsə alınmasa,
            yuxarıda qırmızı xəta lövhəsi (xəbərdarlıq ikonu ilə) çıxar.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Proqnozu təsdiqlədiyin və ya rüb-ortası baxış keçirdiyin hər dəfə bir
          anlıq görüntü çək. Dövr bağlananda həmin sətirlərin proqnoz məbləğini
          faktiki qazanılan gəlirlə müqayisə et — bu, proqnozlaşdırmanın nə qədər
          dəqiq olduğunu göstərən yeganə dürüst ölçüdür.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Silmə geri qaytarıla bilməz — silinmiş anlıq görüntü tarixi məlumat
          kimi itir. Dəqiqlik ölçməsi keçmiş anlıq görüntülərə əsaslandığı üçün,
          tələsik silmə dövrlərarası müqayisəni pozur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün anlıq görüntülər təşkilatınla məhdudlaşır — yalnız öz tenant-ının
          açıq sövdələrini oxuyur və başqa təşkilatların heç bir məlumatını
          göstərmir.
        </p>
      </HelpCallout>
    </div>
  )
}
