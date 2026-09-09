"use client"

/**
 * Contract Intake Forms — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Müqavilə sorğu formaları səhifəsini əhatə edir
 * (forma yaratma, suallar, müqavilə sahəsinə bağlama, standart təsdiq
 * mərhələləri, aktiv/qeyri-aktiv vəziyyət, deaktivasiya). Səhifədə yalnız
 * admin/superadmin redaktə düymələrini görür.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function IntakeFormsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Administrator və ya əməliyyat menecerisiniz"
        goal="İstifadəçilərin müqavilə sorğusu üçün dolduracağı formanı qurmaq — suallar, müqavilə sahələrinə bağlama və standart təsdiq mərhələləri ilə"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Müqavilə sorğu formaları</HelpKey> yolu ilə
        çatırsınız. Bütün formalar yalnız sizin təşkilatınız üçündür. Forma yaratmaq, redaktə etmək və
        deaktiv etmək düymələri yalnız <strong>admin</strong> və ya <strong>superadmin</strong> rolunda
        görünür — başqa rollar siyahını oxuya bilir, lakin dəyişiklik düymələri olmur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda sola qayıtmaq üçün ox, sonra forma ikonu ilə <HelpKey>Müqavilə sorğu formaları</HelpKey>{" "}
          başlığı və altında «İstifadəçilərin müqavilə sorğusu üçün dolduracağı formaları konfiqurasiya
          edin» izahı var. Adminsinizsə, sağ yuxarıda <HelpKey>Yeni forma</HelpKey> düyməsi durur. Bunun
          altında mövcud formalar iki sütunlu kartlar şəklində sıralanır — heç forma yoxdursa, bunun
          yerinə boş vəziyyət kartı göstərilir. Yükləmə və ya saxlama xətası olarsa, yuxarıda qırmızı
          xəbərdarlıq zolağı çıxır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Forma (sorğu forması)">İstifadəçilərin müqavilə tələb etmək üçün dolduracağı sual dəsti. Hər göndərilən forma müqavilə qaralaması (draft) yaradır.</HelpDef>
          <HelpDef term="Sual">Formadakı bir doldurma sahəsi — mətni (etiketi), növü, məcburi olub-olmaması var.</HelpDef>
          <HelpDef term="Müqavilə sahəsinə bağlama">Sualın cavabını birbaşa müqavilənin bir sahəsinə (başlıq, məbləğ, valyuta, qeydlər, növ) köçürmək üçün təyinat.</HelpDef>
          <HelpDef term="Standart müqavilə növü">Bu formadan yaranan müqaviləyə əvvəlcədən qoyulan növ (xidmət müqaviləsi, NDA, texniki xidmət, lisenziya, SLA, digər).</HelpDef>
          <HelpDef term="Standart təsdiq mərhələləri">Göndərilmiş müqavilənin avtomatik keçəcəyi təsdiq addımlarının siyahısı — hər mərhələnin adı, məsul rolu və SLA saatı olur.</HelpDef>
          <HelpDef term="Müraciət (göndərmə)">Formanın doldurulub göndərilməsi; kartda bu formaya gələn müraciətlərin sayı göstərilir.</HelpDef>
          <HelpDef term="Qeyri-aktiv">Deaktiv edilmiş forma — yeni müraciət qəbul etmir, lakin mövcud müraciətlər saxlanılır.</HelpDef>
        </dl>
        <p>
          Hər forma kartında ad, yanında varsa <strong>Qeyri-aktiv</strong> nişanı və müqavilə növü
          nişanı, varsa açıqlama (bir sətir), bir sətirdə isə <strong>«N sual · M müraciət»</strong>{" "}
          xülasəsi olur. Adminsinizsə, sağda qələm ikonalı redaktə düyməsi və — yalnız forma aktivdirsə —
          qırmızı zibil qutusu ikonalı deaktivasiya düyməsi görünür. Qeyri-aktiv kart bir az soluq
          (yarı-şəffaf) göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni forma yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni forma</HelpKey> düyməsini basın. (Heç forma yoxdursa, boş
            vəziyyətdəki <HelpKey>İlk formanı yaradın</HelpKey> düyməsi də eyni pəncərəni açır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni forma» başlıqlı geniş pəncərə açılır. Yuxarıda əsas məlumat sahələri:{" "}
            <strong>Forma adı *</strong>, <strong>Açıqlama (isteğe bağlı)</strong>,{" "}
            <strong>Standart müqavilə növü</strong> açılan siyahısı və <strong>Aktiv</strong> açarı
            (standart olaraq yandırılmış). Altda «Sual» və «Standart təsdiq mərhələləri» bölmələri gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Forma adı</strong> yazın — bu yeganə məcburi sahədir (məs. «Xidmət müqaviləsi
            sorğusu»). İstəsəniz qısa <strong>Açıqlama</strong> əlavə edin və{" "}
            <strong>Standart müqavilə növü</strong> seçin (boş buraxsanız «İstənilən növ» qalır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahələrdə görünür. Ad boşdursa, aşağıdakı <HelpKey>Saxla</HelpKey> düyməsi
            qeyri-aktiv (basılmaz) qalır. Müqavilə növü açılan siyahısında <em>İstənilən növ</em> və
            standart növlər (service_agreement, nda, maintenance, license, sla, other) var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Sual</strong> bölməsində <HelpKey>Sual əlavə et</HelpKey> düyməsini basın. Hər sual
            üçün <strong>Sual mətni *</strong> yazın, <strong>Növ</strong> seçin (mətn, çoxsətirli,
            rəqəm, tarix, seçim), istəsəniz <strong>Müqavilə sahəsinə bağla</strong> təyin edin və lazım
            olduqda <strong>Məcburi</strong> açarını yandırın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sual ayrıca kartda görünür — solda tutma ikonu, içində mətn sahəsi, iki açılan siyahı və
            <strong>Məcburi</strong> açarı, sağda isə sualı silən qırmızı zibil qutusu ikonu. Növü{" "}
            <em>seçim</em> qoysanız, əlavə <strong>Seçimlər (vergüllə ayrılmış)</strong> sahəsi peyda
            olur. Heç sual yoxdursa «Hələ sual yoxdur.» yazısı durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <strong>Standart təsdiq mərhələləri</strong> əlavə edin:{" "}
            <HelpKey>Mərhələ əlavə et</HelpKey> basın, hər sətirdə mərhələnin adını yazın, məsul rolu
            (admin / manager / member) seçin və <strong>SLA saat</strong> daxil edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bölmənin başında «İsteğe bağlı. Göndərilmiş müqavilə avtomatik marşrutlaşdırılır.» ipucusu
            durur. Hər mərhələ nömrələnmiş sətir kimi əlavə olunur (1., 2., …): ad sahəsi, rol açılan
            siyahısı, SLA saat sahəsi (yalnız rəqəm) və silmə ikonu.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlanarkən düymədə fırlanan yükləmə ikonu görünür. Uğurlu olduqda pəncərə bağlanır və yeni
            forma siyahıda peyda olur (başlanğıcda «0 sual · 0 müraciət» və ya doldurduğunuz sual sayı
            ilə). Xəta olsa, pəncərə açıq qalır və yuxarıda qırmızı xəbərdarlıq zolağı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: formanı redaktə et">
        <HelpStep n={1}>
          <p>
            Dəyişmək istədiyiniz forma kartında qələm ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Formanı redaktə et» başlıqlı, mövcud ad, açıqlama, müqavilə növü, vəziyyət, suallar və
            mərhələlərlə əvvəlcədən doldurulmuş eyni pəncərə açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Lazımi sahələri dəyişin — sual əlavə edin və ya silin, sıralama ikonlu kartları yenidən
            düzün, sonra <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dəyişikliklər saxlandıqdan sonra pəncərə bağlanır və kartdakı ad, nişanlar və{" "}
            «sual · müraciət» xülasəsi yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: formanı deaktiv et">
        <HelpStep n={1}>
          <p>
            Aktiv formanın kartında qırmızı zibil qutusu ikonalı düyməni basın. (Bu düymə yalnız forma
            aktiv olduqda görünür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Formanı deaktiv etmək istirsiniz? Mövcud müraciətlər saxlanılır.» mətni ilə brauzer təsdiq
            pəncərəsi açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma <strong>Qeyri-aktiv</strong> nişanı alır, kart bir az solur və zibil qutusu düyməsi
            yox olur (deaktiv formanı kartdan deaktiv etmək olmaz). Müraciət sayı dəyişməz qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Sualı müqavilə sahəsinə bağlamaq vacib məqamdır:{" "}
          <HelpKey>Müqavilə sahəsinə bağla</HelpKey> ilə cavab birbaşa müqavilənin sahəsinə (başlıq,
          məbləğ, valyuta, qeydlər, növ) köçür. Beləliklə forma göndəriləndə qaralama avtomatik dolur —
          əl ilə yenidən yazmağa ehtiyac qalmır. Bağlama lazım deyilsə, «Bağlama yoxdur» qalır və cavab
          sadəcə forma cavabı kimi saxlanır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Kartdakı zibil qutusu düyməsi <strong>deaktivasiya</strong> edir, formanı tamamilə silmir —{" "}
          mövcud müraciətlər qorunur, sadəcə forma yeni sorğu qəbul etmir. <strong>Növ</strong>{" "}
          <em>seçim</em> olan suallar üçün <strong>Seçimlər</strong> sahəsini doldurmağı unutmayın,
          əks halda istifadəçinin seçə biləcəyi variant olmaz.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Formaları yalnız <strong>admin</strong> və <strong>superadmin</strong> yarada, redaktə və
          deaktiv edə bilir — digər rollarda bu düymələr ümumiyyətlə göstərilmir. Bütün formalar
          təşkilatınızla məhdudlaşır; başqa təşkilatın formalarını görmürsünüz.
        </p>
      </HelpCallout>
    </div>
  )
}
