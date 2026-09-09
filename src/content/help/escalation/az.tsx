"use client"

/**
 * Escalation Rules — help article (Azerbaijani).
 * Tənzimləmələr → Eskalasiya Qaydaları səhifəsini əhatə edir:
 * SLA müddətləri pozulduqda (və ya pozulmamışdan əvvəl) tiketləri
 * avtomatik eskalə edən qaydaların yaradılması, aktiv/deaktiv
 * vəziyyəti və silinməsi. Real UI: başlıq + «Yeni Qayda» düyməsi,
 * boş vəziyyət, qayda cədvəli (Səviyyə/Qayda Adı/Tetikleyici/
 * Əməliyyatlar/Status), yaratma forması (Dialog) və silmə təsdiqi.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EscalationHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək rəhbəri və ya əməliyyat administratorusunuz"
        goal="SLA müddətləri pozulduqda (və ya pozulmamışdan əvvəl) tiketlərin avtomatik eskalə olunması üçün qaydalar qurmaq — menecerlərə bildiriş, prioritetin artırılması və ya tiketin yenidən təyini"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Eskalasiya Qaydaları</HelpKey> yolu ilə
        çatırsınız. Bütün qaydalar yalnız sizin təşkilatınız üçündür. Bu qaydalar SLA (xidmət
        səviyyəsi razılaşması) müddətlərinə bağlıdır — yəni əvvəlcədən tiket SLA-larınızın qurulmuş
        olması nəzərdə tutulur, bu səhifə isə həmin müddətlər pozulanda nə baş verəcəyini təyin edir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Eskalasiya Qaydaları</HelpKey> adı, altında «SLA müddətləri pozulduqda
          avtomatik eskalasiya konfiqurasiyası» izahı, sağ yuxarıda isə <HelpKey>Yeni Qayda</HelpKey>{" "}
          düyməsi var. Hələ heç bir qayda yoxdursa, mərkəzdə xəbərdarlıq ikonalı boş vəziyyət
          görünür: «Eskalasiya qaydası yoxdur» başlığı, qısa izah və <HelpKey>İlk Qaydanı Yarat</HelpKey>{" "}
          düyməsi. Ən azı bir qayda varsa, onun yerinə axtarış sahəsi olan cədvəl gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Səviyyə">Eskalasiyanın dərinliyi — 1-dən 5-ə qədər. Cədvəldə rəngli nişanla göstərilir (məs. L1 sarı, L3 və yuxarısı qırmızı çalarlarda).</HelpDef>
          <HelpDef term="Tetikleyici (Tetikleyici Növ)">Qaydanı işə salan hadisə: İlk Cavab Pozuntusu, Həll Pozuntusu və ya Həll Xəbərdarlığı.</HelpDef>
          <HelpDef term="İlk Cavab Pozuntusu">Tiketə vaxtında ilk cavab verilmədikdə işə düşür.</HelpDef>
          <HelpDef term="Həll Pozuntusu">Tiket SLA həll müddəti ərzində bağlanmadıqda işə düşür.</HelpDef>
          <HelpDef term="Həll Xəbərdarlığı">Həll müddəti POZULMAMIŞDAN əvvəl, profilaktik olaraq işə düşür.</HelpDef>
          <HelpDef term="Əməliyyatlar">Qayda işə düşəndə görüləcək iş: Bildiriş, Prioriteti Artır və ya Tiketi Yenidən Təyin Et.</HelpDef>
          <HelpDef term="Status">Qaydanın Aktiv / Deaktiv vəziyyəti — cədvəldə nişana klikləməklə dəyişir.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları soldan sağa: <strong>Səviyyə</strong> (L1–L5 nişanı), <strong>Qayda Adı</strong>,{" "}
          <strong>Tetikleyici</strong> (növün adı, dəqiqə təyin edilibsə yanında «(N min)»),{" "}
          <strong>Əməliyyatlar</strong> (hər əməliyyat ayrıca nişan kimi, bildirişdə hədəf mötərizədə),{" "}
          <strong>Status</strong> (kliklənə bilən yaşıl <strong>Aktiv</strong> / boz <strong>Deaktiv</strong>{" "}
          nişanı) və sonda silmə üçün zibil qutusu ikonalı düymə.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni eskalasiya qaydası yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni Qayda</HelpKey> düyməsini basın. (Heç qayda yoxdursa, boş
            vəziyyətdəki <HelpKey>İlk Qaydanı Yarat</HelpKey> düyməsi də eyni formanı açır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Eskalasiya Qaydası Yarat» başlıqlı pəncərə açılır. İçində <strong>Qayda Adı *</strong>{" "}
            sahəsi, yan-yana <strong>Tetikleyici Növ</strong> və <strong>Eskalasiya Səviyyəsi (1-5)</strong>,
            altında dəqiqə sahəsi, daha sonra <strong>Əməliyyat</strong> seçimi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Qayda Adı</strong> yazın — bu yeganə məcburi sahədir. Nümunə mətn göstərir:
            «məs. L1 — İlk cavab pozuntusu zamanı meneceri xəbərdar et».
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahədə görünür. Adı boş buraxıb yaratmağa çalışsanız, brauzerin məcburi-sahə
            yoxlaması formanı təqdim etməyə qoymur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Tetikleyici Növ</strong> açılan siyahısından birini seçin: <HelpKey>İlk Cavab Pozuntusu</HelpKey>,{" "}
            <HelpKey>Həll Pozuntusu</HelpKey> və ya <HelpKey>Həll Xəbərdarlığı</HelpKey>. Yanındakı{" "}
            <strong>Eskalasiya Səviyyəsi</strong> sahəsinə 1–5 arası rəqəm daxil edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səviyyə sahəsi yalnız rəqəm qəbul edir və 1 ilə 5 arasında məhdudlaşır. Seçilən növ
            aşağıdakı dəqiqə sahəsinin etiketini dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Dəqiqə sahəsini doldurun. <strong>Həll Xəbərdarlığı</strong> seçmisinizsə, etiket
            «SLA pozuntusundan əvvəl dəqiqə» olur; digər iki növdə isə «SLA pozuntusundan sonra dəqiqə» olur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahənin altındakı kiçik ipucu növə görə dəyişir: xəbərdarlıq üçün «SLA müddətindən neçə
            dəqiqə əvvəl bu qayda işə düşəcək», pozuntu üçün «0 = pozuntu zamanı dərhal, və ya
            pozuntudan sonra dəqiqə gecikmə».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            <strong>Əməliyyat</strong> seçin: <HelpKey>Bildiriş</HelpKey>, <HelpKey>Prioriteti Artır</HelpKey>{" "}
            və ya <HelpKey>Tiketi Yenidən Təyin Et</HelpKey>. <HelpKey>Bildiriş</HelpKey> seçsəniz, yanında
            <strong> Kimə bildiriş</strong> açılan siyahısı görünür — <HelpKey>Menecerlər</HelpKey> və ya{" "}
            <HelpKey>Yalnız Adminlər</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Kimə bildiriş» sahəsi yalnız əməliyyat <strong>Bildiriş</strong> olduqda peyda olur;
            <strong> Prioriteti Artır</strong> və ya <strong>Tiketi Yenidən Təyin Et</strong> seçəndə
            o sahə yox olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Aşağıdakı <HelpKey>Qayda Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> düyməsi ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlanarkən düymə fırlanan ikona ilə «Yaradılır...» yazısına keçir; uğurlu olduqda pəncərə
            bağlanır və yeni qayda cədvəldə peyda olur. Xəta olarsa, formanın yuxarısında qırmızı xəta
            mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qaydanı aktiv/deaktiv et və ya sil">
        <HelpStep n={1}>
          <p>
            Bir qaydanı müvəqqəti söndürmək (və ya yenidən işə salmaq) üçün cədvəldəki{" "}
            <strong>Status</strong> sütununda nişana klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nişan yaşıl <strong>Aktiv</strong> ilə boz <strong>Deaktiv</strong> arasında keçir.
            Dəyişiklik dərhal yadda saxlanılır — ayrıca təsdiq tələb olunmur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qaydanı büsbütün silmək üçün həmin sətrin sonundakı zibil qutusu ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Eskalasiya Qaydası Sil» başlıqlı təsdiq pəncərəsi açılır və qaydanın həmişəlik
            silinəcəyini, əməliyyatın geri qaytarılmayacağını xəbərdar edir. <HelpKey>Ləğv et</HelpKey>{" "}
            və ya <HelpKey>Sil</HelpKey> seçimləri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Sil</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Silinir...» yazısına keçir, sonra pəncərə bağlanır və qayda cədvəldən çıxır. Silmə
            alınmasa, təsdiq pəncərəsində qırmızı xəta mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır. Qaydanı sadəcə müvəqqəti dayandırmaq istəyirsinizsə, silmək yerinə{" "}
            <strong>Status</strong> nişanını <strong>Deaktiv</strong> vəziyyətinə keçirin — qayda
            siyahıda qalır, sadəcə işə düşmür.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Adı oxunaqlı qurun ki, cədvəldə bir baxışla anlaşılsın — nümunədəki kimi səviyyə + tetikleyici +
          əməliyyatı ada daxil edin (məs. «L1 — İlk cavab pozuntusu zamanı meneceri xəbərdar et»).
          Eyni hadisə üçün artan səviyyələrlə bir neçə qayda qurub mərhələli eskalasiya zənciri yarada
          bilərsiniz.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün eskalasiya qaydaları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın qaydalarını
          görür və idarə edirsiniz. Bildiriş hədəfləri (Menecerlər / Yalnız Adminlər) də təşkilatınızın
          istifadəçilərinə tətbiq olunur.
        </p>
      </HelpCallout>
    </div>
  )
}
