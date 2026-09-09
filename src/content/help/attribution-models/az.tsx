"use client"

/**
 * Marketing Attribution — modellər səhifəsi üçün help məqaləsi (Azərbaycanca).
 * Yalnız Atribusiya → Modellər səhifəsini əhatə edir: model yaratma
 * (first-touch / last-touch / linear / time-decay / U-formalı / fərdi əyri),
 * redaktə, default təyini, aktivləşdirmə, arxivləmə, silmə, yenidən hesablama,
 * kampaniyalar üzrə bölgü və son işləmə statusu. Digər atribusiya/kampaniya
 * səhifələri bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AttributionmodelsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq administratoru və ya satış əməliyyatları üzrə məsulsunuz"
        goal="Udulmuş sövdənin gəlirini ona töhfə vermiş kampaniyalar arasında necə bölüşdürəcəyini təyin etmək və hər kampaniyanın real qazanca töhfəsini görmək"
      >
        Səhifəyə <HelpKey>Atribusiya</HelpKey> → <HelpKey>Modellər</HelpKey> yolu ilə çatırsınız. Burada
        bütün modellər, hesablamalar və gəlir rəqəmləri yalnız sizin təşkilatınıza aiddir. Səhifə açılanda
        modellər siyahısı bir dəfə yüklənir; istənilən dəyişiklikdən (yaratma, redaktə, status) sonra və ya
        sağ yuxarıdakı yeniləmə düyməsini basanda yuxarıdakı statistika kartları dərhal təzələnir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda diaqram ikonası ilə <HelpKey>Atribusiya modelləri</HelpKey> adı, altında «Multi-touch
          atribusiya modelləri sövdənin gəlirini ona töhfə vermiş kampaniyalar arasında bölür» izahı durur.
          Sağ yuxarıda iki düymə var: <HelpKey>Yeni model</HelpKey> (mavi, artı işarəli) və yeniləmə
          düyməsi (dairəvi ox). Onların altında üç statistika kartı gəlir: <strong>Cəmi model</strong>,{" "}
          <strong>Aktiv</strong> və <strong>Tutulmuş təmas nöqtələri</strong>. Daha aşağıda model kartları
          iki sütunlu şəbəkə kimi düzülür — hələ heç bir model yoxdursa, onların yerinə boş vəziyyət
          göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Atribusiya modeli">Sövdənin gəlirini onun yolundakı təmas nöqtələri (kampaniyalar) arasında necə böləcəyini təyin edən qayda — adı, növü, vəziyyəti və konfiqurasiyası olan.</HelpDef>
          <HelpDef term="Təmas nöqtəsi">Marketinq qarşılıqlı əlaqəsi — email açma, reklam kliki, səhifə baxışı, form göndərmə, tədbir iştirakı. Modellər gəliri məhz bu nöqtələr arasında bölür.</HelpDef>
          <HelpDef term="Cəmi model">Yaratdığınız bütün modellərin sayı (aktiv, qaralama və arxivlənmiş birlikdə).</HelpDef>
          <HelpDef term="Aktiv">Hazırda aktiv vəziyyətdə olan modellərin sayı.</HelpDef>
          <HelpDef term="Tutulmuş təmas nöqtələri">Sistemin qeydə aldığı marketinq təmas nöqtələrinin ümumi sayı — modellərin bölüşdürdüyü material.</HelpDef>
          <HelpDef term="Default model">Hər sövdə irəlilədikdə kampaniya töhfəsini avtomatik yenidən hesablayan model. Eyni anda yalnız bir model default ola bilər; kartında ulduzlu «Default» nişanı görünür.</HelpDef>
          <HelpDef term="Təsirlər (influences)">Modelin yazdığı «bu kampaniya bu sövdəyə bu qədər töhfə verdi» qeydlərinin sayı.</HelpDef>
          <HelpDef term="Atribusiya edilmiş gəlir">Udulmuş sövdələrdən bu modelə görə kampaniyalara paylanmış ümumi gəlir.</HelpDef>
        </dl>
        <p>
          Hər model kartında ad, varsa default nişanı, sağda vəziyyət nişanı (<strong>Aktiv</strong> yaşıl,{" "}
          <strong>Qaralama</strong> kəhrəba, <strong>Arxivlənmiş</strong> boz), model növünün adı və qısa
          izahı, konfiqurasiya xülasəsi (məs. «İlk 40% / Orta 20% / Son 40%»), <strong>Təsirlər</strong> və{" "}
          <strong>Atribusiya edilmiş gəlir</strong> rəqəmləri olur. Təsirlər varsa,{" "}
          <HelpKey>Kampaniyalar üzrə bölgü</HelpKey> açılan bölməsi və ən altda{" "}
          <strong>Son işləmə</strong> statusu görünür. Kartın dibində əməliyyat düymələri durur:{" "}
          <HelpKey>Redaktə et</HelpKey>, <HelpKey>Yenidən hesabla</HelpKey>, <HelpKey>Defolt et</HelpKey>,{" "}
          <HelpKey>Aktivləşdir</HelpKey> (yalnız qaralamada), <HelpKey>Arxivə at</HelpKey> və ən sağda
          qırmızı <HelpKey>Sil</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni model yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni model</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda «Model yarat» başlıqlı forma kartı açılır. İçində <strong>Ad</strong>,{" "}
            <strong>Təsvir</strong> sahələri, <strong>Model növü</strong> açılan siyahısı və altında{" "}
            <strong>Dərhal aktivləşdir</strong> qeyd qutusu var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong> yazın — bu məcburidir (məs. «First-touch (əsas)»). İstəsəniz bir sətirlik{" "}
            <strong>Təsvir</strong> əlavə edin (modelin necə və nə vaxt istifadə olunduğu).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mətn sahələrdə görünür. Adı boş buraxıb yadda saxlamağa çalışsanız, yuxarıda qırmızı «Ad tələb
            olunur» xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Model növü</strong> seçin: <HelpKey>İlk təmas</HelpKey>, <HelpKey>Son təmas</HelpKey>,{" "}
            <HelpKey>Xətti</HelpKey>, <HelpKey>Zamanla azalan</HelpKey>, <HelpKey>U-formalı</HelpKey> və ya{" "}
            <HelpKey>Fərdi</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahının altında seçdiyiniz növün qısa izahı görünür (məs. «Bütün töhfə ilk təmas
            nöqtəsinə»). Seçimə görə aşağıda əlavə tənzimləmə sahələri peyda olur (aşağıdakı addımlara
            baxın). Diqqət: model növü yaradıldıqdan sonra dəyişdirilə bilmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Zamanla azalan</strong> seçmisinizsə, <strong>Yarımparçalanma (gün)</strong> sahəsini
            doldurun. İlk təmas, son təmas və xətti modellər heç bir əlavə tənzimləmə tələb etmir — bu addımı
            keçə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bir rəqəm sahəsi və altında ipucu: «7 = sövdə bağlanmazdan 7 gün əvvəlki təmas bağlanma
            anındakının yarısı qədər dəyərlidir». Müsbət olmayan dəyər versəniz, yadda saxlamada «Yarımparçalanma
            müsbət gün sayı olmalıdır» xətası çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            <strong>U-formalı</strong> seçmisinizsə, üç çəkini doldurun: <strong>İlk təmasın çəkisi</strong>,{" "}
            <strong>Orta çəki</strong> və <strong>Son təmasın çəkisi</strong> (məs. 0.4 / 0.2 / 0.4).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç sahə yan-yana göstərilir, altında «Üç çəkinin cəmi 1.0 olmalıdır» ipucusu durur. Cəm 1.0
            deyilsə «Üç çəkinin cəmi 1.0 olmalıdır», çəki 0–1 aralığından kənardırsa «Hər çəki 0 ilə 1
            arasında olmalıdır» xətası çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            <strong>Fərdi</strong> seçmisinizsə, öz əyrinizi qurun: <HelpKey>Hazır formalar</HelpKey>{" "}
            düymələrindən birini basın (Bərabər, Başlanğıca çox, Sona çox, U formalı, W formalı) və ya
            əl ilə nöqtələri redaktə edin — hər sətirdə <strong>Mövqe (0–1)</strong> və <strong>Çəki</strong>.{" "}
            <HelpKey>Nöqtə əlavə et</HelpKey> ilə nöqtə artırın, sətrin sağındakı × ilə silin (ən az 2 nöqtə
            qalmalıdır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nöqtələrin üstündə əyrinin canlı qrafiki çəkilir, altında «İlk təmas … Konversiya» oxu durur — çəki
            dəyişdikcə qrafik dərhal yenilənir. İpucu izah edir ki, çəkilər nisbi rəqəmlərdir, avtomatik
            normallaşdırılır. 2-dən az nöqtə qalsa «Ən azı 2 əyri nöqtəsi əlavə edin», mövqe 0–1-dən kənar
            və ya çəki 0-dan kiçik olsa uyğun xəta göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            İstəyə bağlı olaraq <HelpKey>Dərhal aktivləşdir</HelpKey> qutusunu işarələyin, sonra aşağıdakı{" "}
            <HelpKey>Saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz — <HelpKey>Ləğv et</HelpKey> və
            ya sağ yuxarıdakı × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxla düyməsi fırlanan ikona göstərir, sonra forma bağlanır və yeni model siyahıda peyda olur.{" "}
            <strong>Dərhal aktivləşdir</strong> işarələnməyibsə model kartında kəhrəba <strong>Qaralama</strong>{" "}
            nişanı olur; işarələnibsə yaşıl <strong>Aktiv</strong> olur və <strong>Aktiv</strong> kartındakı say
            bir vahid artır. <strong>Cəmi model</strong> kartı da artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: təsirləri hesablat və nəticəni oxu">
        <HelpStep n={1}>
          <p>
            Arxivlənməmiş bir model kartında <HelpKey>Yenidən hesabla</HelpKey> (kalkulyator ikonalı, mavi)
            düyməsini basın. Bu, modeli udulmuş sövdələr üzrə işə salır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə işləyərkən başqa düymələr müvəqqəti söndürülür. İş bitdikdə kartın altındakı{" "}
            <strong>Son işləmə</strong> bölməsi statusu göstərir: yaşıl «Uğurlu», qırmızı «Uğursuz» və ya
            kəhrəba «Gözləyir/İşləyir», yanında mənbə (Əl ilə) və neçə əvvəl olduğu. Altında «Sövdələr: X / Y
            işləndi» və «Yazılmış təsir: N» sətirləri görünür. <strong>Təsirlər</strong> və{" "}
            <strong>Atribusiya edilmiş gəlir</strong> rəqəmləri yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təsirlər yaranıbsa, kartdakı <HelpKey>Kampaniyalar üzrə bölgü</HelpKey> sətrini basaraq açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç sütunlu cədvəl açılır: <strong>Kampaniya</strong>, <strong>Sövdələr</strong> və{" "}
            <strong>Gəlir</strong>. Hər sətir hansı kampaniyanın neçə sövdəyə təsir etdiyini və ona düşən
            gəliri göstərir. Hələ bölgü yoxdursa «Hələ kampaniya üzrə atribusiya yoxdur» mətni görünür.
            Yenidən basanda bölmə yığışır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: modeli redaktə et, default et, aktivləşdir, arxivlə və ya sil">
        <HelpStep n={1}>
          <p>
            Adı, təsviri və ya konfiqurasiyanı dəyişmək üçün <HelpKey>Redaktə et</HelpKey> (qələm ikonalı)
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Modeli redaktə et» başlıqlı, mövcud dəyərlərlə əvvəlcədən doldurulmuş forma açılır. Model növü
            burada yalnız oxunan sahə kimi göstərilir — onu dəyişmək olmur. Dəyişiklikləri edib{" "}
            <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Modeli avtomatik yenidən hesablanan əsas model etmək üçün <HelpKey>Defolt et</HelpKey> (ulduz
            ikonalı) düyməsini basın. Bu düymə yalnız hələ default olmayan və arxivlənməmiş modellərdə görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartın başında ulduzlu <strong>Default</strong> nişanı peyda olur və kart çərçivəsi vurğulanır;
            əvvəlki default modeldən bu nişan götürülür (eyni anda yalnız bir default ola bilər).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Qaralama modeli işə hazır etmək üçün <HelpKey>Aktivləşdir</HelpKey> (güc ikonalı, yaşıl) düyməsini
            basın. Bu düymə yalnız <strong>Qaralama</strong> vəziyyətindəki modellərdə görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Vəziyyət nişanı kəhrəba <strong>Qaralama</strong>dan yaşıl <strong>Aktiv</strong>ə keçir,{" "}
            <strong>Aktiv</strong> statistika kartındakı say bir vahid artır və <HelpKey>Aktivləşdir</HelpKey>{" "}
            düyməsi kartdan yox olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Modeli istifadədən çıxarmaq, amma tarixçəni saxlamaq üçün <HelpKey>Arxivə at</HelpKey> (arxiv
            ikonalı) düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «‹model adı› modelini arxivə atmaq? Bir daha yenidən hesablanmayacaq» təsdiq pəncərəsi çıxır.
            Təsdiqlədikdən sonra nişan boz <strong>Arxivlənmiş</strong> olur və kartdan{" "}
            <HelpKey>Yenidən hesabla</HelpKey>, <HelpKey>Defolt et</HelpKey>, <HelpKey>Arxivə at</HelpKey>{" "}
            düymələri itir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Modeli büsbütün silmək üçün ən sağdakı qırmızı <HelpKey>Sil</HelpKey> (zibil qutusu ikonalı)
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «‹model adı› modelini silmək? Onun töhfələri (influences) və işəsalma tarixçəsi silinəcək» təsdiq
            pəncərəsi çıxır. Təsdiqlədikdən sonra model siyahıdan çıxır və statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Yenidən hesablama işləyib, lakin «Yenidən hesablama işlədi, lakin heç nə atribusiya olunmadı»
          xəbərdarlığı çıxırsa: ya udulmuş (closed-won) sövdə yoxdur (sövdələri «Won» mərhələsində bağlayın),
          ya da udulmuş sövdələrdə kontakt/şirkət göstərilməyib və ya təmas nöqtələri qeyd olunmur. Kart həmin
          xəbərdarlıqda hansı səbəbin keçərli olduğunu və nəyi yoxlamaq lazım gəldiyini sadalayır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Silmə geri qaytarılmır və modelin bütün təsirlərini (influences) və işəsalma tarixçəsini də silir.
          Modeli sadəcə istifadədən çıxarmaq, amma nəticələri saxlamaq istəyirsinizsə, silmək yerinə{" "}
          <HelpKey>Arxivə at</HelpKey> seçin. Həmçinin model növü yaradıldıqdan sonra dəyişdirilə bilmir —
          başqa məntiq lazımdırsa yeni model yaradın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün modellər, hesablamalar və gəlir rəqəmləri təşkilatınızla məhdudlaşır — başqa təşkilatın
          modellərini görmürsünüz və yenidən hesablama yalnız sizin tenant-ınızın sövdələri və təmas nöqtələri
          üzrə işləyir. Model yaratma və redaktə adətən marketinq/admin səlahiyyəti tələb edir.
        </p>
      </HelpCallout>
    </div>
  )
}
