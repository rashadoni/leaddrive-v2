"use client"

/**
 * Deal detail (record) — help article (Azerbaijani).
 * Bir sövdələşmənin tam kartı: /deals/[id].
 * Əhatə edir: başlıq + mərhələ rozeti + teqlər, mərhələ proqres zolağı
 * (chevron-lar) ilə mərhələ dəyişmə + checklist/validasiya, sol sütun
 * (DealSidebar: kontakt, dəyər, açar məlumat, qeydlər, Təkliflər/Hesab-fakturalar/
 * Komanda/Kontakt rolları/Rəqiblər akkordeonları), AI Proqnoz + AI Təklifləri +
 * Növbəti Təkliflər + Növbəti addımlar, sağ sütun (Sürətli əməliyyat paneli:
 * Qeyd/Tapşırıq/E-poçt + zaman xətti), redaktə/sil modalları.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function dealdetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış nümayəndəsi və ya satış menecerisiniz"
        goal="Bir sövdələşmənin kartını açıb bütün məlumatını oxumaq, onu boru xətti boyunca irəli çəkmək və üstündə əsas əməliyyatları (qeyd, e-poçt, tapşırıq, komanda, rəqib) etmək"
      >
        Bu səhifəyə <HelpKey>Satış boru xətti</HelpKey> siyahısında və ya lövhəsində bir sövdələşməyə
        klikləməklə daxil olursunuz. Açılan ünvan <HelpKey>/deals/&lt;id&gt;</HelpKey> formasındadır və
        yalnız sizin təşkilatınızın sövdələşməsini göstərir. Burada gördüyünüz hər şey — dəyər, mərhələ,
        kontakt, komanda, fəaliyyət — eyni sövdələşmədən oxunur; dəyişiklik etdikcə kart canlı yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <strong>başlıq sətri</strong> var: solda geriyə oxu (<HelpKey>Sövdələşmələrə qayıt</HelpKey>),
          ortada sövdələşmənin adı və yanında rəngli <strong>mərhələ rozeti</strong>, adın altında teq
          ikonası ilə <strong>teqlər</strong>, sağda isə <HelpKey>Redaktə et</HelpKey> və qırmızı zibil
          qutusu (sil) düymələri. Başlığın altında <strong>mərhələ proqres zolağı</strong> — chevron
          (ox) formasında mərhələlər: Lid → Kvalifikasiya → Təklif → Danışıqlar → Qazanıldı (sövdə
          itirilibsə İtirildi də göstərilir).
        </p>
        <p>
          Aşağıda səhifə iki sütuna bölünür. <strong>Sol sütun</strong> məlumat panelidir: kontakt
          başlığı (Zəng / Email / WhatsApp düymələri ilə), iri rəqəmlə sövdələşmənin <strong>dəyəri</strong>{" "}
          və valyutası, qazanma ehtimalı və güvən səviyyəsi, açar məlumat sətirləri (Şirkət, Məsul şəxs,
          Gözlənilən bağlanma, Yaradılıb, Kampaniya, Müştəri ehtiyacı, Satış kanalı), Qeydlər, və açılıb-
          bağlanan akkordeon bölmələri (<strong>Təkliflər</strong>, <strong>Hesab-fakturalar</strong>,{" "}
          <strong>Komanda</strong>, <strong>Kontakt rolları</strong>, <strong>Rəqiblər</strong>). Onun
          altında <strong>AI Proqnoz</strong> kartı, <strong>AI Təklifləri</strong>, çarpaz satış üçün
          <strong> Növbəti Təkliflər</strong> və <strong>Növbəti addımlar</strong> vidceti gəlir.{" "}
          <strong>Sağ sütun</strong> isə üstdə <strong>Sürətli əməliyyat paneli</strong> (Qeyd / Tapşırıq
          / E-poçt) və altında <strong>zaman xətti</strong> (bütün fəaliyyət lenti) ilə doludur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Mərhələ rozeti">Başlıqda sövdələşmənin cari mərhələsini rənglə göstərən nişan (məs. «Təklif»).</HelpDef>
          <HelpDef term="Mərhələ proqres zolağı">Chevron formalı mərhələ sırası; keçilmiş mərhələdə işarə (✓) olur, hədəf mərhələyə klikləməklə mərhələni dəyişirsiniz.</HelpDef>
          <HelpDef term="Qazanma ehtimalı / Güvən səviyyəsi">Sövdənin nə qədər ehtimalla qazanılacağı (faiz) və ona olan əminlik faizi.</HelpDef>
          <HelpDef term="AI Proqnoz">Süni intellektin hesabladığı qazanma faizi, risk və güclü tərəflər, həmçinin tövsiyə olunan növbəti addımlar.</HelpDef>
          <HelpDef term="Sürətli əməliyyat paneli">Sövdəyə bir kliklə Qeyd, Tapşırıq əlavə etmək və ya kontakta E-poçt göndərmək üçün üst panel.</HelpDef>
          <HelpDef term="Zaman xətti">Bu sövdə üzrə bütün fəaliyyətlər (zəng, e-poçt, görüş, qeyd, tapşırıq) tarix sırası ilə.</HelpDef>
          <HelpDef term="Kontakt rolları">Sövdədə iştirak edən şəxslər, hər birinin rolu, təsiri, sadiqliyi və varsa keşbeki.</HelpDef>
          <HelpDef term="Komanda">Bu sövdə üzərində işləyən daxili istifadəçilər (Üzv / Sahib / Dəstək rolları ilə).</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: sövdənin kartını oxu">
        <HelpStep n={1}>
          <p>
            <HelpKey>Satış boru xətti</HelpKey> səhifəsində istənilən sövdə sətrinə və ya kartına
            klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sövdənin tam kartı açılır: yuxarıda adı və mərhələ rozeti, altında mərhələ proqres zolağı,
            sonra iki sütun. (Sövdə yüklənərkən boz «skelet» bloklar görünür, sövdə tapılmasa{" "}
            «Sövdələşmə tapılmadı» mesajı və <HelpKey>Sövdələşmələrə qayıt</HelpKey> düyməsi çıxır.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sol sütunda kontaktın adını, dəyəri və açar məlumat sətirlərini oxuyun. Akkordeon
            başlıqlarına (<HelpKey>Təkliflər</HelpKey>, <HelpKey>Komanda</HelpKey>,{" "}
            <HelpKey>Kontakt rolları</HelpKey>, <HelpKey>Rəqiblər</HelpKey>) klikləyərək onları açıb-
            bağlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər akkordeon başlığında yanında say (məs. üzv sayı) durur; içində məlumat olan bölmələr
            avtomatik açıq gəlir, boş bölmələrdə «Komanda üzvü yoxdur», «Kontakt rolu yoxdur» və ya
            «Rəqib yoxdur» mətni görünür. Kontakt başlığındakı yaşıl <HelpKey>Zəng</HelpKey>, mavi{" "}
            <strong>Email</strong> və yaşıl <strong>WhatsApp</strong> düymələri telefon/e-poçtu birbaşa
            açır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sövdəni növbəti mərhələyə keçir">
        <HelpStep n={1}>
          <p>
            Başlığın altındakı mərhələ zolağında keçmək istədiyiniz <strong>hədəf mərhələyə</strong>{" "}
            klikləyin (cari mərhələyə klik işləməz).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Checklist» (yoxlama) pəncərəsi açılır: əgər hədəf mərhələ üçün qaydalar varsa, hər şərt
            keçdi/keçmədi nişanı ilə sadalanır; qayda yoxdursa pəncərə sadəcə keçidi təsdiqləməyi
            istəyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pəncərədəki təsdiq düyməsi ilə mərhələ keçidini təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Keçid alınanda pəncərə bağlanır, başlıqdakı mərhələ rozeti və proqres zolağı yeni mərhələni
            göstərir. Hədəf mərhələnin məcburi şərtləri ödənməyibsə (server 422 qaytarır), bunun yerinə
            «validasiya» pəncərəsi açılıb çatışmayan sahələri sadalayır və keçid baş tutmur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qeyd, tapşırıq və ya e-poçt əlavə et (Sürətli əməliyyat)">
        <HelpStep n={1}>
          <p>
            Sağ sütunun üstündəki panelidə <HelpKey>Qeyd</HelpKey>, <HelpKey>Tapşırıq</HelpKey> və ya{" "}
            <HelpKey>E-poçt</HelpKey> nişanlarından birini seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş nişanın altı vurğulanır. <strong>Qeyd</strong>/<strong>Tapşırıq</strong> üçün tək
            mətn sahəsi və <HelpKey>Göndər</HelpKey> düyməsi çıxır; <strong>E-poçt</strong> üçün alıcı
            seçici (Kimə), Mövzu, mətn sahəsi və fayl əlavə etmə (<HelpKey>Əlavə et</HelpKey>) düyməsi
            görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Qeyd</strong> və ya <strong>Tapşırıq</strong> üçün mətni yazıb <HelpKey>Göndər</HelpKey>{" "}
            (və ya Enter) basın. <strong>E-poçt</strong> üçün alıcını seçin, mövzu və mətni doldurun,
            lazımsa fayl əlavə edin, sonra <HelpKey>Göndər</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qeyd/tapşırıq əlavə olunduqda sahə boşalır; qeyd zaman xəttində peyda olur, tapşırıq isə{" "}
            <strong>Növbəti addımlar</strong> siyahısına düşür. E-poçt göndəriləndə yaşıl «Göndərildi →
            alıcının ünvanı» bildirişi çıxır (SMTP qurulmayıbsa «Qeyd olundu» kimi yazılır), sonra məktub
            zaman xəttinə əlavə olunur. Sövdədə e-poçtu olan kontakt yoxdursa, e-poçt yerinə sarı
            «Sövdəyə email-li kontakt əlavə edin» xəbərdarlığı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağ sütundakı <strong>zaman xəttini</strong> oxuyun. Yuxarıdakı filtr düymələri (Hamısı,
            Zəng, E-poçt, Görüş, Qeyd, Tapşırıq) ilə süzgəcdən keçirin və ya <HelpKey>Əlavə et</HelpKey>{" "}
            düyməsi ilə daha ətraflı fəaliyyət (tip + mövzu + təsvir) yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər fəaliyyət növünə uyğun rəngli ikona və tarix-saatla lent kimi sıralanır (ən yenisi
            yuxarıda). Filtr seçəndə yalnız həmin tipli yazılar qalır; heç nə yoxdursa «Fəaliyyət yoxdur»
            və «E-poçt, zəng və qeydlər burada görünəcək» mətni göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: komanda, kontakt rolu və ya rəqib əlavə et">
        <HelpStep n={1}>
          <p>
            Sol sütunda müvafiq akkordeonu açın və içindəki <HelpKey>Üzv əlavə et</HelpKey>,{" "}
            <HelpKey>Kontakt rolu əlavə et</HelpKey> və ya <HelpKey>Rəqib əlavə et</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Akkordeonun içində kiçik forma açılır. Komandada: axtarış sahəsi + istifadəçi siyahısı + rol
            seçimi (Üzv / Sahib / Dəstək). Kontakt rolunda: kontakt axtarışı + rol, təsir, sadiqlik və
            keşbek seçimləri. Rəqibdə: ad, məhsul, güclü/zəif tərəflər, qiymət və təhlükə səviyyəsi
            sahələri.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Formanı doldurub <HelpKey>Saxla</HelpKey> basın. Daha sonra hər sətrin üstünə gələndə görünən
            × ikonası ilə üzvü, rolu və ya rəqibi silə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni yazı dərhal müvafiq akkordeonun siyahısına və başlıqdakı saya əlavə olunur. × ilə
            silinəndə sətir siyahıdan çıxır və say azalır. Forma natamamdırsa (məs. üzv seçilməyib){" "}
            <HelpKey>Saxla</HelpKey> deaktiv qalır; əməliyyat alınmasa qırmızı xəta mesajı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: teqlər, redaktə və silmə">
        <HelpStep n={1}>
          <p>
            Başlıqda teq ikonasının yanındakı <HelpKey>+ Teq əlavə et</HelpKey> sahəsinə söz yazıb Enter
            basın; mövcud teqdəki × ilə onu silin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Teq rəngli kapsul kimi başlığın altında görünür və dərhal yadda saxlanır (ayrıca «yadda
            saxla» düyməsi yoxdur).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sövdənin əsas sahələrini (ad, şirkət, mərhələ, dəyər, valyuta, ehtimal, gözlənilən bağlanma,
            qeyd) dəyişmək üçün sağ yuxarıdakı <HelpKey>Redaktə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövcud dəyərlərlə əvvəlcədən doldurulmuş sövdələşmə forması açılır. Saxladıqdan sonra kart
            yeni məlumatla yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sövdəni silmək üçün başlıqdakı qırmızı zibil qutusu düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Sövdələşməni sil» təsdiq pəncərəsi sövdənin adı ilə açılır. Təsdiqlədikdən sonra səhifə
            bağlanır və sizi sövdələşmələr siyahısına qaytarır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Sol sütundakı <strong>Növbəti addımlar</strong> vidceti ilə Sürətli əməliyyat panelindəki{" "}
          <strong>Tapşırıq</strong> eyni siyahını qidalandırır. Tapşırığı yerinə yetirdikdə yanındakı
          dairəyə klikləyin — o, üstündən xətt çəkilmiş «tamamlandı» bölməsinə keçir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Mərhələ keçidi həmişə avtomatik baş vermir: hədəf mərhələnin məcburi şərtləri varsa, onlar
          ödənənə qədər keçid bloklanır (validasiya pəncərəsi çatışmayan sahələri göstərir). Silmə isə
          geri qaytarılmır — yalnız tam əmin olduqda təsdiqləyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Sövdə və ona bağlı hər şey (kontaktlar, komanda, rəqiblər, fəaliyyət) təşkilatınızla
          məhdudlaşır — başqa tenant-ın sövdəsini aça bilməzsiniz, komandaya yalnız öz təşkilatınızın
          istifadəçilərini əlavə edirsiniz. Bəzi sahələr (məs. dəyər, ehtimal) sizin sahə icazələrinizə
          görə gizlədilə bilər; görmədiyiniz sahə icazə tənzimləməsindən asılıdır.
        </p>
      </HelpCallout>
    </div>
  )
}
