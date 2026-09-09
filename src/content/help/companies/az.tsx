"use client"

/**
 * Companies — help article (Azerbaijani).
 * "list-power" ortaq məqaləsindən ayrılıb; YALNIZ Şirkətlər səhifəsi haqqında:
 * status nişanları, axtarış/çeşidləmə, kütləvi əməliyyatlar, kartlar, detal modal.
 *
 * DİQQƏT (düzəliş): Kart kliki <LeadDetailModal> açır — onun bölmələri
 * Detallar / Kontaktlar / Sövdələşmələr / Fəaliyyət / Müqavilələr / Tiketlər-dir.
 * «Xronologiya», «Qiymətləndirmə» bölmələri və huni/müştəri-günləri KPI bloku
 * burada YOXDUR — onlar ayrıca /companies/[id] tam səhifəsindədir (ayrı məqalə).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CompaniesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="müştəri bazasını idarə edən satış və ya hesab meneceri"
        goal="müştəri şirkətlərini tapmaq, statusunu yeniləmək, kütləvi dəyişiklik etmək və şirkət detallarını açmaq"
      >
        Şirkətlər səhifəsi yalnız öz təşkilatınızın «müştəri» kateqoriyalı şirkətlərini
        yükləyir. Buradan yeni şirkət əlavə edə, mövcudlarını redaktə edə və ya silə bilərsiniz —
        adi istifadəçi hüququ kifayətdir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda başlıq cari görünən şirkət sayını mötərizədə göstərir (məs.{" "}
          <strong>Şirkətlər (12)</strong>), yanında turu yenidən oynatma və bu kömək düyməsi
          dayanır. Sağ küncdə <HelpKey>Əlavə et</HelpKey> düyməsi yeni şirkət formasını açır.
        </p>
        <p>
          Başlığın altında səhifə təsviri, sonra status üzrə filtr düymələri, axtarış+çeşidləmə
          sətri, seçilmiş şirkətlər üçün kütləvi əməliyyat paneli, saxlanmış görünüş çipləri və
          nəhayət şirkət kartlarının şəbəkəsi gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status nişanı">
            Hər kartda redaktə oluna bilən nişan: <strong>Aktiv</strong>,{" "}
            <strong>Perspektiv</strong> və ya <strong>Qeyri-aktiv</strong>. Birbaşa kartdan dəyişə
            bilərsiniz.
          </HelpDef>
          <HelpDef term="Bal pili (HOT / WARM / COLD)">
            Lid balı 0-dan böyük olduqda kartın sağında görünür: ≥70 isti (HOT, yaşıl), ≥40 ilıq
            (WARM, sarı), aşağıda soyuq (COLD, mavi) və yanında rəqəm.
          </HelpDef>
          <HelpDef term="Kart metrikləri">
            İnsan ikonu kontakt sayını, yüksələn xətt ikonu sövdələşmə sayını göstərir; əgər SLA
            siyasəti təyin olunubsa «SLA: …» kimi görünür.
          </HelpDef>
          <HelpDef term="Kateqoriya">
            Kütləvi paneldə dəyişilən qruplaşdırma: <strong>Müştəri</strong>,{" "}
            <strong>Tərəfdaş</strong>, <strong>Potensial</strong> və ya <strong>Qeyri-aktiv</strong>.
            Status nişanından ayrı sahədir.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: şirkət tapmaq və çeşidləmək">
        <HelpStep n={1}>
          <p>
            Status üzrə daraltmaq üçün filtr düymələrindən birini basın:{" "}
            <HelpKey>Hamısı</HelpKey>, <HelpKey>Aktiv</HelpKey>, <HelpKey>Perspektiv</HelpKey> və ya{" "}
            <HelpKey>Qeyri-aktiv</HelpKey>. Hər düymədə həmin statusdakı şirkət sayı mötərizədə yazılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə dolu (default) görünür, qalanları haşiyəli qalır; kart şəbəkəsi yalnız o
            statusa uyğun şirkətləri göstərir və başlıqdakı say yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Ada görə axtarın: axtarış sahəsinə (lupa ikonlu,{" "}
            <HelpKey>Şirkət axtar…</HelpKey> mətnli) şirkət adını yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siz yazdıqca şəbəkə dərhal süzülür — yalnız adında həmin mətn olan şirkətlər qalır,
            uyğunluq yoxdursa <strong>«Filtrə uyğun şirkət tapılmadı»</strong> yazısı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağdakı çeşidləmə menyusundan sıranı seçin: <HelpKey>Ad A → Z</HelpKey>,{" "}
            <HelpKey>Ad Z → A</HelpKey>, <HelpKey>İsti → Soyuq</HelpKey>,{" "}
            <HelpKey>Soyuq → İsti</HelpKey>, <HelpKey>Bal ↓</HelpKey> və ya{" "}
            <HelpKey>Kontaktlar ↓</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartlar dərhal yenidən sıralanır — məsələn «İsti → Soyuq» seçəndə HOT şirkətlər başa,
            «Kontaktlar ↓» seçəndə ən çox kontaktı olanlar başa keçir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Filtr, axtarış və çeşidləmə birlikdə işləyir: əvvəlcə statusu daraldıb, sonra ada görə
            axtarıb, nəticəni bala görə sıralaya bilərsiniz. Tez-tez istifadə etdiyiniz kombinasiyanı
            aşağıdakı saxlanmış görünüş çiplərinə yaza bilərsiniz.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni şirkət əlavə etmək">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şirkət forması boş açılır — ad, sənaye, status, şəhər/ölkə, vebsayt, e-poçt, telefon və
            digər sahələri burada doldurursunuz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Sahələri doldurub formanı yadda saxlayın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Form bağlanır, siyahı avtomatik yenilənir və yeni şirkət kart kimi şəbəkədə görünür;
            başlıqdakı say bir vahid artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kartdan statusu redaktə etmək">
        <HelpStep n={1}>
          <p>
            Kartdakı status nişanına (<strong>Aktiv</strong> / <strong>Perspektiv</strong> /{" "}
            <strong>Qeyri-aktiv</strong>) klikləyin. Bu, kartı açmadan birbaşa redaktə olunan
            sahədir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nişan açılan seçimə çevrilir; yeni statusu seçəndə kart kartın özünü açmadan yerində
            yenilənir (kartın gövdəsinə klikləmə isə detal pəncərəsini açır).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Status nişanı kartın gövdəsindən ayrıdır. Nişana klikləmək statusu dəyişir; kartın boş
            yerinə klikləmək isə <strong>detal pəncərəsini</strong> açır. Səhv yeri klikləsəniz
            sadəcə pəncərəni bağlayın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: kütləvi əməliyyatlar">
        <HelpStep n={1}>
          <p>
            Hər kartın sol yuxarı küncündəki onay qutusuna klikləyərək bir neçə şirkət seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilən kart nazik haşiyə və yüngül fon ilə işarələnir; kütləvi əməliyyat paneli neçə
            şirkətin seçildiyini göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Paneldə <HelpKey>Statusu təyin et…</HelpKey> menyusundan yeni status (Aktiv / Perspektiv /
            Qeyri-aktiv) və ya <HelpKey>Kateqoriyanı təyin et…</HelpKey> menyusundan kateqoriya
            (Müştəri / Tərəfdaş / Potensial / Qeyri-aktiv) seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dəyişiklik bütün seçilən şirkətlərə tətbiq olunur, «{"{say}"} şirkət yeniləndi» bildirişi
            çıxır, seçim sıfırlanır və siyahı yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Seçilmişləri silmək üçün panelin sağındakı <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsdiq pəncərəsi neçə şirkətin siləcəyini soruşur («{"{say}"} şirkət»); təsdiqdən sonra
            onlar şəbəkədən çıxır və «{"{say}"} şirkət silindi» bildirişi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Filtri və ya axtarışı dəyişəndə seçim avtomatik sıfırlanır — çünki seçilmiş şirkətlər
            artıq görünməyə bilər. Kütləvi silmə geri qaytarıla bilməz, ona görə təsdiqdən əvvəl
            sayı yoxlayın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: şirkətin tez-baxış pəncərəsini açmaq">
        <HelpStep n={1}>
          <p>İstənilən kartın gövdəsinə (onay qutusu, status nişanı və redaktə düymələrindən kənar yerə) klikləyin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şirkətin tez-baxış pəncərəsi açılır. Yuxarıda şirkət adı, varsa vebsayt və lid-status
            nişanı durur, altında isə bölmə tabları sıralanır: <HelpKey>Detallar</HelpKey>,{" "}
            <HelpKey>Kontaktlar</HelpKey>, <HelpKey>Sövdələşmələr</HelpKey>,{" "}
            <HelpKey>Fəaliyyət</HelpKey>, <HelpKey>Müqavilələr</HelpKey> və{" "}
            <HelpKey>Tiketlər</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Standart açılan <HelpKey>Detallar</HelpKey> tabına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda <strong>Hunidəki status</strong> pilləri (Yeni / Əlaqə saxlanıb / İxtisaslı /
            Konvertasiya / Rədd / Ləğv) — birinə klikləməklə statusu dəyişə bilərsiniz. Altında bal
            zolağı (hərf qiyməti A–F, HOT/WARM/COLD və bal/100), dolu olan <strong>Əlaqə</strong> və{" "}
            <strong>Biznes</strong> sahələri, <strong>Şirkət haqqında</strong> mətni və axırda dörd
            xanalı tez göstərici (əsas insanlar, sövdələşmələr, müqavilələr, hərf qiyməti) görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Digər tablara keçin: <HelpKey>Kontaktlar</HelpKey>, <HelpKey>Sövdələşmələr</HelpKey>,{" "}
            <HelpKey>Fəaliyyət</HelpKey>, <HelpKey>Müqavilələr</HelpKey>, <HelpKey>Tiketlər</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər tab həmin şirkətə bağlı siyahını göstərir; boş olduqda «Kontakt yoxdur»,
            «Sövdələşmə yoxdur», «Müqavilə yoxdur» kimi mətnlər çıxır. <strong>Fəaliyyət</strong>{" "}
            tabında <HelpKey>Qeyd et</HelpKey> ilə qeyd/zəng/e-poçt/görüş əlavə edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Pəncərənin lap altındakı dörd əməliyyat düyməsindən istifadə edin:{" "}
            <HelpKey>Müqavilələr</HelpKey> (bu şirkət üzrə müqavilələrə keçid),{" "}
            <HelpKey>Redaktə et</HelpKey> (şirkətin tam səhifəsinə keçir),{" "}
            <HelpKey>Deaktiv et</HelpKey> və <HelpKey>Sil</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Redaktə et</HelpKey> pəncərəni bağlayıb şirkətin{" "}
            <strong>tam profil səhifəsinə</strong> (/companies/[id]) aparır; <HelpKey>Deaktiv et</HelpKey>{" "}
            və <HelpKey>Sil</HelpKey> əvvəlcə təsdiq soruşur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Bu tez-baxış pəncərəsi <strong>tam şirkət səhifəsi deyil</strong>. Onun tabları yalnız
            Detallar / Kontaktlar / Sövdələşmələr / Fəaliyyət / Müqavilələr / Tiketlərdir. Daha dərin
            analitika — xronologiya, qiymətləndirmə, huni və müştəri-günləri göstəriciləri —{" "}
            <strong>şirkətin tam səhifəsindədir</strong>: ora <HelpKey>Redaktə et</HelpKey> düyməsi ilə
            keçin (ayrı kömək məqaləsi mövcuddur).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: kartdan tez redaktə və ya silmə">
        <HelpStep n={1}>
          <p>
            Pəncərəni açmadan tez redaktə və ya silmə üçün kartın aşağı-sağ küncündəki qələm
            (<HelpKey>Redaktə et</HelpKey>) və ya zibil qabı (<HelpKey>Sil</HelpKey>) ikonlarından
            istifadə edin. Bu düymələr adətən yarı-şəffafdır, kartın üzərinə gələndə tam görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qələm şirkət formasını redaktə rejimində açır; zibil qabı tək şirkət üçün təsdiq
            pəncərəsini açır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Siyahının üstündəki saxlanmış görünüş çipləri cari filtr + axtarış + çeşidləmə
          kombinasiyasını yadda saxlamağa imkan verir — eyni süzgəci hər dəfə yenidən qurmadan bir
          kliklə geri qaytarın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu səhifə yalnız öz təşkilatınızın «müştəri» kateqoriyalı şirkətlərini göstərir — başqa
          tenant-ların məlumatı heç vaxt görünmür. Status, kateqoriya, redaktə və silmə əməliyyatları
          serverdə təşkilatınızla məhdudlaşdırılır.
        </p>
      </HelpCallout>
    </div>
  )
}
