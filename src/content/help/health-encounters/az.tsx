"use client"

/**
 * Healthcare → Encounters (Ziyarətlər) — help article (Azerbaijani).
 *
 * Bu səhifə "Healthcare" şaquli modulunun alt-bölməsidir və əvvəllər
 * ümumi şaquli məqaləni paylaşırdı; indi öz məqaləsini alır. Yalnız
 * src/app/(dashboard)/health/encounters/page.tsx səhifəsini təsvir edir:
 * statistika kartları, status filtri, yeniləmə düyməsi, 5 sütunlu cədvəl
 * və "Daha çox yüklə". Bu səhifə YALNIZ baxış/filtrlə üçündür — burada
 * ziyarət yaratma/redaktə/silmə forması YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function healthencountersHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Klinika əməliyyat işçisi və ya səhiyyə koordinatorusunuz"
        goal="Bütün xəstələr üzrə klinik ziyarətlərə bir yerdə baxmaq, status üzrə filtrləmək və lazımi qeydi tapmaq"
      >
        Səhifəyə <HelpKey>Healthcare</HelpKey> → <HelpKey>Ziyarətlər</HelpKey> bölməsi ilə çatırsınız.
        Bu səhifə yalnız <strong>baxış və filtrləmə</strong> üçündür — burada ziyarət yaratmaq,
        redaktə etmək və ya silmək üçün düymə yoxdur. Bütün ziyarətlər yalnız sizin
        təşkilatınıza aiddir. Açılanda siyahı avtomatik yüklənir; sonradan filtri dəyişdikcə və ya
        yeniləmə düyməsini basdıqca yenidən oxunur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda bənövşəyi lövhəcik ikonası ilə <HelpKey>Ziyarətlər</HelpKey> adı və altında
          «Bütün xəstələr üzrə klinik ziyarətlər.» izahı var. Altda dörd statistika kartı durur:{" "}
          <strong>Ümumi Ziyarət</strong>, <strong>Planlaşdırılmış</strong>,{" "}
          <strong>Tamamlanmış</strong> və <strong>Gəlmədi</strong>. Onların altında bir status
          açılan siyahısı ilə yeniləmə düyməsi, daha aşağıda isə beş sütunlu cədvəl və lazım gəldikdə{" "}
          <HelpKey>Daha çox yüklə</HelpKey> düyməsi gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Ziyarət">Hazırda yüklənmiş səhifədəki ziyarətlərin sayı (bütün baza üzrə cəm deyil — aşağıdakı qeydə baxın).</HelpDef>
          <HelpDef term="Planlaşdırılmış">Yüklənmiş ziyarətlər arasında «Planlaşdırılmış» statuslu olanların sayı.</HelpDef>
          <HelpDef term="Tamamlanmış">Yüklənmiş ziyarətlər arasında «Tamamlandı» statuslu olanların sayı.</HelpDef>
          <HelpDef term="Gəlmədi">Yüklənmiş ziyarətlər arasında «Gəlmədi» statuslu olanların sayı.</HelpDef>
          <HelpDef term="Növ">Ziyarətin növü — Şəxsi, Telesəhiyyə, Telefon, Ev Ziyarəti və ya Stasionar.</HelpDef>
          <HelpDef term="Status">Ziyarətin hazırkı vəziyyəti: Planlaşdırılmış, Qeydiyyatdan keçdi, Davam edir, Tamamlandı, Ləğv edildi və ya Gəlmədi — rəngli nişanla göstərilir.</HelpDef>
          <HelpDef term="Tarix">Planlaşdırılmış başlama tarixi; tarix yoxdursa «—» göstərilir.</HelpDef>
          <HelpDef term="Yer">Ziyarətin keçirildiyi yer (klinika otağı və ya telesəhiyyə keçidi); boşdursa «—».</HelpDef>
          <HelpDef term="Səbəb">Ziyarətin səbəbi/məqsədi; bir sətirə qədər qısaldılır, boşdursa «—».</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları soldan sağa: <strong>Növ</strong>, <strong>Status</strong>,{" "}
          <strong>Tarix</strong>, <strong>Yer</strong> və <strong>Səbəb</strong>. <strong>Növ</strong>,{" "}
          <strong>Status</strong> və <strong>Tarix</strong> sütunlarını başlığa toxunaraq sıralaya
          bilərsiniz; <strong>Yer</strong> və <strong>Səbəb</strong> sıralanmır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: status üzrə filtrlə">
        <HelpStep n={1}>
          <p>
            Statistika kartlarının altındakı açılan siyahını açın — standart olaraq orada{" "}
            <HelpKey>Bütün statuslar</HelpKey> yazılıb.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda altı status sıralanır: <strong>Planlaşdırılmış</strong>,{" "}
            <strong>Qeydiyyatdan keçdi</strong>, <strong>Davam edir</strong>,{" "}
            <strong>Tamamlandı</strong>, <strong>Ləğv edildi</strong> və <strong>Gəlmədi</strong>,
            bir də ən üstdə <strong>Bütün statuslar</strong> seçimi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Bir status seçin — məsələn <HelpKey>Planlaşdırılmış</HelpKey>.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal yenidən yüklənir və yalnız seçdiyiniz statuslu ziyarətləri göstərir.
            Statistika kartları da yenidən hesablanır. Yenidən <strong>Bütün statuslar</strong>{" "}
            seçməklə filtri sıfırlaya bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahını yenilə və daha çox yüklə">
        <HelpStep n={1}>
          <p>
            Ən son qeydləri görmək üçün açılan siyahının yanındakı yeniləmə (dairəvi ox) ikonalı{" "}
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl baş hissədən yenidən oxunur (cari statusu saxlayaraq) və statistika kartları
            yenilənmiş sayları göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Daha çox qeyd varsa, cədvəlin altındakı <HelpKey>Daha çox yüklə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti ziyarətlər mövcud siyahının sonuna əlavə olunur. Yüklənmə gedərkən düymə müvəqqəti
            söndürülür. Daha qeyd qalmadıqda <HelpKey>Daha çox yüklə</HelpKey> düyməsi tamamilə yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Statistika kartlarındakı saylar <strong>hazırda yüklənmiş səhifəyə</strong> əsaslanır,
          bütün bazaya yox. <HelpKey>Daha çox yüklə</HelpKey> ilə yeni səhifə əlavə etdikdə kartlar
          yenidən hesablanmır — onlar ilk yükləmənin (və ya filtrin) anındakı şəkli əks etdirir.
          Bütün statusların paylanmasını tam görmək üçün filtri ayrı-ayrı statuslara dəyişib müqayisə edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifədə ziyarət <strong>yaratmaq, redaktə etmək və ya silmək</strong> üçün düymə
          yoxdur — yalnız baxış və status filtri var. Həmçinin sərbəst mətnlə axtarış sahəsi də
          yoxdur: yeganə filtr statusdur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün ziyarətlər təşkilatınızla məhdudlaşır və başqa tenant-ın qeydlərini görmürsünüz. Hər
          baxış HIPAA «minimum-zəruri» audit qeydini tetikləyir.{" "}
          <strong>Yer</strong> və <strong>Səbəb</strong> sütunları bazada şifrələnmiş (column-bound)
          saxlanılır və yalnız təşkilatınızın açarı ilə oxunaqlı şəkildə göstərilir; məhz buna görə bu
          iki sahə üzrə filtr/axtarış mövcud deyil — filtr yalnız şifrələnməmiş <strong>status</strong>{" "}
          sütunu üzrə işləyir.
        </p>
      </HelpCallout>
    </div>
  )
}
